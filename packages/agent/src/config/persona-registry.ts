// ABOUTME: Service for discovering and validating agent personas
// ABOUTME: Handles both built-in (bundled) and user-defined persona files

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import matter from 'gray-matter';
import { z } from 'zod';
import { getLaceDir } from './lace-dir';
import { resolveMcpServerCommandArgs } from './mcp-path-resolution';
import { scanEmbeddedFiles, resolveResourcePath } from '@lace/agent/utils/resource-resolver';
import { logger } from '@lace/agent/utils/logger';
import { registries as pluginRegistries } from '@lace/agent/plugins';
import type { TemplateEngine, TemplateContext } from './template-engine';

export interface PersonaInfo {
  name: string;
  isUserDefined: boolean;
  path: string;
}

// Mount names are lowercase alpha-leading, alphanumeric + hyphen thereafter.
// They reference the embedder's named-mount registry supplied at ent/initialize.
const mountNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

const runtimeRootSchema = z
  .object({
    type: z.literal('root'),
  })
  .strict();

const portMappingSchema = z
  .object({
    host: z.number().int().positive(),
    container: z.number().int().positive(),
  })
  .strict();

// containerSharing declares the sharing model: 'per_invocation' creates a fresh
// container per delegate invocation; 'persistent' adopts a long-lived one shared
// across delegates. In both cases the lace agent stays on the host and projects
// tools into the container runtime.
const containerSharingSchema = z.enum(['per_invocation', 'persistent']);

// Linux sysctl keys are dot-separated lowercase tokens (e.g.
// net.ipv6.conf.lo.disable_ipv6). Validate the shape here so a typo in the
// persona file fails at parse time instead of mid-`docker create`.
const sysctlKeySchema = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);

const runtimeContainerSchema = z
  .object({
    type: z.literal('container'),
    containerSharing: containerSharingSchema,
    image: z.string().min(1),
    workingDirectory: z.string().min(1),
    // Mount names resolved against the embedder-provided containerMounts
    // registry at materialization time. The registry owns container paths.
    mounts: z.array(mountNameSchema),
    env: z.record(z.string(), z.string()).optional().default({}),
    ports: z.array(portMappingSchema).optional(),
    // Linux kernel sysctls forwarded to `docker create --sysctl key=value`.
    // Browser personas need `net.ipv6.conf.lo.disable_ipv6=0` so the
    // container has an `::1` for superpowers-chrome's port-availability check.
    sysctls: z.record(sysctlKeySchema, z.string()).optional(),
    // Linux capabilities forwarded to `docker create --cap-add <cap>` per entry.
    // Persona containers need NET_ADMIN for the transparent egress gateway.
    capAdd: z.array(z.string().regex(/^[A-Z_]+$/)).optional(),
    // Docker network name forwarded to `docker create --network <name>`.
    // Persona containers join the quarantine network.
    network: z.string().min(1).optional(),
    // IPv4 address of the egress gateway for the post-start netns-init sidecar.
    // Sets the persona's default route to route all egress via the broker.
    gatewayRoute: z.string().min(1).optional(),
  })
  .strict();

const runtimeSchema = z.discriminatedUnion('type', [runtimeRootSchema, runtimeContainerSchema]);

export type PersonaRuntime = z.infer<typeof runtimeSchema>;

// Per-server MCP tool config is opaque to lace and forwarded to the MCP layer.
const mcpSecretReferenceSchema = z
  .object({
    namespace: z.enum(['session', 'project', 'host-service']),
    name: z.string().min(1),
  })
  .strict();

