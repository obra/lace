// ABOUTME: Constructs a platform-appropriate ContainerManager
// ABOUTME: Defaults Linux -> Docker, macOS -> Apple; LACE_CONTAINER_RUNTIME can override.

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';
import { DockerContainerRuntime } from './docker-container';
import { PlaneRuntime } from './plane-runtime';
import { AppleContainerRuntime } from './apple-container';
import { SpawnBrokerContainerRuntime } from './spawn-broker-runtime';
import { registries } from '@lace/agent/plugins';
import type { ContainerRuntime } from './types';

export const CONTAINER_RUNTIME_ENV = 'LACE_CONTAINER_RUNTIME';
// PRI-2012: when set, main-sen has NO docker.sock and reaches Docker only through
// the spawn broker at this socket path. Selecting the broker runtime here is what
// makes the closed spawn surface hold in production.
const SPAWN_BROKER_SOCKET_ENV = 'SEN_SPAWN_BROKER_SOCKET';
const DOCKER_BIN_ENV = 'LACE_DOCKER_BIN';

function makeDockerRuntime(): ContainerRuntime {
  return new DockerContainerRuntime();
}

/**
 * Make a lazy-construction proxy for a ContainerRuntime. The factory fn is not
 * called until the first property access on the proxy, so platform-specific
 * side-effects in constructors (e.g. AppleContainerRuntime starting the
 * container daemon) are deferred until the runtime is actually used.
 */
function makeLazyRuntime(factory: () => ContainerRuntime): ContainerRuntime {
  let instance: ContainerRuntime | null = null;
  const get = (): ContainerRuntime => {
    if (instance === null) {
      instance = factory();
    }
    return instance;
  };
  return new Proxy({} as ContainerRuntime, {
    get(_target, prop: string | symbol) {
      return (get() as unknown as Record<string | symbol, unknown>)[prop];
    },
  });
}

/**
 * Register built-in container runtimes into the plugin registry.
 *
 * Guard: checks the registry-state sentinel (!registries.runtimes.has('docker'))
 * rather than a bare module boolean, so this is robust to resetRegistriesForTest()
 * clearing the registry between test cases.
 *
 * AppleContainerRuntime is registered lazily to avoid platform-specific constructor
 * side-effects (async daemon start) when running on Linux.
 */
export function registerBuiltinRuntimes(): void {
  if (!registries.runtimes.has('docker')) {
    registries.runtimes.register('docker', makeDockerRuntime(), 'builtin');
  }

  const planeBin = process.env[DOCKER_BIN_ENV]?.trim();
  if (planeBin && !registries.runtimes.has('plane')) {
    logger.info('containers.manager_factory.plane', { dockerBin: planeBin });
    registries.runtimes.register('plane', new PlaneRuntime(planeBin), 'builtin');
  }

  if (!registries.runtimes.has('apple')) {
    registries.runtimes.register(
      'apple',
      makeLazyRuntime(() => new AppleContainerRuntime()),
      'builtin'
    );
  }
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

  // Ensure built-ins are available whether called at module-load or boot.
  // Same pattern as registerAllAvailableTools calling registerBuiltinTools.
  registerBuiltinRuntimes();

  const sel = runtimeSelection?.trim().toLowerCase() || 'auto';
  const name: string | null =
    sel === 'auto'
      ? platform === 'linux'
        ? 'docker'
        : platform === 'darwin'
          ? 'apple'
          : null
      : sel;

  if (name === null) {
    logger.debug('containers.manager_factory.unsupported_platform', { platform });
    return null;
  }

  if (!registries.runtimes.has(name)) {
    throw new Error(`${CONTAINER_RUNTIME_ENV}="${name}" but no runtime registered under that name`);
  }

  return new ContainerManager(registries.runtimes.resolve(name));
}
