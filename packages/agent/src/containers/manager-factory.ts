// ABOUTME: Constructs a platform-appropriate ContainerManager
// ABOUTME: Defaults Linux -> Docker, macOS -> Apple; LACE_CONTAINER_RUNTIME can override.

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';
import { DockerContainerRuntime } from './docker-container';
import { ShimContainerRuntime } from './shim-container-runtime';
import { AppleContainerRuntime } from './apple-container';
import type { ContainerRuntime } from './types';

const CONTAINER_RUNTIME_ENV = 'LACE_CONTAINER_RUNTIME';
// When set, lace drives an external docker shim instead of docker directly. The value
// is the wrapper binary that the runtime shells out to. Unset = direct docker.
const DOCKER_BIN_ENV = 'LACE_DOCKER_BIN';

// The docker-backed runtime: the external shim when LACE_DOCKER_BIN is set
// (create()->spawn over the wrapper), else direct DockerContainerRuntime.
function makeDockerRuntime(): ContainerRuntime {
  const shimBin = process.env[DOCKER_BIN_ENV]?.trim();
  if (shimBin) {
    logger.info('containers.manager_factory.shim', { dockerBin: shimBin });
    return new ShimContainerRuntime(shimBin);
  }
  return new DockerContainerRuntime();
}
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
    runtime = makeDockerRuntime();
  } else if (selection === 'apple') {
    runtime = new AppleContainerRuntime();
  } else if (platform === 'linux') {
    runtime = makeDockerRuntime();
  } else if (platform === 'darwin') {
    runtime = new AppleContainerRuntime();
  } else {
    logger.debug('containers.manager_factory.unsupported_platform', { platform });
    return null;
  }

  return new ContainerManager(runtime);
}
