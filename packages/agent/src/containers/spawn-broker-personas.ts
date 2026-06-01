// ABOUTME: Closed persona enumeration + the catalog interface the spawn-broker uses to build full container specs
// ABOUTME: The broker — not the caller — owns spec assembly; this is the contract for that assembly

import type { ContainerConfig } from './types';

// The closed set of container personas the broker can spawn. Confirmed against
// the live sen-core persona files in agent-runtime/user/agent-personas/
// (browser-driver.md, persistent-box.md, ephemeral-shell.md — each with
// `runtime.type: container`) and the persona image build keys in
// sen-core src/cli/images.ts (sen-browser / sen-persistent-box /
// sen-ephemeral-shell). `as const` keeps the tuple literal so it can seed a
// zod enum and the PersonaName union without drift.
export const PERSONA_NAMES = ['browser-driver', 'persistent-box', 'ephemeral-shell'] as const;

export type PersonaName = (typeof PERSONA_NAMES)[number];

export function isPersonaName(value: unknown): value is PersonaName {
  return typeof value === 'string' && (PERSONA_NAMES as readonly string[]).includes(value);
}

/**
 * Per-spawn parameterization. Carries ONLY the values the broker stamps into an
 * otherwise catalog-defined spec: the parent + child session ids (for the derived
 * container name + per-spawn scratch dir), the job id (audit/register), and the
 * broker-minted agent token injected as an env var. It carries NO spec fields
 * (no image/mounts/network/etc.) and NO host paths — the broker DERIVES the
 * container name and scratch host path from these ids against its own boot env.
 * The container name is therefore an OUTPUT of buildContainerConfig (config.name),
 * not an input.
 */
export interface PersonaSpawnContext {
  parentSessionId: string;
  childSessionId: string;
  jobId: string;
  agentToken: string;
}

/**
 * Builds the FULL ContainerConfig for a persona, entirely broker-side. The
 * caller never supplies any part of the returned spec; this is the load-bearing
 * security boundary of the spawn broker.
 *
 * Named `PersonaCatalog` (not "registry") to avoid collision with lace's
 * `config/persona-registry` PersonaRegistry — that one PARSES persona files;
 * this one is the broker's spec BUILDER contract.
 *
 * The concrete implementation (PRI-2012 Component B, Task 2) assembles each
 * config from the RO-mounted sen-core persona files via lace's existing
 * `config/persona-registry` parser + `jobs/persona-container-spec` +
 * broker-side `buildContainerMounts`. The per-persona resolved shapes are
 * enumerated in docs/superpowers/specs/2026-06-01-spawn-broker-persona-registry-enumeration.md.
 */
export interface PersonaCatalog {
  buildContainerConfig(persona: PersonaName, ctx: PersonaSpawnContext): ContainerConfig;
}

/**
 * Placeholder catalog. Throws until Task 2 wires the persona-file assembly.
 * The per-persona specs are intentionally NOT inlined here — they live in the
 * committed enumeration blueprint, and inventing the values would risk drift
 * from the real persona definitions.
 */
export class StubPersonaCatalog implements PersonaCatalog {
  buildContainerConfig(_persona: PersonaName, _ctx: PersonaSpawnContext): ContainerConfig {
    throw new Error('persona catalog not yet populated — pending PRI-2012 Component B Task 2');
  }
}
