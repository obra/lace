import { z } from 'zod';
import { buildLegacyRuntimeId } from './identity';
import { normalizeImagePlatform, validateResolvedImageDigest } from './image-identity';
import type { RuntimeExecutionBinding } from './types';
import { relative, resolve } from 'node:path';

const sep = '/';

function isAbsolutePath(input: string): boolean {
  return input.startsWith(sep);
}

function pathIsInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolutePath(relativePath))
  );
}

function migrateWorkspaceCwd(input: {
  projectRoot: string;
  workspaceRoot: string;
  cwd: string;
}): string {
  const workspaceRoot = resolve(input.workspaceRoot);
  const cwd = resolve(input.cwd);
  if (pathIsInside(workspaceRoot, cwd)) return cwd;

  const projectRoot = resolve(input.projectRoot);
  if (pathIsInside(projectRoot, cwd)) {
    return resolve(workspaceRoot, relative(projectRoot, cwd));
  }

  throw new Error(`Cannot migrate workspace runtime cwd outside workspace root: ${input.cwd}`);
}

const RuntimeSecretReferenceSchema = z
  .object({
    namespace: z.enum(['session', 'project', 'host-service']),
    name: z.string().min(1),
  })
  .strict();

const HostRuntimeDescriptorSchema = z
  .object({ type: z.literal('host'), cwd: z.string().min(1) })
  .strict();

const BoundedHostRuntimeDescriptorSchema = z
  .object({
    type: z.literal('boundedHost'),
    root: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();

const LegacyLocalRuntimeDescriptorSchema = z
  .object({ type: z.literal('local'), cwd: z.string().min(1) })
  .strict();

const LegacyWorkspaceRuntimeDescriptorSchema = z
  .object({
    type: z.literal('workspace'),
    projectRoot: z.string().min(1),
    workspaceRoot: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();

const ContainerRuntimeDescriptorSchema = z
  .object({
    type: z.literal('container'),
    cwd: z.string().min(1),
    spec: z
      .object({
        name: z.string().min(1),
        containerId: z.string().min(1).optional(),
        requestedImage: z.string().min(1),
        resolvedImageDigest: z.string().min(1).transform(validateResolvedImageDigest),
        imagePlatform: z.string().min(1).transform(normalizeImagePlatform),
        workingDirectory: z.string().min(1),
        mounts: z.array(
          z
            .object({
              hostPath: z.string().min(1),
              containerPath: z.string().min(1),
              readonly: z.boolean(),
            })
            .strict()
        ),
        env: z.record(z.string(), z.string()).optional(),
        secretEnv: z.record(z.string(), RuntimeSecretReferenceSchema).optional(),
        ports: z
          .array(z.object({ host: z.number().int(), container: z.number().int() }).strict())
          .optional(),
        restartPolicy: z.literal('unless-stopped').optional(),
      })
      .strict(),
    helper: z
      .object({
        mode: z.enum(['copy', 'mount', 'image']),
        hostPath: z.string().min(1).optional(),
        containerPath: z.string().min(1),
        command: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
  })
  .strict();

const RuntimeExecutionBindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z.object({ runtimeId: z.string().min(1) }).strict(),
    agentPlacement: z.enum(['host', 'container']),
    toolRuntime: z.discriminatedUnion('type', [
      HostRuntimeDescriptorSchema,
      BoundedHostRuntimeDescriptorSchema,
      LegacyLocalRuntimeDescriptorSchema,
      LegacyWorkspaceRuntimeDescriptorSchema,
      ContainerRuntimeDescriptorSchema,
    ]),
  })
  .strict();

type ParsedRuntimeExecutionBinding = z.infer<typeof RuntimeExecutionBindingSchema>;

function parseRuntimeExecutionBindingFromSchema(value: unknown): ParsedRuntimeExecutionBinding {
  const version =
    value && typeof value === 'object'
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version !== 1) {
    throw new Error(`Unsupported runtime binding version: ${String(version)}`);
  }
  const parsed = RuntimeExecutionBindingSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(`Invalid runtime binding: ${parsed.error.message}`);
}

function normalizeMigrationBinding(parsed: ParsedRuntimeExecutionBinding): RuntimeExecutionBinding {
  if (parsed.toolRuntime.type === 'local') {
    return {
      ...parsed,
      toolRuntime: {
        type: 'boundedHost',
        root: parsed.toolRuntime.cwd,
        cwd: parsed.toolRuntime.cwd,
      },
    };
  }

  if (parsed.toolRuntime.type === 'workspace') {
    const cwd = migrateWorkspaceCwd({
      projectRoot: parsed.toolRuntime.projectRoot,
      workspaceRoot: parsed.toolRuntime.workspaceRoot,
      cwd: parsed.toolRuntime.cwd,
    });
    return {
      ...parsed,
      toolRuntime: {
        type: 'boundedHost',
        root: parsed.toolRuntime.workspaceRoot,
        cwd,
      },
    };
  }

  return parsed as RuntimeExecutionBinding;
}

export function buildDefaultBoundedHostRuntimeBinding(input: {
  sessionId: string;
  cwd: string;
}): RuntimeExecutionBinding {
  const binding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'pending' },
    agentPlacement: 'host',
    toolRuntime: { type: 'boundedHost', root: input.cwd, cwd: input.cwd },
  };
  return {
    ...binding,
    identity: {
      runtimeId: buildLegacyRuntimeId({
        scope: 'session',
        sessionId: input.sessionId,
        binding,
      }),
    },
  };
}

export function parseRuntimeExecutionBinding(value: unknown): RuntimeExecutionBinding {
  const parsed = parseRuntimeExecutionBindingFromSchema(value);
  return normalizeMigrationBinding(parsed);
}
