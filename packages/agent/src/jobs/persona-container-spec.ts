// ABOUTME: Build ContainerSpec from a persona's container runtime + mount registry
// ABOUTME: Validates spec name components and resolves mount names against the registry

import type { ContainerSpec } from '@lace/agent/containers/spec';
import type { ContainerMount } from '@lace/agent/containers/types';
import type { MountRegistryEntry } from '@lace/agent/server-types';

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
// The embedder symlinks `${LACE_DIR}/credentials` → `../../credentials`, so
// the subagent's lace-agent only finds provider credentials when that
// relative path resolves inside the container — which requires the
// credentials dir to be mounted at the parallel path.
export const SUBAGENT_CREDENTIALS_TARGET = '/var/lace/credentials';

export class PersonaContainerSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonaContainerSpecError';
  }
}

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

  const mounts: ContainerMount[] = [];
  for (const [mountName, target] of Object.entries(runtime.mounts)) {
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

  // Merge persona-declared env with auto-injected LACE_DIR. The auto-inject
  // wins: the mount IS the source of truth for where LACE_DIR resolves
  // inside the container, so a persona-supplied LACE_DIR pointing elsewhere
  // would be inconsistent with the mounted directory.
  const env: Record<string, string> = { ...(runtime.env ?? {}) };
  if (laceDataRegistryEntry) {
    env.LACE_DIR = SUBAGENT_LACE_DATA_TARGET;
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
