// ABOUTME: Wire protocol for the persona-spawn broker's unix-socket JSON requests/responses
// ABOUTME: Caller controls the spec ONLY via persona at spawn; every other field is broker-built

import { z } from 'zod';
import type { ContainerState, ContainerMount } from './types';
import { PERSONA_NAMES } from './persona-registry';

// The closed set of personas a caller may ask the broker to spawn. The broker
// owns the Docker socket and builds the FULL container spec from its registry;
// the caller cannot supply image/mounts/network/etc. — see the spawn request
// schema below. PERSONA_NAMES is the single source of truth (persona-registry.ts).
const personaNameSchema = z.enum(PERSONA_NAMES);

// Broker-issued container name. The broker generates it at spawn time and the
// caller echoes it back on every subsequent verb; it is never a spec field.
const containerNameSchema = z.string().min(1);

// SECURITY-CRITICAL: a spawn request carries ONLY the persona and the per-spawn
// identifiers. `.strict()` makes ANY additional key (mounts, volumes, image,
// command, env/environment, network, privileged, capAdd, sysctls, gatewayRoute,
// ports, or anything unknown) a parse failure. This is the whole point of the
// broker: the caller has zero degrees of freedom over the container spec. The
// broker socket is reachable by the caller's (adversarial) bash, so NOTHING the
// caller sends may shape the spec — only select a registry-locked persona.
const spawnRequestSchema = z
  .object({
    op: z.literal('spawn'),
    persona: personaNameSchema,
    sessionId: z.string().min(1),
    jobId: z.string().min(1),
  })
  .strict();

const environmentModeSchema = z.enum(['inherit', 'replace']);

// execStream carries the agent's per-tool-call command + environment — the agent
// loop runs in the caller's process and execs each tool call into the persona
// container (projected-container.ts). The closed surface is SPAWN (the spec); an
// exec command is NOT a containment risk because the persona container holds no
// privileged broker state — running arbitrary commands inside it is exactly the
// subagent's existing authority. The broker gates this by container-OWNERSHIP
// (it execs only into persona containers it spawned, never the helper/arbiter).
// `.strict()` still rejects any SPEC-bearing key (mounts/image/network/...) — those
// belong only to spawn. `jobId` is required for per-job egress-audit attribution
// (soft-trust: forging it only pollutes the caller's own audit; persona identity is
// registry-truth). The broker mints+injects SEN_AGENT_TOKEN itself and strips any
// caller-supplied token from `environment` — the caller never controls identity.
const execStreamRequestSchema = z
  .object({
    op: z.literal('execStream'),
    containerName: containerNameSchema,
    command: z.array(z.string()).min(1),
    environment: z.record(z.string(), z.string()).optional(),
    workingDirectory: z.string().optional(),
    environmentMode: environmentModeSchema.optional(),
    jobId: z.string().min(1),
  })
  .strict();

const stopRequestSchema = z
  .object({
    op: z.literal('stop'),
    containerName: containerNameSchema,
    timeoutSeconds: z.number().int().nonnegative().optional(),
  })
  .strict();

const destroyRequestSchema = z
  .object({
    op: z.literal('destroy'),
    containerName: containerNameSchema,
  })
  .strict();

const statusRequestSchema = z
  .object({
    op: z.literal('status'),
    containerName: containerNameSchema,
  })
  .strict();

// Reattach an existing persistent-box after a broker/host restart. The broker
// rebuilds the config from its own registry (the persona is recovered from its
// ownership record / the stable name), so adopt — like spawn — takes no spec.
const adoptRequestSchema = z
  .object({
    op: z.literal('adopt'),
    containerName: containerNameSchema,
  })
  .strict();

// Ownership-scoped: the broker returns only the containers it spawned for this
// caller. Carries no fields.
const listRequestSchema = z
  .object({
    op: z.literal('list'),
  })
  .strict();

export const spawnBrokerRequestSchema = z.discriminatedUnion('op', [
  spawnRequestSchema,
  execStreamRequestSchema,
  stopRequestSchema,
  destroyRequestSchema,
  statusRequestSchema,
  adoptRequestSchema,
  listRequestSchema,
]);

export type SpawnRequest = z.infer<typeof spawnRequestSchema>;
export type ExecStreamRequest = z.infer<typeof execStreamRequestSchema>;
export type StopRequest = z.infer<typeof stopRequestSchema>;
export type DestroyRequest = z.infer<typeof destroyRequestSchema>;
export type StatusRequest = z.infer<typeof statusRequestSchema>;
export type AdoptRequest = z.infer<typeof adoptRequestSchema>;
export type ListRequest = z.infer<typeof listRequestSchema>;
export type SpawnBrokerRequest = z.infer<typeof spawnBrokerRequestSchema>;

export class SpawnBrokerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpawnBrokerProtocolError';
  }
}

/**
 * Validate + narrow an untrusted JSON value into a SpawnBrokerRequest. Throws
 * SpawnBrokerProtocolError on anything invalid — unknown op, missing fields,
 * unknown persona, or (critically) any extra key on a spawn request that would
 * let the caller influence the container spec, or any SPEC key smuggled onto an
 * execStream request.
 *
 * For execStream this validates the leading JSON control frame only; the raw
 * stdio bytes that follow on the dedicated connection are handled by the
 * transport, not this parser.
 */
export function parseSpawnBrokerRequest(raw: unknown): SpawnBrokerRequest {
  const result = spawnBrokerRequestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new SpawnBrokerProtocolError(`invalid spawn-broker request: ${issues}`);
  }
  return result.data;
}

// Response shapes — a discriminated result per verb. Kept minimal and typed.
// `error` carries a broker-side message safe to surface to the caller (no
// secrets / no raw daemon stderr — the broker is responsible for that boundary).

// Container metadata the broker exposes back to the caller. `mounts` are the
// broker-resolved host→container bind mounts (host paths for scratch/home/
// knowledge/identity — never credential surfaces), so the caller's runtime can
// populate its mountMap for host-direct file-tool path translation.
export interface WireContainerInfo {
  id: string;
  state: ContainerState;
  exitCode?: number;
  mounts?: ContainerMount[];
}

export type SpawnResponse =
  | { ok: true; containerName: string; state: ContainerState; resolvedMounts: ContainerMount[] }
  | { ok: false; error: string };

// execStream's terminal frame, sent after stdio closes on the dedicated
// connection. The intermediate stdout/stderr/stdin bytes are not modeled here.
export type ExecStreamResult = { ok: true; exitCode: number } | { ok: false; error: string };

export type StopResponse = { ok: true } | { ok: false; error: string };

export type DestroyResponse = { ok: true } | { ok: false; error: string };

export type StatusResponse =
  | { ok: true; exists: true; info: WireContainerInfo }
  | { ok: true; exists: false }
  | { ok: false; error: string };

export type AdoptResponse =
  | { ok: true; containerName: string; state: ContainerState; resolvedMounts: ContainerMount[] }
  | { ok: false; error: string };

export type ListResponse =
  | { ok: true; containers: WireContainerInfo[] }
  | { ok: false; error: string };

export interface SpawnBrokerResponseByOp {
  spawn: SpawnResponse;
  execStream: ExecStreamResult;
  stop: StopResponse;
  destroy: DestroyResponse;
  status: StatusResponse;
  adopt: AdoptResponse;
  list: ListResponse;
}
