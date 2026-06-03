// ABOUTME: Build host-side projected RuntimeExecutionBinding for container personas
// ABOUTME: Used by delegate to project container tools to the host agent

import type { MountRegistryEntry } from '@lace/agent/server-types';
import { buildRuntimeId } from '@lace/agent/tools/runtime/identity';
import type {
  RuntimeExecutionBinding,
  RuntimeHelperDescriptor,
} from '@lace/agent/tools/runtime/types';
import { fileURLToPath } from 'node:url';
import { buildProjectedRuntimeSpec, type PersonaContainerRuntime } from './persona-container-spec';

const HELPER_CONTAINER_PATH = '/usr/local/bin/lace-runtime-helper.js';

function resolveRuntimeHelperDescriptor(): RuntimeHelperDescriptor {
  const hostPath =
    process.env.LACE_RUNTIME_HELPER_HOST_PATH ??
    fileURLToPath(new URL('../tools/runtime/container-helper.js', import.meta.url));
  return {
    mode: 'mount',
    hostPath,
    containerPath: HELPER_CONTAINER_PATH,
    command: ['node', HELPER_CONTAINER_PATH],
  };
}

export function buildPersonaProjectedRuntimeBinding(input: {
  parentSessionId: string;
  personaName: string;
  runtime: PersonaContainerRuntime;
  containerMounts: Readonly<Record<string, MountRegistryEntry>>;
  executionEnv?: Record<string, string>;
  // Required for per_invocation; ignored for persistent.
  childSessionId?: string;
  scratchDirHostPath?: string;
}): RuntimeExecutionBinding {
  const runtimeSpec = buildProjectedRuntimeSpec({
    parentSessionId: input.parentSessionId,
    personaName: input.personaName,
    childSessionId: input.childSessionId,
    scratchDirHostPath: input.scratchDirHostPath,
    runtime: input.runtime,
    containerMounts: input.containerMounts,
  });

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
      helper: resolveRuntimeHelperDescriptor(),
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
