// ABOUTME: Best-effort orphan-container reaper invoked once at agent startup
// ABOUTME: Destroys lace-prefixed containers not in the live spec set; failures never block boot

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';
import { createDefaultContainerManager } from './manager-factory';

/**
 * Construct a ContainerManager appropriate for the host platform. Returns null
 * when no supported container runtime exists (e.g. Windows). Callers should
 * treat null as "skip container work".
 *
 * Honors the same LACE_CONTAINER_RUNTIME override as the agent server.
 *
 * Default platform mapping:
 *   - darwin → AppleContainerRuntime (macOS `container` CLI)
 *   - linux  → DockerContainerRuntime (docker CLI)
 *   - other  → null
 */
export function createContainerManagerForPlatform(): ContainerManager | null {
  return createDefaultContainerManager();
}

/**
 * Reap every lace-prefixed container on the host that is not in liveSpecNames.
 * For v1 liveSpecNames is always empty — boot is a clean slate.
 *
 * Best-effort: a null manager (unsupported platform) or any thrown error logs
 * and returns. Reaper failure must never block agent startup.
 *
 * Snapshot semantics: reapOrphans calls runtime.list() once at the start and
 * iterates that snapshot. Containers materialized after the snapshot (e.g. by
 * a delegate spawned while the reaper is running in the background) are not
 * candidates for destruction in this pass.
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
