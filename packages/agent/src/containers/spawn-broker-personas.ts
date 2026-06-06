// ABOUTME: Closed persona enumeration + the catalog interface the spawn-broker uses to build full container specs
// ABOUTME: The broker — not the caller — owns spec assembly; this is the contract for that assembly

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContainerConfig } from './types';
import { resolveContainerId } from './container-manager';
import { buildBrokerContainerMounts, type BrokerMountEnv } from './broker-container-mounts';
import type { MountRegistryEntry } from '@lace/agent/server-types';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import {
  buildPersonaContainerSpec,
  type PersonaContainerRuntime,
} from '@lace/agent/jobs/persona-container-spec';

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
 * Per-spawn parameterization. Carries ONLY the per-spawn identifiers: the parent
 * + child session ids (for the derived container name + per-spawn scratch dir)
 * and the job id (audit/register). It carries NO spec fields (no image/mounts/
 * network/etc.), NO host paths, and NO identity token — the broker DERIVES the
 * container name + scratch host path from these ids against its own boot env, and
 * the SERVER (not the catalog) mints/registers/stamps the agent token. The
 * container name is an OUTPUT (config.name), not an input.
 */
export interface PersonaSpawnContext {
  parentSessionId: string;
  childSessionId: string;
  jobId: string;
}

/**
 * What the catalog produces for a spawn: the full ContainerConfig plus the two
 * persona facts the SERVER needs for identity registration but that aren't on
 * ContainerConfig — containerSharing (→ register_runtime `container_sharing`) and
 * browserCdpSocket (so the server can compute the per-spawn CDP socket path for
 * the network-attach enrichment). The catalog has NO identity surface: it does
 * not stamp SEN_AGENT_TOKEN or the sen.broker.* ownership labels — that is the
 * server's job (mint → register → stamp), since the token comes from a register
 * call that needs the name the catalog derives.
 */
export interface BuiltPersonaSpawn {
  config: ContainerConfig;
  containerSharing: 'per_invocation' | 'persistent';
  browserCdpSocket: boolean;
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
  buildSpawn(persona: PersonaName, ctx: PersonaSpawnContext): BuiltPersonaSpawn;
}

/**
 * Placeholder catalog. Throws until Task 2 wires the persona-file assembly.
 * The per-persona specs are intentionally NOT inlined here — they live in the
 * committed enumeration blueprint, and inventing the values would risk drift
 * from the real persona definitions.
 */
export class StubPersonaCatalog implements PersonaCatalog {
  buildSpawn(_persona: PersonaName, _ctx: PersonaSpawnContext): BuiltPersonaSpawn {
    throw new Error('persona catalog not yet populated — pending PRI-2012 Component B Task 2');
  }
}

/**
 * Boot-time inputs the broker needs to build persona container configs. Every
 * field is deployment-static and comes from the broker's own boot environment —
 * the (adversarial) caller never supplies any of them.
 */
export interface BrokerPersonaCatalogOptions {
  // Host path to the RO-mounted sen-core persona directory (the three
  // container-persona `.md` files: browser-driver / persistent-box /
  // ephemeral-shell). Deploy writes it; the broker mounts it read-only.
  personasDir: string;
  // Host path to the broker's per-invocation scratch base. The per-spawn scratch
  // dir is `<workBaseHostPath>/<childSessionId>`; the broker DERIVES it (never
  // caller-supplied) — a caller-chosen host path would be an arbitrary-mount escape.
  workBaseHostPath: string;
  // Boot env for resolving persona mount names to host bind-mount sources.
  mountEnv: BrokerMountEnv;
}

/**
 * Real PersonaCatalog: assembles each persona's full ContainerConfig entirely
 * broker-side from the RO-mounted sen-core persona files. Reuses lace's existing
 * machinery end-to-end — the persona-file parser (PersonaRegistry), the
 * broker-side mount registry (buildBrokerContainerMounts), and the spec builder
 * (buildPersonaContainerSpec) — then copies the resulting ContainerSpec into a
 * ContainerConfig exactly as ContainerManager.materializeOnce does. The caller
 * supplies no part of the returned config; this is the spawn broker's security
 * boundary.
 */
