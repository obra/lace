// ABOUTME: Build container specs from a persona's container runtime + mount registry
// ABOUTME: Branches on containerSharing (per_invocation vs persistent) and resolves mounts against the registry

import { browserCdpSocketPath, type ContainerSpec } from '@lace/agent/containers/spec';
import type { ContainerMount } from '@lace/agent/containers/types';
import type { MountRegistryEntry } from '@lace/agent/server-types';
import type {
  RuntimeExecutionBinding,
  RuntimeMountDescriptor,
} from '@lace/agent/tools/runtime/types';

// Single source of truth for the persona container runtime shape: the
// `type: 'container'` arm of the persona schema's discriminated union.
// Other call sites (JobState, delegate, job-manager options) import this.
import type { PersonaRuntime } from '@lace/agent/config/persona-registry';
export type PersonaContainerRuntime = Extract<PersonaRuntime, { type: 'container' }>;

// Spec-name components compose into a container name on the host; defend with
// an allowlist before composing. Same shape on both sides keeps the rule
// understandable.
const SPEC_NAME_COMPONENT_RE = /^[a-zA-Z0-9_-]+$/;

export class PersonaContainerSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonaContainerSpecError';
  }
}

/**
 * Shared core: resolves a persona's declared mounts against the embedder
 * registry and passes runtime.env through unchanged.
 *
 * Used by both projected and daemon-shaped builders so the mount/env contract
 * stays identical regardless of lifecycle.
 */
function resolvePersonaMountsAndEnv(input: {
  personaName: string;
  containerSharing: 'per_invocation' | 'persistent';
  runtimeMounts: readonly string[];
  runtimeEnv: Record<string, string> | undefined;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
}): { mounts: RuntimeMountDescriptor[]; env: Record<string, string> } {
  const { personaName, containerSharing, runtimeMounts, runtimeEnv, containerMounts } = input;

  const mounts: RuntimeMountDescriptor[] = [];
  for (const mountName of runtimeMounts) {
    // 'scratch' is reserved for per_invocation personas only — lace auto-injects
    // the per-invocation work directory at /work. Persistent personas may still
    // use 'scratch' as a named mount resolved through the registry.
    if (mountName === 'scratch' && containerSharing === 'per_invocation') {
      throw new PersonaContainerSpecError(
        `containerSharing: per_invocation persona '${personaName}' declares mount 'scratch' — ` +
          `reserved for lace's auto-injection of the per-invocation work directory ` +
          `at /work. Remove it from the persona file.`
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
      hostPath: entry.hostPath,
      containerPath: entry.containerPath,
      readonly: entry.readonly,
    });
  }

  const env: Record<string, string> = { ...(runtimeEnv ?? {}) };

  // Per_invocation subagents get an ephemeral $TMPDIR that dies with the
  // container — the container's own /tmp, NOT /work/tmp (/work is the retained,
  // parent-visible, ceiling-counted result tree). Set LAST so a persona can't
  // redirect temp files into /work.
  if (containerSharing === 'per_invocation') {
    env.TMPDIR = '/tmp';
  }

  return { mounts, env };
}

function toContainerMounts(mounts: RuntimeMountDescriptor[]): ContainerMount[] {
  return mounts.map((mount) => ({
    source: mount.hostPath,
    target: mount.containerPath,
    readonly: mount.readonly,
  }));
}

