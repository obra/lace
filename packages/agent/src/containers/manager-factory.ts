// ABOUTME: Constructs a platform-appropriate ContainerManager
// ABOUTME: Defaults Linux -> Docker, macOS -> Apple; LACE_CONTAINER_RUNTIME can override.

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';
import { DockerContainerRuntime } from './docker-container';
import { AppleContainerRuntime } from './apple-container';
import { SpawnBrokerContainerRuntime } from './spawn-broker-runtime';
import type { ContainerRuntime } from './types';

const CONTAINER_RUNTIME_ENV = 'LACE_CONTAINER_RUNTIME';
// PRI-2012: when set, main-sen has NO docker.sock and reaches Docker only through
// the spawn broker at this socket path. Selecting the broker runtime here is what
// makes the closed spawn surface hold in production.
const SPAWN_BROKER_SOCKET_ENV = 'SEN_SPAWN_BROKER_SOCKET';
type ContainerRuntimeSelection = 'auto' | 'apple' | 'docker';

function parseContainerRuntimeSelection(value: string | undefined): ContainerRuntimeSelection {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return 'auto';
  if (normalized === 'apple' || normalized === 'docker') return normalized;
  throw new Error(`${CONTAINER_RUNTIME_ENV} must be one of: auto, apple, docker`);
}

export function createDefaultContainerManager(
  platform: NodeJS.Platform = process.platform,
  runtimeSelection: string | undefined = process.env[CONTAINER_RUNTIME_ENV],
  spawnBrokerSocket: string | undefined = process.env[SPAWN_BROKER_SOCKET_ENV]
): ContainerManager | null {
  // The spawn broker takes precedence over platform + LACE_CONTAINER_RUNTIME:
  // when its socket is configured, main-sen has no docker.sock and MUST route all
  // container ops through the broker (PRI-2012 Root A). No local Docker/Apple.
  const brokerSocket = spawnBrokerSocket?.trim();
  if (brokerSocket) {
    logger.debug('containers.manager_factory.spawn_broker', { socketPath: brokerSocket });
    return new ContainerManager(new SpawnBrokerContainerRuntime({ socketPath: brokerSocket }));
  }

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
