// ABOUTME: Discovers + parses environment definitions (container specs) from disk
// ABOUTME: Same runtime frontmatter the sen-docker shim parses; roles reference these by name

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { getLaceDir } from './lace-dir';

// The environment def's `runtime:` block is the container spec the shim builds
// from: image, mounts, caps, network, persistence. This is the SAME field set
// the role persona used to carry inline (pre Part A); it now lives in a separate
// environment file referenced by name. Coupled to sen-docker/src/persona.rs
// PersonaSpec (deny_unknown_fields) — edits here need a plane round-trip.
const mountNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
const portMappingSchema = z
  .object({
    host: z.number().int().min(0).max(65535),
    container: z.number().int().min(0).max(65535),
  })
  .strict();
const sysctlKeySchema = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);

const environmentRuntimeSchema = z
  .object({
    type: z.literal('container'),
    containerSharing: z.enum(['per_invocation', 'persistent']),
    image: z.string().min(1),
    workingDirectory: z.string().min(1),
    mounts: z.array(mountNameSchema),
    env: z.record(z.string(), z.string()).optional().default({}),
    ports: z.array(portMappingSchema).optional(),
    sysctls: z.record(sysctlKeySchema, z.string()).optional(),
    capAdd: z.array(z.string().regex(/^[A-Z_]+$/)).optional(),
    network: z.string().min(1).optional(),
    gatewayRoute: z.string().min(1).optional(),
    browserCdpSocket: z.boolean().optional(),
    user: z.string().min(1).optional(),
  })
  .strict();

const environmentConfigSchema = z
  .object({ runtime: environmentRuntimeSchema })
  .strict()
  .superRefine((config, ctx) => {
    if (config.runtime.containerSharing === 'persistent' && config.runtime.ports?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runtime', 'ports'],
        message: 'persistent environments do not support host ports',
      });
    }
  });

export type EnvironmentRuntime = z.infer<typeof environmentRuntimeSchema>;
export interface ParsedEnvironment {
  readonly runtime: EnvironmentRuntime;
}

export class EnvironmentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentParseError';
  }
}

export class EnvironmentNotFoundError extends Error {
  public readonly environmentName: string;
  public readonly available: string[];
  constructor(environmentName: string, available: string[]) {
    super(
      `Environment '${environmentName}' not found. Available environments: ${available.join(', ')}`
    );
    this.name = 'EnvironmentNotFoundError';
    this.environmentName = environmentName;
    this.available = available;
  }
}

export interface EnvironmentRegistryOptions {
  // Ordered: earlier paths win.
  environmentsPaths: readonly string[];
}

export class EnvironmentRegistry {
  private readonly environmentsPaths: readonly string[];

  constructor(opts: EnvironmentRegistryOptions) {
    this.environmentsPaths = opts.environmentsPaths;
  }

  /** Ordered list of environment search paths (earlier wins). */
  getEnvironmentsPaths(): readonly string[] {
    return this.environmentsPaths;
  }

  private resolvePath(name: string): string | undefined {
    for (const dir of this.environmentsPaths) {
      const candidate = path.join(dir, `${name}.md`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  listAvailable(): string[] {
    const seen = new Set<string>();
    for (const dir of this.environmentsPaths) {
      let files: string[];
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.endsWith('.md')) seen.add(file.slice(0, -3));
      }
    }
    return Array.from(seen).sort();
  }

  parseEnvironment(name: string): ParsedEnvironment {
    const filePath = this.resolvePath(name);
    if (!filePath) {
      throw new EnvironmentNotFoundError(name, this.listAvailable());
    }
    let raw: matter.GrayMatterFile<string>;
    try {
      raw = matter(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new EnvironmentParseError(
        `Failed to parse frontmatter for environment '${name}': ${msg}`
      );
    }
    const validated = environmentConfigSchema.safeParse(raw.data);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new EnvironmentParseError(`Invalid environment '${name}': ${issues}`);
    }
    return { runtime: validated.data.runtime };
  }
}

// Fallback singleton for non-embedder callers/tests. Embedders (sen-core) pass
// userEnvironmentsPaths via initialize; the handler builds the real registry.
export const environmentRegistry = new EnvironmentRegistry({
  environmentsPaths: [path.join(getLaceDir(), 'agent-environments')],
});