const personaConfigSchema = z
  .object({
    model: z.string().optional(),
    tools: z.array(z.string()).optional(),
    mcpServers: z
      .record(
        z.string(),
        z.object({
          command: z.string(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
          transport: z.enum(['stdio', 'sse', 'http']).optional(),
          secretEnv: z.record(z.string(), mcpSecretReferenceSchema).optional(),
          placement: z.enum(['toolRuntime', 'host']).optional(),
          enabled: z.boolean().optional(),
          tools: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .optional(),
    runtime: runtimeSchema.optional().default({ type: 'root' }),
    maxTurns: z.number().int().positive().optional(),
    compaction: z
      .object({
        strategy: z.string().optional(),
        breakpoints: z
          .array(z.object({ at: z.number(), action: z.enum(['notify', 'compact']) }).strict())
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    // Persistent containers are long-lived daemons reached via docker exec;
    // they intentionally do not publish host ports. Reject at parse time so
    // misconfiguration fails loudly rather than producing a silently-broken
    // container.
    const runtime = config.runtime;
    if (
      runtime?.type === 'container' &&
      runtime.containerSharing === 'persistent' &&
      runtime.ports?.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runtime', 'ports'],
        message: 'persistent container runtimes do not support host ports',
      });
    }
  });

export type PersonaConfig = z.infer<typeof personaConfigSchema>;

export interface ParsedPersona {
  readonly config: PersonaConfig;
  readonly body: string;
}

export class PersonaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonaParseError';
  }
}

export class PersonaNotFoundError extends Error {
  public readonly personaName: string;
  public readonly availablePersonas: string[];

  constructor(personaName: string, availablePersonas: string[]) {
    super(
      `Persona '${personaName}' not found. Available personas: ${availablePersonas.join(', ')}`
    );
    this.name = 'PersonaNotFoundError';
    this.personaName = personaName;
    this.availablePersonas = availablePersonas;
  }
}

export interface PersonaRegistryOptions {
  bundledPersonasPath: string;
  userPersonasPaths: readonly string[]; // ordered: earlier overrides later
  // Embedder package root. Relative `command`/`args` of host-placement
  // MCP servers in a persona are resolved against this at parse time (the
  // embedder spawns them from a cwd that differs from where the server scripts
  // live). Undefined ⇒ relative paths are left verbatim.
  mcpBaseDir?: string;
}

// ── PersonaSource interface ───────────────────────────────────────────────────

/**
 * A single source of personas. Each source owns membership, parsing, and
 * rendering for the personas it provides. Sources are held in precedence order:
 * user > plugin > bundled. The first source that `has` a name wins.
 */
export interface PersonaSource {
  readonly kind: 'user' | 'plugin' | 'bundled';
  readonly isUserDefined: boolean;
  has(name: string): boolean;
  names(): string[];
  /**
   * Display path for PersonaInfo.path: a real disk path for user personas,
   * a logical `<name>.md` for bundled personas, and `plugin:<name>` for plugin
   * personas (which have no file on disk).
   */
  displayPath(name: string): string;
  parse(name: string): ParsedPersona;
  render(name: string, engine: TemplateEngine, context: TemplateContext): string;
}

// ── Shared file-based parse helper ───────────────────────────────────────────

/**
 * Parses raw markdown+frontmatter content into a ParsedPersona.
 * Shared by user-disk and bundled sources.
 */
function parseFileContent(
  name: string,
  raw: string,
  mcpBaseDir: string | undefined
): ParsedPersona {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new PersonaParseError(`Failed to parse YAML frontmatter for persona '${name}': ${msg}`);
  }

  const validated = personaConfigSchema.safeParse(parsed.data);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new PersonaParseError(`Invalid frontmatter for persona '${name}': ${issues}`);
  }

  return { config: resolveMcpPaths(validated.data, mcpBaseDir), body: parsed.content };
}

/**
 * Resolve relative `command`/`args` of host-placement MCP servers
 * against `mcpBaseDir`. Host-placement servers run from the embedder's package
 * root (where the server scripts live), not lace's cwd, so a relative path
 * must be anchored there. toolRuntime-placement servers run inside the persona
 * container — their relative paths are container-side and are left untouched.
 * Absolute paths and bare command names (no `./`/`../`) pass through, so this
 * is idempotent over already-absolute configs.
 */
function resolveMcpPaths(config: PersonaConfig, baseDir: string | undefined): PersonaConfig {
  if (baseDir === undefined || config.mcpServers === undefined) return config;

  let changed = false;
  const mcpServers: NonNullable<PersonaConfig['mcpServers']> = {};
  for (const [serverId, server] of Object.entries(config.mcpServers)) {
    const resolved = resolveMcpServerCommandArgs(server, baseDir);
    if (resolved !== server) changed = true;
    mcpServers[serverId] = resolved;
  }

  return changed ? { ...config, mcpServers } : config;
}

// ── User-disk source ──────────────────────────────────────────────────────────

/**
 * Persona source backed by the user's on-disk persona files.
 * The cache (and its TTL/anyPathScanned behaviour) is owned by PersonaRegistry
 * and accessed via the callback. `render` delegates to engine.render so @path
 * includes work correctly across the template directory search path.
 */
class UserDiskSource implements PersonaSource {
  readonly kind = 'user' as const;
  readonly isUserDefined = true;

  constructor(
    private readonly getCache: () => Map<string, string>,
    private readonly mcpBaseDir: string | undefined
  ) {}

  has(name: string): boolean {
    return this.getCache().has(name);
  }

  names(): string[] {
    return Array.from(this.getCache().keys());
  }

  displayPath(name: string): string {
    return this.getCache().get(name) ?? name;
  }

  parse(name: string): ParsedPersona {
    const filePath = this.getCache().get(name);
    if (!filePath) {
      throw new PersonaParseError(`User persona '${name}' not found in cache`);
    }
    return parseFileContent(name, fs.readFileSync(filePath, 'utf-8'), this.mcpBaseDir);
  }

