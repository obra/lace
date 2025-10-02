// ABOUTME: Shared test setup for core Lace tests
// ABOUTME: Provides unified setup that handles temp LACE_DIR and persistence automatically

import { useTempLaceDir, type TempLaceDirContext } from '~/test-utils/temp-lace-dir';
import { resetPersistence } from '~/persistence/database';
import { beforeEach, afterEach } from 'vitest';
import { Session } from '~/sessions/session';
import { logger } from '~/utils/logger';

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

  // Reset persistence before each test - it will auto-initialize to temp directory on first use
  beforeEach(() => {
    resetPersistence();
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

    // Clean up any remaining worktrees from workspace managers before resetting
    const { WorkspaceManagerFactory } = await import('~/workspace/workspace-manager');
    try {
      // Get all managers and clean up their workspaces
      const managers = ['worktree', 'local', 'container'] as const;
      for (const mode of managers) {
        try {
          const manager = WorkspaceManagerFactory.get(mode);
          const workspaces = await manager.listWorkspaces();
          for (const workspace of workspaces) {
            try {
              await manager.destroyWorkspace(workspace.sessionId);
            } catch (_error) {
              // Ignore cleanup errors - best effort
            }
          }
        } catch (_error) {
          // Manager may not exist or may fail - ignore
        }
      }
    } catch (_error) {
      // Ignore any errors during workspace cleanup
    }

    // Reset workspace manager singletons AFTER all workspaces destroyed
    WorkspaceManagerFactory.reset();
  });

  return {
    ...tempLaceDir,
    registerCleanup: (fn: () => void | Promise<void>) => cleanupTasks.push(fn),
  };
}

/**
 * Clean up a test session including workspace and registry removal.
 * This replaces the Session.destroy() method which was test-only.
 */
export async function cleanupSession(session: Session): Promise<void> {
  // Wait for workspace initialization if it's in progress
  await session.waitForWorkspace();

  // Stop and cleanup all agents
  const agents = session.getAgents();
  for (const agent of agents) {
    agent.stop();
    agent.removeAllListeners();
  }

  // Clear agents from session (mimics what destroy() used to do)
  // Using unknown to avoid unsafe any operations
  const sessionWithAgents = session as unknown as { _agents: Map<string, unknown> };
  sessionWithAgents._agents.clear();

  // Clean up task notification listeners
  session.cleanup();

  // Remove from registry
  Session.removeFromRegistry(session.getId());

  // Destroy workspace if it exists
  const workspaceManager = session.getWorkspaceManager();
  const workspaceInfo = session.getWorkspaceInfo();
  if (workspaceManager && workspaceInfo) {
    try {
      await workspaceManager.destroyWorkspace(workspaceInfo.sessionId);
      logger.info('Test cleanup: Workspace destroyed for session', { sessionId: session.getId() });
    } catch (error) {
      logger.warn('Test cleanup: Failed to destroy workspace', {
        sessionId: session.getId(),
        error,
      });
    }
  }

  // Shutdown MCP servers for this session
  const mcpServerManager = session.getMCPServerManager();
  await mcpServerManager.shutdown();
}
