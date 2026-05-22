import { HostToolRuntime } from './host';
import {
  ProjectedContainerToolRuntime,
  type ProjectedContainerManager,
  type ProjectedContainerToolRuntimeDescriptor,
} from './projected-container';
import type { RuntimeSecretResolver } from './secrets';
import type { RuntimeExecutionBinding, ToolRuntime } from './types';
import { WorkspaceToolRuntime } from './workspace';

export function createToolRuntimeFromBinding(input: {
  binding: RuntimeExecutionBinding;
  env?: NodeJS.ProcessEnv;
  containerManager?: ProjectedContainerManager | null;
  sessionId?: string;
  secretResolver?: RuntimeSecretResolver;
}): ToolRuntime {
  if (input.binding.agentPlacement !== 'host') {
    throw new Error(
      `Cannot create host-side tool runtime for ${input.binding.agentPlacement} agent placement`
    );
  }

  const runtime = input.binding.toolRuntime;

  if (runtime.type === 'local') {
    return new HostToolRuntime({
      id: input.binding.identity.runtimeId,
      cwd: runtime.cwd,
      env: input.env,
    });
  }

  if (runtime.type === 'workspace') {
    return new WorkspaceToolRuntime({
      id: input.binding.identity.runtimeId,
      projectRoot: runtime.projectRoot,
      workspaceRoot: runtime.workspaceRoot,
      cwd: runtime.cwd,
      env: input.env,
    });
  }

  if (!input.containerManager) {
    throw new Error('Container runtime unavailable for projected tool runtime');
  }

  const descriptor: ProjectedContainerToolRuntimeDescriptor = {
    spec: runtime.spec,
    cwd: runtime.cwd,
    ...(runtime.helper ? { helper: runtime.helper } : {}),
  };

  return new ProjectedContainerToolRuntime({
    id: input.binding.identity.runtimeId,
    containerManager: input.containerManager,
    descriptor,
    sessionId: input.sessionId,
    secretResolver: input.secretResolver,
  });
}