  render(name: string, engine: TemplateEngine, context: TemplateContext): string {
    // TemplateEngine searches its dirs in order; user dirs are listed first,
    // so `${name}.md` resolves to the user file when present.
    return engine.render(`${name}.md`, context);
  }
}

// ── Plugin source ─────────────────────────────────────────────────────────────

/**
 * Persona source backed by the plugin registry (registries.personas).
 * Plugin personas arrive pre-parsed and do NOT go through resolveMcpPaths.
 * `render` uses engine.renderString because plugin persona bodies are in-memory.
 */
class PluginSource implements PersonaSource {
  readonly kind = 'plugin' as const;
  readonly isUserDefined = false;

  has(name: string): boolean {
    return pluginRegistries.personas.has(name);
  }

  names(): string[] {
    return pluginRegistries.personas.names();
  }

  displayPath(name: string): string {
    return `plugin:${name}`;
  }

  parse(name: string): ParsedPersona {
    return pluginRegistries.personas.resolve(name);
  }

  render(name: string, engine: TemplateEngine, context: TemplateContext): string {
    return engine.renderString(this.parse(name).body, context);
  }
}

// ── Bundled source ────────────────────────────────────────────────────────────

/**
 * Persona source backed by the bundled (embedded) persona files.
 * `render` delegates to engine.render so @path includes and the Bun-embedded
 * fallback both work correctly.
 */
class BundledSource implements PersonaSource {
  readonly kind = 'bundled' as const;
  readonly isUserDefined = false;

  constructor(
    private readonly getCache: () => Set<string>,
    private readonly bundledPersonasPath: string,
    private readonly mcpBaseDir: string | undefined
  ) {}

  has(name: string): boolean {
    return this.getCache().has(name);
  }

  names(): string[] {
    return Array.from(this.getCache());
  }

  displayPath(name: string): string {
    return `${name}.md`;
  }

  parse(name: string): ParsedPersona {
    const raw = readBundledPersonaContent(name, this.bundledPersonasPath);
    return parseFileContent(name, raw, this.mcpBaseDir);
  }

  render(name: string, engine: TemplateEngine, context: TemplateContext): string {
    return engine.render(`${name}.md`, context);
  }
}

// ── Bundled file reader ───────────────────────────────────────────────────────

/** Reads raw persona content from the bundled filesystem path or Bun embedded files. */
function readBundledPersonaContent(name: string, bundledPersonasPath: string): string {
  const bundledFsPath = path.join(bundledPersonasPath, `${name}.md`);
  if (fs.existsSync(bundledFsPath)) {
    return fs.readFileSync(bundledFsPath, 'utf-8');
  }

  // Bun embedded files fallback (production standalone). Sync-over-async to match TemplateEngine.
  if (typeof Bun !== 'undefined' && 'embeddedFiles' in Bun && Bun.embeddedFiles) {
    const suffix = `agent-personas/${name}.md`;
    for (const file of Bun.embeddedFiles) {
      if ((file as File).name.endsWith(suffix)) {
        return readEmbeddedFileSync(file);
      }
    }
  }

  throw new PersonaParseError(`Could not locate persona file for '${name}'`);
}

// ── PersonaRegistry ───────────────────────────────────────────────────────────

export class PersonaRegistry {
  private bundledPersonasCache: Set<string> = new Set();
  private userPersonasCache: Map<string, string> = new Map(); // name -> resolved path
  private userCacheExpiry = 0;
  private readonly USER_CACHE_TTL = 5000; // 5 seconds
  private readonly bundledPersonasPath: string;
  private readonly userPersonasPaths: readonly string[];
  private readonly mcpBaseDir: string | undefined;

  // Precedence-ordered sources: user > plugin > bundled.
  private readonly sources: PersonaSource[];

  constructor(opts: PersonaRegistryOptions) {
    this.bundledPersonasPath = opts.bundledPersonasPath;
    this.userPersonasPaths = opts.userPersonasPaths;
    this.mcpBaseDir = opts.mcpBaseDir;

    this.sources = [
      new UserDiskSource(() => this.userPersonasCache, this.mcpBaseDir),
      new PluginSource(),
      new BundledSource(() => this.bundledPersonasCache, this.bundledPersonasPath, this.mcpBaseDir),
    ];

    this.loadBundledPersonas();
  }

  /** Embedder package root for resolving relative host-placement MCP paths. */
  getMcpBaseDir(): string | undefined {
    return this.mcpBaseDir;
  }

  /** Ordered list of user persona search paths (earlier wins). */
  getUserPersonasPaths(): readonly string[] {
    return this.userPersonasPaths;
  }

  /** Filesystem path containing bundled personas (used as template overlay). */
  getBundledPersonasPath(): string {
    return this.bundledPersonasPath;
  }