function withBrowserCdpSocketEnv(
  env: Record<string, string>,
  browserCdpSocket: boolean | undefined,
  containerName: string
): Record<string, string> {
  if (!browserCdpSocket) return env;
  return { ...env, SEN_BROWSER_CDP_SOCKET: browserCdpSocketPath(containerName) };
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

type PersonaContainerSpecInput = {
  parentSessionId: string;
  personaName: string;
  runtime: PersonaContainerRuntime;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
  // Required for per_invocation; ignored for persistent.
  childSessionId?: string;
  scratchDirHostPath?: string;
  jobId?: string;
};

function validatePersonaContainerSpecInput(input: PersonaContainerSpecInput): void {
  const { parentSessionId, personaName, runtime } = input;

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
}

export interface ProjectedPersonaRuntimeSpec {
  name: string;
  image: string;
  workingDirectory: string;
  mounts: RuntimeMountDescriptor[];
  env: Record<string, string>;
  persona: string;
  parentSession: string;
  childSession?: string;
  jobId?: string;
}

type AssertNoForbiddenProjectedPersonaKeys<T extends never> = T;
type _ProjectedPersonaSpecHasNoDockerAuthorityFields = AssertNoForbiddenProjectedPersonaKeys<
  Extract<
    keyof ProjectedPersonaRuntimeSpec,
    | 'containerId'
    | 'ports'
    | 'restartPolicy'
    | 'sysctls'
    | 'capAdd'
    | 'network'
    | 'gatewayRoute'
    | 'browserCdpSocket'
  >
>;

export function buildProjectedRuntimeSpec(
  input: PersonaContainerSpecInput
): ProjectedPersonaRuntimeSpec {
  const { parentSessionId, personaName, runtime, containerMounts } = input;

  validatePersonaContainerSpecInput(input);

  const { mounts, env } = resolvePersonaMountsAndEnv({
    personaName,
    containerSharing: runtime.containerSharing,
    runtimeMounts: runtime.mounts,
    runtimeEnv: runtime.env,
    containerMounts,
  });

  if (runtime.containerSharing === 'persistent') {
    const name = personaName;
    return {
      name,
      image: runtime.image,
      workingDirectory: runtime.workingDirectory,
      mounts,
      env,
      // Root A selector fields (persistent has no child session).
      persona: personaName,
      parentSession: parentSessionId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
    };
  }

  // per_invocation: compose a name unique to this child session so concurrent
  // delegates of the same persona from the same parent don't collide.
  // Auto-inject the per-invocation scratch directory at /work so the subagent
  // has an isolated writable workspace for the duration of this invocation.
  const perInvocationMounts: RuntimeMountDescriptor[] = [
    ...mounts,
    { hostPath: input.scratchDirHostPath!, containerPath: '/work', readonly: false },
  ];

  const name = buildPerInvocationSpecName({
    parentSessionId,
    personaName,
    childSessionId: input.childSessionId!,
  });
  return {
    name,
    image: runtime.image,
    workingDirectory: runtime.workingDirectory,
    mounts: perInvocationMounts,
    env,
    // Root A selector fields.
    persona: personaName,
    parentSession: parentSessionId,
    childSession: input.childSessionId,
    ...(input.jobId ? { jobId: input.jobId } : {}),
  };
}

export function buildPersonaContainerSpec(input: PersonaContainerSpecInput): ContainerSpec {
  const { parentSessionId, personaName, runtime, containerMounts } = input;

  validatePersonaContainerSpecInput(input);

  const { mounts, env } = resolvePersonaMountsAndEnv({
    personaName,
    containerSharing: runtime.containerSharing,
    runtimeMounts: runtime.mounts,
    runtimeEnv: runtime.env,
    containerMounts,
  });

  if (runtime.containerSharing === 'persistent') {
    const name = personaName;
    return {
      name,
      containerId: `sen-${personaName}`,
      image: runtime.image,
      workingDirectory: runtime.workingDirectory,
      mounts: toContainerMounts(mounts),
      env: withBrowserCdpSocketEnv(env, runtime.browserCdpSocket, name),
      restartPolicy: 'unless-stopped',
      persona: personaName,
      parentSessionId,
      ...(runtime.sysctls ? { sysctls: runtime.sysctls } : {}),
      ...(runtime.capAdd ? { capAdd: runtime.capAdd } : {}),
      ...(runtime.network ? { network: runtime.network } : {}),
      ...(runtime.gatewayRoute ? { gatewayRoute: runtime.gatewayRoute } : {}),
      ...(runtime.browserCdpSocket ? { browserCdpSocket: true } : {}),
    };
  }

  const perInvocationMounts: ContainerMount[] = [
    ...toContainerMounts(mounts),
    { source: input.scratchDirHostPath!, target: '/work', readonly: false },
  ];

  const name = buildPerInvocationSpecName({
    parentSessionId,
    personaName,
    childSessionId: input.childSessionId!,
  });
  return {
    name,
    image: runtime.image,
    workingDirectory: runtime.workingDirectory,
    mounts: perInvocationMounts,
    env: withBrowserCdpSocketEnv(env, runtime.browserCdpSocket, name),
    persona: personaName,
    parentSessionId,
    childSessionId: input.childSessionId,
    ...(runtime.ports ? { ports: runtime.ports } : {}),
    ...(runtime.sysctls ? { sysctls: runtime.sysctls } : {}),
    ...(runtime.capAdd ? { capAdd: runtime.capAdd } : {}),
    ...(runtime.network ? { network: runtime.network } : {}),
    ...(runtime.gatewayRoute ? { gatewayRoute: runtime.gatewayRoute } : {}),
    ...(runtime.browserCdpSocket ? { browserCdpSocket: true } : {}),
  };
}

// Convert a daemon-shaped ContainerSpec into the projected runtime's spec
// shape. The persona-declared image string flows through verbatim; identity for
// tracking comes from the selected runtime, not from pre-resolution here.
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
    ...(spec.capAdd ? { capAdd: spec.capAdd } : {}),
    ...(spec.network ? { network: spec.network } : {}),
    ...(spec.gatewayRoute ? { gatewayRoute: spec.gatewayRoute } : {}),
    ...(spec.browserCdpSocket ? { browserCdpSocket: true } : {}),
    ...(spec.persona ? { persona: spec.persona } : {}),
    ...(spec.parentSessionId ? { parentSessionId: spec.parentSessionId } : {}),
    ...(spec.childSessionId ? { childSessionId: spec.childSessionId } : {}),
    ...(spec.parentSession ? { parentSession: spec.parentSession } : {}),
    ...(spec.childSession ? { childSession: spec.childSession } : {}),
    ...(spec.jobId ? { jobId: spec.jobId } : {}),
  };
}
