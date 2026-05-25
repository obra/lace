// ABOUTME: Build ContainerSpec from a persona's container runtime + mount registry
// ABOUTME: Branches on containerSharing (per_invocation vs persistent) and resolves mounts against the registry

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

// Fixed in-container root for embedder-supplied skill directories. Each parent
// skill dir is mounted read-only at `${SUBAGENT_SKILLS_TARGET}/<index>` and the
// child initialize request receives those in-container paths as `skillDirs`.
export const SUBAGENT_SKILLS_TARGET = '/var/lace/skills';

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
  containerSharing: 'per_invocation' | 'persistent';
  runtimeMounts: Record<string, string>;
  runtimeEnv: Record<string, string> | undefined;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
  skillDirs?: readonly string[];
}): { mounts: ContainerMount[]; env: Record<string, string> } {
  const { personaName, containerSharing, runtimeMounts, runtimeEnv, containerMounts, skillDirs } =
    input;

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
    // 'scratch' is reserved for per_invocation personas only — lace auto-injects
    // the per-invocation work directory at /work. Persistent personas may still
    // use 'scratch' as a named mount resolved through the registry (PRI-1796).
    if (mountName === 'scratch' && containerSharing === 'per_invocation') {
      throw new PersonaContainerSpecError(
        `containerSharing: per_invocation persona '${personaName}' declares mount 'scratch' — ` +
          `reserved for lace's auto-injection of the per-invocation work directory ` +
          `at /work. Remove it from the persona file (PRI-1796).`
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

  for (const [index, skillDir] of (skillDirs ?? []).entries()) {
    mounts.push({
      source: skillDir,
      target: `${SUBAGENT_SKILLS_TARGET}/${index}`,
      readonly: true,
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

// Extract the first 8 meaningful characters from a session id for use in
// container spec names. Strips the 'sess_' prefix if present (the UUID
// portion is hex and passes SPEC_NAME_COMPONENT_RE); otherwise takes the
// first 8 characters of the raw id.
export function sessionIdShort(id: string): string {
  return id.startsWith('sess_') ? id.slice(5, 13) : id.slice(0, 8);
}

/**
 * Build the per-invocation container spec name from parent session, persona
 * name, and child session. Exported so delegate.ts can compute it once and
 * store it on the job state — keeping the formula in a single place.
 *
 * Format: <parent8>-<personaName>-<child8>
 */
export function buildPerInvocationSpecName(input: {
  parentSessionId: string;
  personaName: string;
  childSessionId: string;
}): string {
  return `${sessionIdShort(input.parentSessionId)}-${input.personaName}-${sessionIdShort(input.childSessionId)}`;
}

export function buildPersonaContainerSpec(input: {
  parentSessionId: string;
  personaName: string;
  runtime: PersonaContainerRuntime;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
  skillDirs?: readonly string[];
  // Required for per_invocation; ignored for persistent.
  childSessionId?: string;
  scratchDirHostPath?: string;
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

  // Validate per_invocation fields before doing any mount work.
  if (runtime.containerSharing === 'per_invocation') {
    if (!input.childSessionId) {
      throw new PersonaContainerSpecError(
        `Per-invocation persona '${personaName}' requires childSessionId — ` +
          `provide the child subagent's session id so container names are unique per delegate.`
      );
    }
    if (!input.scratchDirHostPath) {
      throw new PersonaContainerSpecError(
        `Per-invocation persona '${personaName}' requires scratchDirHostPath — ` +
          `provide the host path to auto-inject as the per-invocation work directory at /work.`
      );
    }
    const childSessionIdShort = sessionIdShort(input.childSessionId);
    if (!SPEC_NAME_COMPONENT_RE.test(childSessionIdShort)) {
      throw new PersonaContainerSpecError(
        `Invalid childSessionId for container spec name: '${input.childSessionId}' ` +
          `(short form '${childSessionIdShort}' fails component validation)`
      );
    }
  }

  const { mounts, env } = resolvePersonaMountsAndEnv({
    personaName,
    containerSharing: runtime.containerSharing,
    runtimeMounts: runtime.mounts,
    runtimeEnv: runtime.env,
    containerMounts,
    skillDirs: input.skillDirs,
  });

  if (runtime.containerSharing === 'persistent') {
    return {
      name: personaName,
      containerId: `sen-${personaName}`,
      image: runtime.image,
      workingDirectory: runtime.workingDirectory,
      mounts,
      env,
      managedMountTargetPrefixes: [`${SUBAGENT_SKILLS_TARGET}/`],
      restartPolicy: 'unless-stopped',
      ...(runtime.sysctls ? { sysctls: runtime.sysctls } : {}),
    };
  }

  // per_invocation: compose a name unique to this child session so concurrent
  // delegates of the same persona from the same parent don't collide (PRI-1796).
  // Auto-inject the per-invocation scratch directory at /work so the subagent
  // has an isolated writable workspace for the duration of this invocation.
  const perInvocationMounts: ContainerMount[] = [
    ...mounts,
    { source: input.scratchDirHostPath!, target: '/work', readonly: false },
  ];

  return {
    name: buildPerInvocationSpecName({
      parentSessionId,
      personaName,
      childSessionId: input.childSessionId!,
    }),
    image: runtime.image,
    workingDirectory: runtime.workingDirectory,
    mounts: perInvocationMounts,
    env,
    managedMountTargetPrefixes: [`${SUBAGENT_SKILLS_TARGET}/`],
    ...(runtime.ports ? { ports: runtime.ports } : {}),
    ...(runtime.sysctls ? { sysctls: runtime.sysctls } : {}),
  };
}

// Convert a daemon-shaped ContainerSpec into the projected runtime's spec
// shape. The persona-declared image string flows through verbatim — the
// projected runtime's identity for tracking comes from a post-create
// `.Image` capture (see projected-container.ts), not from pre-resolution.
export function containerSpecToRuntimeSpec(input: {
  spec: ContainerSpec;
}): Extract<RuntimeExecutionBinding['toolRuntime'], { type: 'container' }>['spec'] {
  const { spec } = input;
  return {
    name: spec.name,
    ...(spec.containerId ? { containerId: spec.containerId } : {}),
    image: spec.image,
    workingDirectory: spec.workingDirectory,
    mounts: spec.mounts.map((mount) => ({
      hostPath: mount.source,
      containerPath: mount.target,
      readonly: mount.readonly ?? false,
    })),
    ...(spec.env ? { env: spec.env } : {}),
    ...(spec.ports ? { ports: spec.ports } : {}),
    ...(spec.restartPolicy ? { restartPolicy: spec.restartPolicy } : {}),
    ...(spec.sysctls ? { sysctls: spec.sysctls } : {}),
  };
}
