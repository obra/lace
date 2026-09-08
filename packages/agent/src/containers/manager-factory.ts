// ABOUTME: Constructs a platform-appropriate ContainerManager
// ABOUTME: Defaults Linux -> Docker, macOS -> Apple; LACE_CONTAINER_RUNTIME can override.

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';
import { DockerContainerRuntime } from './docker-container';
import { PlaneRuntime } from './plane-runtime';
import { AppleContainerRuntime } from './apple-container';
import { registries } from '@lace/agent/plugins';
import { getEnvVar } from '@lace/agent/config/env-loader';
import * as path from 'path';
import type { ContainerRuntime } from './types';

export const CONTAINER_RUNTIME_ENV = 'LACE_CONTAINER_RUNTIME';
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

/**
 * Identity for the containers this agent creates: an explicitly configured
 * LACE_DIR, or null when there is none.
 *
 * The identity has to satisfy two properties at once: survive a restart of this
 * agent (so a crashed agent still recognizes and reaps its own leaked
 * containers) and differ from every other agent on the host (so neither reaps
 * the other's). An explicit LACE_DIR satisfies both — it is durable, and giving
 * a second agent its own LACE_DIR is how you run two agents in the first place.
 *
 * `getLaceDir()`'s ~/.lace default does NOT: every agent this OS user runs
 * lands on the same path, so an id derived from it is stable but not distinct,
 * and two concurrent agents would reap each other exactly as before this label
 * existed. Nothing else available at boot fixes that — anything durable under a
 * shared LACE_DIR is shared too, and anything distinct (pid, boot time, a fresh
 * random) is lost on restart. So we return null and the caller fails closed:
 * no owner stamped, nothing reaped. Set LACE_DIR to turn reaping back on.
 *
 * `path.resolve`, not `fs.realpathSync`: under the usual `current ->
 * releases/N` deploy shape, resolving the symlink would change this agent's
 * identity at every release and strand every container created before the swap
 * as unowned, hence unreapable by anyone. Two different spellings of one
 * directory read as two agents, which costs a leak rather than a wrong destroy.
 */
export function containerOwnerId(): string | null {
  const laceDir = getEnvVar('LACE_DIR')?.trim();
  if (!laceDir) return null;
  return path.resolve(laceDir);
}

export function createDefaultContainerManager(
  platform: NodeJS.Platform = process.platform,
  runtimeSelection: string | undefined = process.env[CONTAINER_RUNTIME_ENV]
): ContainerManager | null {
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

  return new ContainerManager(registries.runtimes.resolve(name), containerOwnerId());
}
