// ABOUTME: Build host-side projected RuntimeExecutionBinding for container personas
// ABOUTME: Used by delegate when agentPlacement: host — projects container tools to host agent

import type { MountRegistryEntry } from '@lace/agent/server-types';
import { buildRuntimeId } from '@lace/agent/tools/runtime/identity';
import type {
  RuntimeExecutionBinding,
  RuntimeHelperDescriptor,
} from '@lace/agent/tools/runtime/types';
import { fileURLToPath } from 'node:url';
import {
  buildPersonaContainerSpec,
  containerSpecToRuntimeSpec,
  type PersonaContainerRuntime,
} from './persona-container-spec';

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
}): RuntimeExecutionBinding {
  const spec = buildPersonaContainerSpec({
    parentSessionId: input.parentSessionId,
    personaName: input.personaName,
    runtime: input.runtime,
    containerMounts: input.containerMounts,
  });

  const binding: RuntimeExecutionBinding = {
    schemaVersion: 1,
    identity: { runtimeId: 'pending' },
    agentPlacement: 'host',
    toolRuntime: {
      type: 'container',
      spec: containerSpecToRuntimeSpec({ spec }),
      cwd: input.runtime.workingDirectory,
      helper: resolveRuntimeHelperDescriptor(),
    },
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
