// ABOUTME: Build ContainerSpec from a persona's container runtime + mount registry
// ABOUTME: Branches on containerLifecycle (session vs persistent) and resolves mounts against the registry

import type { ContainerSpec } from '@lace/agent/containers/spec';
import type { ContainerMount } from '@lace/agent/containers/types';
import type { MountRegistryEntry } from '@lace/agent/server-types';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

// Single source of truth for the persona container runtime shape: the
// `type: 'container'` arm of the persona schema's discriminated union.
// Other call sites (JobState, delegate, job-manager options) import this.
import type { PersonaRuntime } from '@lace/agent/config/persona-registry';
export type PersonaContainerRuntime = Extract<PersonaRuntime, { type: 'container' }>;

// Spec-name components compose into a container name on the host; defend with
// an allowlist before composing. Same shape on both sides keeps the rule
// understandable.
const SPEC_NAME_COMPONENT_RE = /^[a-zA-Z0-9_-]+$/;

// Fixed in-container path where the embedder's user-personas dir is exposed.
// The subagent's `initialize` call points `userPersonasPaths` here so the
// child lace-agent can resolve `persona: '<name>'` on its own session/new.
// Auto-injected — independent of the persona file's `runtime.mounts` — so
// every container subagent can find its own persona definition.
export const SUBAGENT_USER_PERSONAS_TARGET = '/var/lace/user-personas';

// Fixed in-container path where the embedder's LACE_DIR is exposed. The
// subagent's lace-agent reads provider instances, credentials, and sessions
// from this dir and writes its own logs here too. Auto-injected when the
// embedder registers a 'lace-data' entry in containerMounts; spec.env then
// carries LACE_DIR pointing at this path so the child lace-agent picks it
// up the normal way (no init-param plumbing needed).
export const SUBAGENT_LACE_DATA_TARGET = '/var/lace/data';

// Fixed in-container path where the embedder's credentials dir is exposed.
// The embedder symlinks `${LACE_DIR}/credentials` → `../../credentials`.
// With LACE_DIR=/var/lace/data, that relative symlink resolves to
// `/var/credentials` (relative to the symlink's own directory
// `/var/lace/data/`), so the credentials registry must mount there.
export const SUBAGENT_CREDENTIALS_TARGET = '/var/credentials';

// Fixed in-container path where the embedder's lace source tree is exposed
// (PRI-1774). Persona container images are expected to exec lace-agent from
// `${SUBAGENT_LACE_TARGET}/packages/agent/dist/main.js` (the
// IN_CONTAINER_LACE_ENTRY constant in subagent-spawn.ts). Auto-injected when
// the embedder registers a `lace` entry in containerMounts; skipped silently
// otherwise, in which case the image MUST bake lace at `/lace` or the child
// will fail with MODULE_NOT_FOUND on startup. Personas have no business
// picking the target path (it's an architectural constant), so this mount
// belongs to the auto-inject set alongside persona / lace-data / credentials,
// not to the persona-declared `runtime.mounts` map.
export const SUBAGENT_LACE_TARGET = '/lace';

export class PersonaContainerSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonaContainerSpecError';
  }
}

/**
 * Shared core: resolves a persona's declared mounts against the embedder
 * registry, applies the auto-injection rules (persona / lace-data / credentials),
 * and merges runtime.env with the LACE_DIR auto-inject.
 *
 * Used by both lifecycle branches of `buildPersonaContainerSpec` (per-session
 * and persistent) so the mount/env contract stays identical regardless of
 * lifecycle.
 */
