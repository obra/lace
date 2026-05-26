import { HostToolRuntime } from './host';
import { BoundedHostToolRuntime } from './bounded-host';
import {
  ProjectedContainerToolRuntime,
  type ProjectedContainerManager,
  type ProjectedContainerToolRuntimeDescriptor,
} from './projected-container';
import type { RuntimeSecretResolver } from './secrets';
import type { RuntimeExecutionBinding, ToolRuntime } from './types';

export function createToolRuntimeFromBinding(input: {
  binding: RuntimeExecutionBinding;
  env?: NodeJS.ProcessEnv;
  containerManager?: ProjectedContainerManager | null;
  sessionId?: string;
  secretResolver?: RuntimeSecretResolver;
}): ToolRuntime {
  const runtime = input.binding.toolRuntime;

  if (runtime.type === 'host') {
    return new HostToolRuntime({
      id: input.binding.identity.runtimeId,
      cwd: runtime.cwd,
      env: input.env,
    });
  }

  if (runtime.type === 'boundedHost') {
    return new BoundedHostToolRuntime({
      id: input.binding.identity.runtimeId,
      root: runtime.root,
      cwd: runtime.cwd,
      env: input.env,
    });
  }

  if (runtime.type !== 'container') {
    throw new Error(`Unsupported tool runtime type: ${(runtime as { type: string }).type}`);
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
