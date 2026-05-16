// ABOUTME: Service for discovering and validating agent personas
// ABOUTME: Handles both built-in (bundled) and user-defined persona files

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import matter from 'gray-matter';
import { z } from 'zod';
import { getLaceDir } from './lace-dir';
import { scanEmbeddedFiles, resolveResourcePath } from '@lace/agent/utils/resource-resolver';
import { logger } from '@lace/agent/utils/logger';

export interface PersonaInfo {
  name: string;
  isUserDefined: boolean;
  path: string;
}

// Per-server MCP tool config is opaque to lace and forwarded to the MCP layer.
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
          enabled: z.boolean().optional(),
          tools: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .optional(),
    workspace: z.enum(['local', 'worktree', 'container']).optional(),
    maxTurns: z.number().int().positive().optional(),
  })
  .strict();

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
}

export class PersonaRegistry {
  private bundledPersonasCache: Set<string> = new Set();
  private userPersonasCache: Map<string, string> = new Map(); // name -> resolved path
  private userCacheExpiry = 0;
  private readonly USER_CACHE_TTL = 5000; // 5 seconds
  private readonly bundledPersonasPath: string;
  private readonly userPersonasPaths: readonly string[];

  constructor(opts: PersonaRegistryOptions) {
    this.bundledPersonasPath = opts.bundledPersonasPath;
    this.userPersonasPaths = opts.userPersonasPaths;
    this.loadBundledPersonas();
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

    // Earlier paths win: only set a persona name if not already mapped from an earlier path.
    for (const userPersonasPath of this.userPersonasPaths) {
      try {
        if (!fs.existsSync(userPersonasPath)) continue;
        const files = fs.readdirSync(userPersonasPath);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const name = file.slice(0, -3);
          if (!this.userPersonasCache.has(name)) {
            this.userPersonasCache.set(name, path.join(userPersonasPath, file));
          }
        }
      } catch {
        // Path may not exist or be readable; skip silently and continue with remaining paths.
      }
    }

    this.userCacheExpiry = now + this.USER_CACHE_TTL;
  }

  /**
   * Get all available personas (user personas override built-in ones)
   */
  listAvailablePersonas(): PersonaInfo[] {
    this.loadUserPersonas();

    const personas: PersonaInfo[] = [];
    const seen = new Set<string>();

    // User personas first (they override built-ins)
    for (const [name, filePath] of this.userPersonasCache) {
      personas.push({ name, isUserDefined: true, path: filePath });
      seen.add(name);
    }

    // Built-in personas (only if not overridden)
    for (const name of this.bundledPersonasCache) {
      if (!seen.has(name)) {
        const logicalPath = this.getPersonaPath(name);
        personas.push({ name, isUserDefined: false, path: logicalPath || `${name}.md` });
      }
    }

    return personas.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Check if a persona exists
   */
  hasPersona(name: string): boolean {
    this.loadUserPersonas();
    return this.userPersonasCache.has(name) || this.bundledPersonasCache.has(name);
  }

  /**
   * Get path to a persona file (user overrides built-in)
   * Note: For built-in personas, returns logical path - actual loading handled by TemplateEngine
   */
  getPersonaPath(name: string): string | null {
    this.loadUserPersonas();

    // Check user personas first
    if (this.userPersonasCache.has(name)) {
      return this.userPersonasCache.get(name)!;
    }

    // Check built-in personas - return logical path
    if (this.bundledPersonasCache.has(name)) {
      return `${name}.md`; // TemplateEngine will resolve this in bundled or file mode
    }

    return null;
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
   * User personas override bundled. Frontmatter is optional; absent ⇒ config = {}.
   */
  parsePersona(name: string): ParsedPersona {
    this.validatePersona(name);

    const raw = this.readPersonaContent(name);

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

    return { config: validated.data, body: parsed.content };
  }

  // Reads raw persona file content. User overrides bundled; bundled falls back to embedded files.
  private readPersonaContent(name: string): string {
    this.loadUserPersonas();

    const userPath = this.userPersonasCache.get(name);
    if (userPath) {
      return fs.readFileSync(userPath, 'utf-8');
    }

    const bundledFsPath = path.join(this.bundledPersonasPath, `${name}.md`);
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