function resolvePersonaMountsAndEnv(input: {
  personaName: string;
  runtimeMounts: Record<string, string>;
  runtimeEnv: Record<string, string> | undefined;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
}): { mounts: ContainerMount[]; env: Record<string, string> } {
  const { personaName, runtimeMounts, runtimeEnv, containerMounts } = input;

  const mounts: ContainerMount[] = [];
  for (const [mountName, target] of Object.entries(runtimeMounts)) {
    if (mountName === 'persona') {
      throw new PersonaContainerSpecError(
        `Persona '${personaName}' declares mount 'persona' — reserved for ` +
          `lace's auto-injection of user-persona definitions into subagent ` +
          `containers. Remove it from the persona file's runtime.mounts.`
      );
    }
    if (mountName === 'lace-data') {
      throw new PersonaContainerSpecError(
        `Persona '${personaName}' declares mount 'lace-data' — reserved for ` +
          `lace's auto-injection of LACE_DIR into subagent containers. ` +
          `Remove it from the persona file's runtime.mounts.`
      );
    }
    if (mountName === 'credentials') {
      throw new PersonaContainerSpecError(
        `Persona '${personaName}' declares mount 'credentials' — reserved ` +
          `for lace's auto-injection of the embedder's credentials dir into ` +
          `subagent containers. Remove it from the persona file's runtime.mounts.`
      );
    }
    if (mountName === 'lace') {
      throw new PersonaContainerSpecError(
        `Persona '${personaName}' declares mount 'lace' — reserved for ` +
          `lace's auto-injection of the lace source tree into subagent ` +
          `containers. Remove it from the persona file's runtime.mounts.`
      );
    }
    const entry = containerMounts[mountName];
    if (!entry) {
      throw new PersonaContainerSpecError(
        `Persona '${personaName}' requests unknown mount '${mountName}'. ` +
          `Embedder did not supply this name in containerMounts at initialize.`
      );
    }
    mounts.push({
      source: entry.hostPath,
      target,
      readonly: entry.readonly,
    });
  }

  // Auto-inject the embedder's user-personas dir at a fixed target so the
  // subagent lace-agent can resolve `persona: '<name>'` on its session/new.
  // Without this, the subagent boots with an empty user-persona registry and
  // every `session/new` with a user persona fails PersonaInvalid.
  const personaRegistryEntry = containerMounts.persona;
  if (personaRegistryEntry) {
    mounts.push({
      source: personaRegistryEntry.hostPath,
      target: SUBAGENT_USER_PERSONAS_TARGET,
      readonly: true,
    });
  }

  // Auto-inject the embedder's LACE_DIR at a fixed target so the subagent
  // lace-agent finds providers, credentials, and sessions from disk like a
  // normal lace-agent boot. The mount's readonly flag is honored from the
  // registry (the embedder owns the trust decision); for sen-core today this
  // is rw so the subagent can also write its own logs. Skipped silently
  // when the embedder didn't register 'lace-data' — non-container deployments
  // pass parent process env through subagent-spawn so LACE_DIR flows that way.
  const laceDataRegistryEntry = containerMounts['lace-data'];
  if (laceDataRegistryEntry) {
    mounts.push({
      source: laceDataRegistryEntry.hostPath,
      target: SUBAGENT_LACE_DATA_TARGET,
      readonly: laceDataRegistryEntry.readonly,
    });
  }

  // Auto-inject the embedder's credentials dir at the fixed parallel path so
  // the `${LACE_DIR}/credentials` symlink (→ `../../credentials`) resolves
  // inside the container. No env var: the symlink in the lace-data mount is
  // the indirection. Skipped silently when absent.
  const credentialsRegistryEntry = containerMounts.credentials;
  if (credentialsRegistryEntry) {
    mounts.push({
      source: credentialsRegistryEntry.hostPath,
      target: SUBAGENT_CREDENTIALS_TARGET,
      readonly: credentialsRegistryEntry.readonly,
    });
  }

  // Auto-inject the embedder's lace source tree at /lace so the child
  // lace-agent can exec from `${SUBAGENT_LACE_TARGET}/packages/agent/dist/main.js`
  // (the path baked into IN_CONTAINER_LACE_ENTRY). Skipped silently when
  // absent — the image is then expected to bake lace at /lace, otherwise the
  // child crashes with MODULE_NOT_FOUND on startup. PRI-1774: this auto-inject
  // replaces the older pattern of personas declaring `lace: /lace` in
  // runtime.mounts, which mismatched the embedder's containerMounts registry
  // shape (the embedder owns the host path, the persona has no business
  // picking it).
  const laceRegistryEntry = containerMounts.lace;
  if (laceRegistryEntry) {
    mounts.push({
      source: laceRegistryEntry.hostPath,
      target: SUBAGENT_LACE_TARGET,
      readonly: laceRegistryEntry.readonly,
    });
  }

  // Merge persona-declared env with auto-injected LACE_DIR. The auto-inject
  // wins: the mount IS the source of truth for where LACE_DIR resolves
  // inside the container, so a persona-supplied LACE_DIR pointing elsewhere
  // would be inconsistent with the mounted directory.
  const env: Record<string, string> = { ...(runtimeEnv ?? {}) };
  if (laceDataRegistryEntry) {
    env.LACE_DIR = SUBAGENT_LACE_DATA_TARGET;
  }

  return { mounts, env };
}

