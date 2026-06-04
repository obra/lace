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
import { personaDirs } from '@lace/agent/plugins';
import { TemplateEngine, type TemplateContext } from './template-engine';

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
    host: z.number().int().min(0).max(65535),
    container: z.number().int().min(0).max(65535),
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

/**
 * Coupled to sen-core-v2/sen-docker/src/persona.rs `PersonaSpec`: container
 * runtime frontmatter is the single-source `.md` schema consumed by both lace
 * and the plane. Future edits to these runtime fields need plane round-trip
 * tests because Rust deserializes the same `runtime:` mapping with
 * `deny_unknown_fields`.
 */
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
    browserCdpSocket: z.boolean().optional().default(false),
    // Linux kernel sysctls for runtimes that directly materialize persona
    // containers. Lace projected persona specs omit this docker authority; the
    // plane rebuilds it from the persona.
    sysctls: z.record(sysctlKeySchema, z.string()).optional(),
    // Linux capabilities for runtimes that directly materialize persona
    // containers. Lace projected persona specs omit this docker authority.
    capAdd: z.array(z.string().regex(/^[A-Z_]+$/)).optional(),
    // Docker network name for runtimes that directly materialize persona
    // containers. Lace projected persona specs carry selectors instead.
    network: z.string().min(1).optional(),
    // IPv4 address of the egress gateway broker.
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
          .array(
            z
              .object({ at: z.number().min(0).max(1), action: z.enum(['notify', 'compact']) })
              .strict()
          )
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
 *
 * Rendering is source-scoped: each source owns its own TemplateEngine rooted
 * at its directory, so @sections includes and other path references resolve
 * from the source's own dir (not a shared engine). Pass only context.
 */
export interface PersonaSource {
  readonly kind: 'user' | 'plugin' | 'bundled';
  readonly isUserDefined: boolean;
  has(name: string): boolean;
  names(): string[];
  /** Real disk path for PersonaInfo.path. */
  displayPath(name: string): string;
  parse(name: string): ParsedPersona;
  /** Source-scoped render — the engine is owned by the source. */
  render(name: string, context: TemplateContext): string;
  /**
   * Returns the per-persona resource dir (<sourceDir>/<entry>/<kind>) if it
   * exists on disk, else null.
   */
  resourceDir(name: string, kind: 'tools' | 'skills'): string | null;
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

// ── File-dir source ───────────────────────────────────────────────────────────

interface FileDirSourceOptions {
  dir: string;
  namespace?: string; // present for plugin sources; absent for user sources
  isUserDefined: boolean;
  kind: 'user' | 'plugin';
  mcpBaseDir?: string;
  /**
   * For user sources the registry supplies a callback returning the shared
   * (name → absolute path) cache maintained by PersonaRegistry. The source
   * filters the shared cache to entries whose path is inside its own `dir`,
   * so each user FileDirSource only claims the names it actually owns.
   * For plugin sources this is omitted; the source manages its own discovery.
   */
  getSharedCache?: () => Map<string, string>;
}

/**
 * Persona source backed by a single on-disk directory.
 *
 * Logical name:
 *   - plugin dir (namespace present): `${namespace}:${entry}`
 *   - user dir (no namespace):        `${entry}`
 *
 * Rendering is source-scoped: owns a `TemplateEngine` rooted at `dir` with
 * `useEmbedded:false`, so @sections includes resolve from this dir only and
 * never fall through to bundled embedded files.
 *
 * For user dirs the shared cache (managed by PersonaRegistry with TTL/rescan)
 * is filtered to paths inside this dir, preserving first-wins semantics across
 * multiple user dirs while keeping each source's rendering within its own dir.
 */
class FileDirSource implements PersonaSource {
  readonly kind: 'user' | 'plugin';
  readonly isUserDefined: boolean;

  private readonly dir: string;
  private readonly namespace: string | undefined;
  private readonly mcpBaseDir: string | undefined;
  private readonly engine: TemplateEngine;
  // Callback into the shared user-personas cache (user sources only).
  private readonly getSharedCache: (() => Map<string, string>) | undefined;
  // Own cache for plugin dirs (static, no TTL needed).
  private ownCache: Map<string, string> | null = null;

  constructor(opts: FileDirSourceOptions) {
    this.kind = opts.kind;
    this.isUserDefined = opts.isUserDefined;
    this.dir = path.resolve(opts.dir); // normalise to absolute
    this.namespace = opts.namespace;
    this.mcpBaseDir = opts.mcpBaseDir;
    this.getSharedCache = opts.getSharedCache;
    this.engine = new TemplateEngine([opts.dir], { useEmbedded: false });
  }

  private logicalName(entry: string): string {
    return this.namespace ? `${this.namespace}:${entry}` : entry;
  }

  /** Entry filename stem from a logical name (strips `namespace:` prefix). */
  private entryOf(name: string): string {
    return this.namespace ? name.slice(this.namespace.length + 1) : name;
  }

  /**
   * Returns the entries that belong to this source's own directory.
   * For user sources: filters the shared cache to paths inside `this.dir`.
   * For plugin sources: uses the lazily-populated own cache.
   */
  private ownEntries(): Map<string, string> {
    if (this.getSharedCache) {
      // Filter the shared cache: only claim names whose file path lives under
      // this dir. This gives each user-dir source its own slice of names.
      const shared = this.getSharedCache();
      const result = new Map<string, string>();
      for (const [name, filePath] of shared) {
        if (filePath.startsWith(this.dir + path.sep) || filePath.startsWith(this.dir + '/')) {
          result.set(name, filePath);
        }
      }
      return result;
    }
    if (!this.ownCache) this.ownCache = this.scanDir();
    return this.ownCache;
  }

