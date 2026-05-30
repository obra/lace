import { z } from 'zod';
import { buildRuntimeId } from './identity';
import type { RuntimeExecutionBinding } from './types';

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

const ContainerRuntimeDescriptorSchema = z
  .object({
    type: z.literal('container'),
    cwd: z.string().min(1),
    spec: z
      .object({
        name: z.string().min(1),
        containerId: z.string().min(1).optional(),
        image: z.string().min(1),
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
        // PRI-1790: forwarded verbatim to `docker create --sysctl key=value`.
        // Validated as opaque key/value pairs at this layer — the persona
        // schema enforces the dot-separated key shape upstream.
        sysctls: z.record(z.string(), z.string()).optional(),
        // PRI-1919: forwarded to `docker create --cap-add <cap>` per entry.
        capAdd: z.array(z.string().min(1)).optional(),
        // PRI-1919: forwarded to `docker create --network <name>`.
        network: z.string().min(1).optional(),
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
    toolRuntime: z.discriminatedUnion('type', [
      HostRuntimeDescriptorSchema,
      BoundedHostRuntimeDescriptorSchema,
      ContainerRuntimeDescriptorSchema,
    ]),
    // Present on persona container bindings; absent on host/bounded-host bindings.
    // Lets post-exit handlers branch on lifecycle without inspecting toolRuntime (PRI-1796).
    containerSharing: z.enum(['per_invocation', 'persistent']).optional(),
  })
  .strict();

export function buildDefaultBoundedHostRuntimeBinding(input: {
  sessionId: string;
  cwd: string;
}): RuntimeExecutionBinding {
  const binding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'pending' },
    toolRuntime: { type: 'boundedHost', root: input.cwd, cwd: input.cwd },
  };
  return {
    ...binding,
    identity: {
      runtimeId: buildRuntimeId({
        scope: 'session',
        sessionId: input.sessionId,
        binding,
      }),
    },
  };
}

export function parseRuntimeExecutionBinding(value: unknown): RuntimeExecutionBinding {
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