// Fixed daemon-side id for the single-tenant persistent persona container.
// No per-session suffix, no `lace-` prefix (so the startup reaper's `lace-*`
// scan ignores it).
export const PERSISTENT_PERSONA_CONTAINER_ID = 'sen-box';

export function buildPersonaContainerSpec(input: {
  parentSessionId: string;
  personaName: string;
  runtime: PersonaContainerRuntime;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
}): ContainerSpec {
  const { parentSessionId, personaName, runtime, containerMounts } = input;

  if (!SPEC_NAME_COMPONENT_RE.test(parentSessionId)) {
    throw new PersonaContainerSpecError(
      `Invalid parentSessionId for container spec name: '${parentSessionId}'`
    );
  }
  if (!SPEC_NAME_COMPONENT_RE.test(personaName)) {
    throw new PersonaContainerSpecError(
      `Invalid personaName for container spec name: '${personaName}'`
    );
  }

  const { mounts, env } = resolvePersonaMountsAndEnv({
    personaName,
    runtimeMounts: runtime.mounts,
    runtimeEnv: runtime.env,
    containerMounts,
  });

  if (runtime.containerLifecycle === 'persistent') {
    return {
      name: 'box',
      containerId: PERSISTENT_PERSONA_CONTAINER_ID,
      image: runtime.image,
      workingDirectory: runtime.workingDirectory,
      mounts,
      env,
      restartPolicy: 'unless-stopped',
    };
  }

  return {
    name: `${parentSessionId}-${personaName}`,
    image: runtime.image,
    workingDirectory: runtime.workingDirectory,
    mounts,
    env,
    ...(runtime.ports ? { ports: runtime.ports } : {}),
  };
}

export function containerSpecToRuntimeSpec(input: {
  spec: ContainerSpec;
  imageIdentity: {
    requestedImage: string;
    resolvedImageDigest: string;
    imagePlatform: string;
  };
}): Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>['spec'] {
  const { spec, imageIdentity } = input;
  return {
    name: spec.name,
    ...(spec.containerId ? { containerId: spec.containerId } : {}),
    requestedImage: imageIdentity.requestedImage,
    resolvedImageDigest: imageIdentity.resolvedImageDigest,
    imagePlatform: imageIdentity.imagePlatform,
    workingDirectory: spec.workingDirectory,
    mounts: spec.mounts.map((mount) => ({
      hostPath: mount.source,
      containerPath: mount.target,
      readonly: mount.readonly ?? false,
    })),
    ...(spec.env ? { env: spec.env } : {}),
    ...(spec.ports ? { ports: spec.ports } : {}),
    ...(spec.restartPolicy ? { restartPolicy: spec.restartPolicy } : {}),
  };
}
