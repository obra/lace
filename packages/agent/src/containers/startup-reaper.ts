// ABOUTME: Best-effort orphan-container reaper invoked once at agent startup
// ABOUTME: Destroys lace-prefixed containers not in the live spec set; failures never block boot

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';
import { AppleContainerRuntime } from './apple-container';
import { DockerContainerRuntime } from './docker-container';

/**
 * Construct a ContainerManager appropriate for the host platform. Returns null
 * when no supported container runtime exists (e.g. Windows). Callers should
 * treat null as "skip container work".
 *
 * Platform mapping:
 *   - darwin → AppleContainerRuntime (macOS `container` CLI)
 *   - linux  → DockerContainerRuntime (docker CLI)
 *   - other  → null
 */
export function createContainerManagerForPlatform(): ContainerManager | null {
  if (process.platform === 'darwin') {
    return new ContainerManager(new AppleContainerRuntime());
  }
  if (process.platform === 'linux') {
    return new ContainerManager(new DockerContainerRuntime());
  }
  return null;
}

/**
 * Reap every lace-prefixed container on the host that is not in liveSpecNames.
 * For v1 liveSpecNames is always empty — boot is a clean slate.
 *
 * Best-effort: a null manager (unsupported platform) or any thrown error logs
 * and returns. Reaper failure must never block agent startup.
 */
export async function runStartupReaper(manager: ContainerManager | null): Promise<void> {
  if (manager === null) {
    logger.debug('Startup reaper: no container runtime for this platform, skipping');
    return;
  }
  try {
    const result = await manager.reapOrphans('', new Set<string>());
    if (result.reaped.length > 0) {
      logger.info('Reaped orphan containers at startup', { reaped: result.reaped });
    } else {
      logger.debug('Startup reaper: nothing to reap');
    }
  } catch (err) {
    logger.warn('Reaper failed at startup; continuing', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
