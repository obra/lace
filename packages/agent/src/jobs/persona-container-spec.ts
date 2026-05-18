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

  return {
    name: `${parentSessionId}-${personaName}`,
    image: runtime.image,
    workingDirectory: runtime.workingDirectory,
    mounts,
    env: runtime.env ?? {},
    ...(runtime.ports ? { ports: runtime.ports } : {}),
  };
}
