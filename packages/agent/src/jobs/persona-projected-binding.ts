// ABOUTME: Build host-side projected RuntimeExecutionBinding for container personas
// ABOUTME: Used by delegate to project container tools to the host agent

import type { MountRegistryEntry } from '@lace/agent/server-types';
import { buildRuntimeId } from '@lace/agent/tools/runtime/identity';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
import {
  buildPersonaContainerSpec,
  containerSpecToRuntimeSpec,
  type PersonaContainerRuntime,
} from './persona-container-spec';

export function buildPersonaProjectedRuntimeBinding(input: {
  parentSessionId: string;
  personaName: string;
  environmentName: string;
  runtime: PersonaContainerRuntime;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
  executionEnv?: Record<string, string>;
  // Required for per_invocation; ignored for persistent.
  childSessionId?: string;
  scratchDirHostPath?: string;
}): RuntimeExecutionBinding {
  const containerSpec = buildPersonaContainerSpec({
    parentSessionId: input.parentSessionId,
    personaName: input.personaName,
    environmentName: input.environmentName,
    childSessionId: input.childSessionId,
    scratchDirHostPath: input.scratchDirHostPath,
    runtime: input.runtime,
    containerMounts: input.containerMounts,
  });
  const runtimeSpec = containerSpecToRuntimeSpec({ spec: containerSpec });

  // Delegate builds this binding before JobManager.createJob allocates the
  // final Lace job id. Do not synthesize one here; PlaneRuntime uses its
  // fallback identity until a later lifecycle can thread the real job id.
  runtimeSpec.env = { ...runtimeSpec.env, ...(input.executionEnv ?? {}) };

  const binding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'pending' },
    toolRuntime: {
      type: 'container',
      spec: runtimeSpec,
      cwd: input.runtime.workingDirectory,
    },
    // Tag the binding with the lifecycle so post-exit handlers (Chunk E) can
    // branch on per_invocation vs persistent without inspecting toolRuntime
    // internals.
    containerSharing: input.runtime.containerSharing,
  };

  return {
    ...binding,
    identity: {
      runtimeId: buildRuntimeId({
        scope: 'session',
        sessionId: input.parentSessionId,
        binding,
      }),
    },
  };
}
