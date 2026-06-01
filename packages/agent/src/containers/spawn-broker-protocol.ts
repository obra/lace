// ABOUTME: Wire protocol for the persona-spawn broker's unix-socket JSON requests/responses
// ABOUTME: Caller has ZERO control over the container spec — only persona + ids; broker builds the rest

import { z } from 'zod';
import type { ContainerState } from './types';
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
// broker: the caller has zero degrees of freedom over the container spec.
const spawnRequestSchema = z
  .object({
    op: z.literal('spawn'),
    persona: personaNameSchema,
    sessionId: z.string().min(1),
    jobId: z.string().min(1),
  })
  .strict();

// exec runs ONLY the persona's predefined command — there is deliberately NO
// caller-supplied command field. stdin is piped separately as DATA, not in this
// control frame. `.strict()` rejects a smuggled `command` key.
const execRequestSchema = z
  .object({
    op: z.literal('exec'),
    containerName: containerNameSchema,
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

// Reattach an existing persistent-box after a broker/host restart.
const adoptRequestSchema = z
  .object({
    op: z.literal('adopt'),
    containerName: containerNameSchema,
  })
  .strict();

export const spawnBrokerRequestSchema = z.discriminatedUnion('op', [
  spawnRequestSchema,
  execRequestSchema,
  stopRequestSchema,
  destroyRequestSchema,
  statusRequestSchema,
  adoptRequestSchema,
]);

export type SpawnRequest = z.infer<typeof spawnRequestSchema>;
export type ExecRequest = z.infer<typeof execRequestSchema>;
export type StopRequest = z.infer<typeof stopRequestSchema>;
export type DestroyRequest = z.infer<typeof destroyRequestSchema>;
export type StatusRequest = z.infer<typeof statusRequestSchema>;
export type AdoptRequest = z.infer<typeof adoptRequestSchema>;
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
 * unknown persona, or (critically) any extra key on a spawn/exec request that
 * would let the caller influence the container spec or command.
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

export type SpawnResponse =
  | { ok: true; containerName: string; state: ContainerState }
  | { ok: false; error: string };

export type ExecResponse = { ok: true; exitCode: number } | { ok: false; error: string };

export type StopResponse = { ok: true } | { ok: false; error: string };

export type DestroyResponse = { ok: true } | { ok: false; error: string };

export type StatusResponse =
  | { ok: true; containerName: string; state: ContainerState }
  | { ok: false; error: string };

export type AdoptResponse =
  | { ok: true; containerName: string; state: ContainerState }
  | { ok: false; error: string };

export interface SpawnBrokerResponseByOp {
  spawn: SpawnResponse;
  exec: ExecResponse;
  stop: StopResponse;
  destroy: DestroyResponse;
  status: StatusResponse;
  adopt: AdoptResponse;
}
