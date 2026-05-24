// ABOUTME: Constructs a platform-appropriate ContainerManager
// ABOUTME: Defaults Linux -> Docker, macOS -> Apple; LACE_CONTAINER_RUNTIME can override.

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';
import { DockerContainerRuntime } from './docker-container';
import { AppleContainerRuntime } from './apple-container';
import type { ContainerRuntime } from './types';

const CONTAINER_RUNTIME_ENV = 'LACE_CONTAINER_RUNTIME';
type ContainerRuntimeSelection = 'auto' | 'apple' | 'docker';

function parseContainerRuntimeSelection(value: string | undefined): ContainerRuntimeSelection {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return 'auto';
  if (normalized === 'apple' || normalized === 'docker') return normalized;
  throw new Error(`${CONTAINER_RUNTIME_ENV} must be one of: auto, apple, docker`);
}

export function createDefaultContainerManager(
  platform: NodeJS.Platform = process.platform,
  runtimeSelection: string | undefined = process.env[CONTAINER_RUNTIME_ENV]
): ContainerManager | null {
  let runtime: ContainerRuntime | null = null;
  const selection = parseContainerRuntimeSelection(runtimeSelection);

  if (selection === 'docker') {
    runtime = new DockerContainerRuntime();
  } else if (selection === 'apple') {
    runtime = new AppleContainerRuntime();
  } else if (platform === 'linux') {
    runtime = new DockerContainerRuntime();
  } else if (platform === 'darwin') {
    runtime = new AppleContainerRuntime();
  } else {
    logger.debug('containers.manager_factory.unsupported_platform', { platform });
    return null;
  }

  return new ContainerManager(runtime);
}