  private loadBundledPersonas(): void {
    try {
      // Use shared utility to scan for persona files
      const personaFiles = scanEmbeddedFiles(
        'config/agent-personas',
        '.md',
        this.bundledPersonasPath
      );

      // Filter out section files and add to cache
      for (const file of personaFiles) {
        if (!file.fullPath.includes('/sections/')) {
          this.bundledPersonasCache.add(file.name);
        }
      }
    } catch (error) {
      // Bundled personas should always exist, but handle gracefully
      logger.warn('Failed to load bundled personas', {
        error: error instanceof Error ? error.message : String(error),
        bundledPersonasPath: this.bundledPersonasPath,
      });
    }
  }

  private loadUserPersonas(): void {
    const now = Date.now();
    if (now < this.userCacheExpiry) {
      return; // Cache still valid
    }

    this.userPersonasCache.clear();

    // Track whether any configured path was actually scannable. When none
    // were (e.g. a Docker mount or symlink target had not appeared yet),
    // we skip setting userCacheExpiry so the next call re-scans instead
    // of locking in an empty result for USER_CACHE_TTL (kata #55).
    let anyPathScanned = false;

    // Earlier paths win: only set a persona name if not already mapped from an earlier path.
    for (const userPersonasPath of this.userPersonasPaths) {
      try {
        if (!fs.existsSync(userPersonasPath)) continue;
        const files = fs.readdirSync(userPersonasPath);
        anyPathScanned = true;
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const name = file.slice(0, -3);
          if (!this.userPersonasCache.has(name)) {
            this.userPersonasCache.set(name, path.join(userPersonasPath, file));
          }
        }
      } catch (error) {
        // Path may not exist or be readable; skip and continue with remaining paths.
        // Log at debug so a misbehaving mount/symlink can be diagnosed.
        logger.debug('User persona path scan failed', {
          userPersonasPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (anyPathScanned || this.userPersonasPaths.length === 0) {
      this.userCacheExpiry = now + this.USER_CACHE_TTL;
    }
  }

  /**
   * Get all available personas (user personas override built-in ones)
   */
  listAvailablePersonas(): PersonaInfo[] {
    this.loadUserPersonas();

    const personas: PersonaInfo[] = [];
    const seen = new Set<string>();

    for (const source of this.sources) {
      for (const name of source.names()) {
        if (seen.has(name)) continue;
        seen.add(name);
        personas.push({
          name,
          isUserDefined: source.isUserDefined,
          path: source.displayPath(name),
        });
      }
    }

    return personas.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Check if a persona exists
   */
  hasPersona(name: string): boolean {
    this.loadUserPersonas();
    return this.sources.some((s) => s.has(name));
  }

  /**
   * Validate persona exists, throw helpful error if not
   */
  validatePersona(name: string): void {
    if (!this.hasPersona(name)) {
      const available = this.listAvailablePersonas().map((p) => p.name);
      throw new PersonaNotFoundError(name, available);
    }
  }

  /**
   * Parse a persona file into its frontmatter config and template body.
   * User personas override bundled. Plugin personas slot between user-disk and bundled.
   * Frontmatter is optional; absent ⇒ config = {}.
   */
  parsePersona(name: string): ParsedPersona {
    this.loadUserPersonas();
    for (const source of this.sources) {
      if (source.has(name)) {
        return source.parse(name);
      }
    }
    const available = this.listAvailablePersonas().map((p) => p.name);
    throw new PersonaNotFoundError(name, available);
  }

  /**
   * Render the named persona's template body with the given context.
   * Dispatches to the winning source's render method — no path-string sniffing.
   * Throws PersonaNotFoundError if the persona does not exist.
   */
  render(name: string, engine: TemplateEngine, context: TemplateContext): string {
    this.loadUserPersonas();
    for (const source of this.sources) {
      if (source.has(name)) {
        return source.render(name, engine, context);
      }
    }
    const available = this.listAvailablePersonas().map((p) => p.name);
    throw new PersonaNotFoundError(name, available);
  }
}

// Sync-over-async embedded-file read; mirrors TemplateEngine's pattern.
function readEmbeddedFileSync(file: unknown): string {
  let content = '';
  let resolved = false;
  let error: Error | null = null;
  (file as { text: () => Promise<string> })
    .text()
    .then((t) => {
      content = t;
      resolved = true;
    })
    .catch((e) => {
      error = e instanceof Error ? e : new Error(String(e));
      resolved = true;
    });
  while (!resolved) {
    spawnSync('sleep', ['0.001']);
  }
  if (error) throw error;
  return content;
}

// Singleton convenience for non-embedder callers; embedders may construct their own registry.
const bundledPersonasPath = resolveResourcePath(import.meta.url, 'agent-personas');

export const personaRegistry = new PersonaRegistry({
  bundledPersonasPath,
  userPersonasPaths: [path.join(getLaceDir(), 'agent-personas')],
});
