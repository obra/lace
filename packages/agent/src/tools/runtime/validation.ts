import { z } from 'zod';
import { buildRuntimeId } from './identity';
import type { RuntimeExecutionBinding } from './types';

const CONTAINER_PLANE_SELECTOR_FIELDS = ['parentSession', 'childSession', 'jobId'] as const;
const CONTAINER_BROKER_SELECTOR_FIELDS = ['parentSessionId', 'childSessionId'] as const;
const CONTAINER_AUTHORITY_FIELDS = [
  'containerId',
  'ports',
  'restartPolicy',
  'sysctls',
  'capAdd',
  'network',
  'gatewayRoute',
] as const;

function hasDefinedField(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field) && value[field] !== undefined;
}

function hasPlaneSelector(value: Record<string, unknown>): boolean {
  const hasBrokerSelector = CONTAINER_BROKER_SELECTOR_FIELDS.some((field) =>
    hasDefinedField(value, field)
  );
  return (
    CONTAINER_PLANE_SELECTOR_FIELDS.some((field) => hasDefinedField(value, field)) ||
    (hasDefinedField(value, 'persona') && !hasBrokerSelector)
  );
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
        // Forwarded verbatim to `docker create --sysctl key=value`.
        // Validated as opaque key/value pairs at this layer — the persona
        // schema enforces the dot-separated key shape upstream.
        sysctls: z.record(z.string(), z.string()).optional(),
        // Forwarded to `docker create --cap-add <cap>` per entry.
        capAdd: z.array(z.string().min(1)).optional(),
        // Forwarded to `docker create --network <name>`.
        network: z.string().min(1).optional(),
        // IPv4 address of the egress gateway broker. Validated as a
        // non-empty string at this layer.
        gatewayRoute: z.string().min(1).optional(),
        // Shared selector field. The privileged runtime re-validates it.
        persona: z.string().min(1).optional(),
        // The spawned persona's role name, carried alongside `persona` (the
        // environment) for the credential helper's source-IP → role authz.
        role: z.string().min(1).optional(),
        // Spawn-broker selector fields. They MUST be allowed through this
        // .strict() runtime-binding validator or broker round-trips fail.
        parentSessionId: z.string().min(1).optional(),
        childSessionId: z.string().min(1).optional(),
        // Root A SELECTOR fields — carried for PlaneRuntime's create()->spawn.
        // MUST be in this .strict() schema or a plane binding fails validation
        // (bug-#7 class). SELECTOR ONLY; the plane re-validates persona.
        parentSession: z.string().min(1).optional(),
        childSession: z.string().min(1).optional(),
        jobId: z.string().min(1).optional(),
      })
      .strict()
      .superRefine((spec, ctx) => {
        const hasSelector = hasPlaneSelector(spec);
        const hasAuthority = CONTAINER_AUTHORITY_FIELDS.some((field) =>
          hasDefinedField(spec, field)
        );
        if (!hasSelector || !hasAuthority) return;

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Container selector fields cannot be combined with docker authority fields',
        });
      }),
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
    // Lets post-exit handlers branch on lifecycle without inspecting toolRuntime.
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
