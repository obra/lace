// ABOUTME: Shared test setup for core Lace tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and workspace cleanup

import { useTempLaceDir, type TempLaceDirContext } from './temp-lace-dir';
import { beforeEach, afterEach } from 'vitest';
import { logger } from '@lace/core/utils/logger';

export interface EnhancedTempLaceDirContext extends TempLaceDirContext {
  /** Register a cleanup function to be called in afterEach */
  registerCleanup: (fn: () => void | Promise<void>) => void;
}

/**
 * Complete test setup for core tests - handles temp LACE_DIR isolation and persistence reset
 * Use this instead of manually calling useTempLaceDir() and setupTestPersistence()
 *
 * Persistence automatically initializes to ${LACE_DIR}/lace.db on first use via getPersistence()
 *
 * @returns Enhanced TempLaceDirContext with cleanup registry for tests that need access to the temp directory
 */
export function setupCoreTest(): EnhancedTempLaceDirContext {
  const tempLaceDir = useTempLaceDir();
  const cleanupTasks: (() => void | Promise<void>)[] = [];

  beforeEach(() => {
    cleanupTasks.length = 0; // Reset cleanup tasks
  });

  // Run all registered cleanup tasks after each test
  afterEach(async () => {
    // Run all registered cleanup tasks
    for (const cleanup of cleanupTasks) {
      try {
        await cleanup();
      } catch (error) {
        console.warn('Cleanup task failed:', error);
      }
    }

    // Clean up workspaces before resetting factory
    const { WorkspaceManagerFactory } = await import('@lace/agent/workspace/workspace-manager');
    try {
      // Only clean up worktree mode (default) - it's fast and reliable
      // Container mode tests should handle their own cleanup
      const worktreeManager = WorkspaceManagerFactory.get('worktree');
      const workspaces = await worktreeManager.listWorkspaces();

      for (const workspace of workspaces) {
        try {
          // Worktree cleanup should be fast - 3s timeout
          await Promise.race([
            worktreeManager.destroyWorkspace(workspace.sessionId),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Worktree cleanup timeout')), 3000)
            ),
          ]);
        } catch (error) {
          // Log but continue - best effort cleanup
          logger.warn('Failed to cleanup worktree workspace', {
            sessionId: workspace.sessionId,
            error,
          });
        }
      }
    } catch {
      // Ignore errors - workspace manager may not exist
    }

    // Reset workspace manager singletons
    WorkspaceManagerFactory.reset();
  });

  return {
    get tempDir() {
      return tempLaceDir.tempDir;
    },
    get originalLaceDir() {
      return tempLaceDir.originalLaceDir;
    },
    set originalLaceDir(value: string | undefined) {
      tempLaceDir.originalLaceDir = value;
    },
    registerCleanup: (fn: () => void | Promise<void>) => cleanupTasks.push(fn),
  };
}