export class BrokerPersonaCatalog implements PersonaCatalog {
  private readonly registry: PersonaRegistry;
  private readonly workBaseHostPath: string;
  private readonly containerMounts: Record<string, MountRegistryEntry>;

  constructor(opts: BrokerPersonaCatalogOptions) {
    this.workBaseHostPath = opts.workBaseHostPath;
    this.containerMounts = buildBrokerContainerMounts(opts.mountEnv);
    // The broker mounts a SINGLE read-only personas directory. Point both
    // resolution paths at it: `userPersonasPaths` is the real-fs path the parser
    // reads file content from, `bundledPersonasPath` is the dir scanned at
    // construction. Same dir for both keeps the source unambiguous — there is no
    // bundled-vs-user override layering in the broker.
    this.registry = new PersonaRegistry({
      bundledPersonasPath: opts.personasDir,
      userPersonasPaths: [opts.personasDir],
    });
  }

  buildSpawn(persona: PersonaName, ctx: PersonaSpawnContext): BuiltPersonaSpawn {
    // Defense-in-depth: childSessionId feeds a host path (the per-spawn scratch
    // dir) and the container name. The protocol layer already enforces this, but
    // this is a trust boundary — re-validate here so a future caller that reaches
    // the catalog off the protocol path can never traverse out of the work base
    // or shadow a name. Must match componentIdSchema in spawn-broker-protocol.ts.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(ctx.childSessionId)) {
      throw new Error(
        `Unsafe childSessionId '${ctx.childSessionId}': must be [A-Za-z0-9_-]{1,64} ` +
          `(no path separators or dots).`
      );
    }

    const parsed = this.registry.parsePersona(persona);
    if (parsed.config.runtime?.type !== 'container') {
      throw new Error(
        `Persona '${persona}' is not a container persona (runtime.type=` +
          `${parsed.config.runtime?.type ?? 'undefined'}); the spawn broker only builds container configs.`
      );
    }
    const runtime: PersonaContainerRuntime = parsed.config.runtime;

    // For per_invocation personas the broker DERIVES the scratch host path from
    // its own work base + the (protocol-validated path-safe) child session id and
    // mkdirs it 0o700 — mirroring sen-core's delegate.ts. Persistent personas
    // declare their own scratch mount and need no per-spawn dir.
    let scratchDirHostPath: string | undefined;
    if (runtime.containerSharing === 'per_invocation') {
      scratchDirHostPath = path.join(this.workBaseHostPath, ctx.childSessionId);
      fs.mkdirSync(scratchDirHostPath, { recursive: true, mode: 0o700 });
    }

    const spec = buildPersonaContainerSpec({
      parentSessionId: ctx.parentSessionId,
      personaName: persona,
      runtime,
      containerMounts: this.containerMounts,
      childSessionId: ctx.childSessionId,
      scratchDirHostPath,
    });

    // Copy ContainerSpec → ContainerConfig exactly as ContainerManager.materializeOnce
    // does (no transform). `id` is the resolved container id (verbatim
    // `sen-<persona>` for persistent, `lace-<name>` otherwise); `command` is left
    // unset so the container runs `sleep infinity` and is only ever exec'd into.
    const config: ContainerConfig = {
      id: resolveContainerId(spec),
      name: spec.name,
      image: spec.image,
      workingDirectory: spec.workingDirectory,
      mounts: spec.mounts,
      environment: spec.env,
      ports: spec.ports,
      restartPolicy: spec.restartPolicy,
      sysctls: spec.sysctls,
      capAdd: spec.capAdd,
      network: spec.network,
      gatewayRoute: spec.gatewayRoute,
    };

    // The catalog has NO identity surface: SEN_AGENT_TOKEN and the sen.broker.*
    // ownership labels are stamped by the SERVER after it mints + registers the
    // token (the token comes from a register call that needs config.name, which
    // is derived here — so it can't be stamped at this layer). Return the config
    // plus the two persona facts the server needs for register/enrich that aren't
    // on ContainerConfig.
    return {
      config,
      containerSharing: runtime.containerSharing,
      browserCdpSocket: false,
    };
  }
}
