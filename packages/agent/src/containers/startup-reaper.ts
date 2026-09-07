// ABOUTME: Best-effort orphan-container reaper invoked once at agent startup
// ABOUTME: Destroys this agent's own leaked lace- containers; failures never block boot

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';

/**
 * Reap the lace-prefixed containers THIS agent leaked behind a previous run.
 * The live set is empty because a booting agent owns no containers yet; the
 * blast radius is bounded by ContainerManager's `lace.owner` label check, which
 * spares containers belonging to other agents on the same host.
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