  private scanDir(): Map<string, string> {
    const result = new Map<string, string>();
    try {
      if (!fs.existsSync(this.dir)) return result;
      for (const file of fs.readdirSync(this.dir)) {
        if (!file.endsWith('.md')) continue;
        const entry = file.slice(0, -3);
        result.set(this.logicalName(entry), path.join(this.dir, file));
      }
    } catch (error) {
      logger.debug('Persona dir scan failed', {
        dir: this.dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return result;
  }

  has(name: string): boolean {
    return this.ownEntries().has(name);
  }

  names(): string[] {
    return Array.from(this.ownEntries().keys());
  }

  displayPath(name: string): string {
    return this.ownEntries().get(name) ?? path.join(this.dir, `${this.entryOf(name)}.md`);
  }

  parse(name: string): ParsedPersona {
    const filePath = this.ownEntries().get(name);
    if (!filePath) {
      throw new PersonaParseError(`Persona '${name}' not found in dir ${this.dir}`);
    }
    return parseFileContent(name, fs.readFileSync(filePath, 'utf-8'), this.mcpBaseDir);
  }

  render(name: string, context: TemplateContext): string {
    const entry = this.entryOf(name);
    return this.engine.render(`${entry}.md`, context);
  }

  resourceDir(name: string, kind: 'tools' | 'skills'): string | null {
    const entry = this.entryOf(name);
    const dir = path.join(this.dir, entry, kind);
    return fs.existsSync(dir) ? dir : null;
  }
}

// ── Bundled source ────────────────────────────────────────────────────────────

/**
 * Persona source backed by the bundled (embedded) persona files.
 * Owns an embedded-on TemplateEngine so that @path includes in bundled
 * templates resolve from Bun's embedded file set in production builds.
 * In development (useEmbedded:false would miss them), the engine also has
 * the bundledPersonasPath on its FS search dirs.
 */
class BundledSource implements PersonaSource {
  readonly kind = 'bundled' as const;
  readonly isUserDefined = false;

  private readonly engine: TemplateEngine;

  constructor(
    private readonly getCache: () => Set<string>,
    private readonly bundledPersonasPath: string,
    private readonly mcpBaseDir: string | undefined
  ) {
    // useEmbedded:true so Bun embedded files are checked first; FS fallback
    // handles the development case where files are on disk.
    this.engine = new TemplateEngine([bundledPersonasPath], { useEmbedded: true });
  }

  has(name: string): boolean {
    return this.getCache().has(name);
  }

  names(): string[] {
    return Array.from(this.getCache());
  }

  displayPath(name: string): string {
    return path.join(this.bundledPersonasPath, `${name}.md`);
  }

  parse(name: string): ParsedPersona {
    const raw = readBundledPersonaContent(name, this.bundledPersonasPath);
    return parseFileContent(name, raw, this.mcpBaseDir);
  }

  render(name: string, context: TemplateContext): string {
    return this.engine.render(`${name}.md`, context);
  }

  resourceDir(name: string, kind: 'tools' | 'skills'): string | null {
    const dir = path.join(this.bundledPersonasPath, name, kind);
    return fs.existsSync(dir) ? dir : null;
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
  // Plugin FileDirSources are appended between the user FileDirSources and the
  // BundledSource during construction; they use personaDirs() which is populated
  // by plugin loaders before the registry is used.
  private readonly sources: PersonaSource[];

  constructor(opts: PersonaRegistryOptions) {
    this.bundledPersonasPath = opts.bundledPersonasPath;
    this.userPersonasPaths = opts.userPersonasPaths;
    this.mcpBaseDir = opts.mcpBaseDir;

    // One FileDirSource per user path (no namespace, user-defined, TTL cache
    // owned by PersonaRegistry and shared via callback filtered by dir).
    const userSources: FileDirSource[] = opts.userPersonasPaths.map(
      (dir) =>
        new FileDirSource({
          dir,
          isUserDefined: true,
          kind: 'user',
          mcpBaseDir: opts.mcpBaseDir,
          getSharedCache: () => this.userPersonasCache,
        })
    );

    // One FileDirSource per plugin-contributed dir (namespaced, not user-defined).
    // personaDirs() is read once at construction time — plugin dirs are static.
    const pluginSources: FileDirSource[] = personaDirs().map(
      ({ namespace, dir }) =>
        new FileDirSource({
          dir,
          namespace,
          isUserDefined: false,
          kind: 'plugin',
          mcpBaseDir: opts.mcpBaseDir,
        })
    );

    this.sources = [
      ...userSources,
      ...pluginSources,
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
   * Each source renders with its own scoped TemplateEngine, so @sections and
   * @path includes resolve from the source's own directory.
   * Throws PersonaNotFoundError if the persona does not exist.
   */
  renderPersona(name: string, context: TemplateContext): string {
    this.loadUserPersonas();
    for (const source of this.sources) {
      if (source.has(name)) {
        return source.render(name, context);
      }
    }
    const available = this.listAvailablePersonas().map((p) => p.name);
    throw new PersonaNotFoundError(name, available);
  }

  /**
   * Returns the tools directory for the named persona
   * (`<sourceDir>/<entry>/tools/`) if it exists on disk, else null.
   */
  personaToolsDir(name: string): string | null {
    this.loadUserPersonas();
    for (const source of this.sources) {
      if (source.has(name)) {
        return source.resourceDir(name, 'tools');
      }
    }
    return null;
  }

  /**
   * Returns the skills directory for the named persona
   * (`<sourceDir>/<entry>/skills/`) if it exists on disk, else null.
   */
  personaSkillsDir(name: string): string | null {
    this.loadUserPersonas();
    for (const source of this.sources) {
      if (source.has(name)) {
        return source.resourceDir(name, 'skills');
      }
    }
    return null;
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
