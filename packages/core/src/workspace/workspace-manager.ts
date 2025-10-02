// ABOUTME: Common interface and factory for workspace managers
// ABOUTME: Supports both containerized and local (null-container) execution modes

import { ExecOptions, ExecResult } from '~/containers/types';
import { WorkspaceContainerManager, WorkspaceInfo } from '~/workspace/workspace-container-manager';
import { LocalWorkspaceManager } from '~/workspace/local-workspace-manager';
import { WorktreeWorkspaceManager } from '~/workspace/worktree-workspace-manager';
import { AppleContainerRuntime } from '~/containers/apple-container';
import { logger } from '~/utils/logger';

/**
 * Common interface for all workspace managers.
 * Can be implemented by containerized or local execution backends.
 */
export interface IWorkspaceManager {
  createWorkspace(projectDir: string, sessionId: string): Promise<WorkspaceInfo>;
  destroyWorkspace(sessionId: string): Promise<void>;
  executeInWorkspace(sessionId: string, options: ExecOptions): Promise<ExecResult>;
  inspectWorkspace(sessionId: string): Promise<WorkspaceInfo | null>;
  listWorkspaces(): Promise<WorkspaceInfo[]>;
  translateToContainer(sessionId: string, hostPath: string): string;
  translateToHost(sessionId: string, containerPath: string): string;
}

export type WorkspaceMode = 'container' | 'worktree' | 'local';

/**
 * Default workspace mode for all environments.
 * Worktree mode is safe, reliable, and works everywhere.
 */
export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = 'worktree';

/**
 * Factory for creating workspace managers based on mode.
 * Managers are singletons - only one instance per mode.
 */
export class WorkspaceManagerFactory {
  private static containerManager: WorkspaceContainerManager | undefined;
  private static worktreeManager: WorktreeWorkspaceManager | undefined;
  private static localManager: LocalWorkspaceManager | undefined;

  /**
   * Get the workspace manager for the specified mode.
   * Returns the same instance for each mode (singleton pattern).
   * Defaults to DEFAULT_WORKSPACE_MODE.
   */
  static get(mode?: WorkspaceMode): IWorkspaceManager {
    const selectedMode = mode || DEFAULT_WORKSPACE_MODE;
    switch (selectedMode) {
      case 'container':
        // For now, only support Apple containers on macOS
        // TODO: Add DockerContainerRuntime for Linux (#325)
        if (process.platform !== 'darwin') {
          logger.warn(
            'Container mode not supported on this platform, falling back to worktree mode',
            {
              platform: process.platform,
            }
          );
          return this.getWorktreeManager();
        }
        return this.getContainerManager();

      case 'worktree':
        return this.getWorktreeManager();

      case 'local':
      default:
        return this.getLocalManager();
    }
  }

  private static getContainerManager(): WorkspaceContainerManager {
    if (!this.containerManager) {
      logger.info('Creating singleton container workspace manager');
      this.containerManager = new WorkspaceContainerManager(new AppleContainerRuntime());
    }
    return this.containerManager;
  }

  private static getWorktreeManager(): WorktreeWorkspaceManager {
    if (!this.worktreeManager) {
      logger.info('Creating singleton worktree workspace manager');
      this.worktreeManager = new WorktreeWorkspaceManager();
    }
    return this.worktreeManager;
  }

  private static getLocalManager(): LocalWorkspaceManager {
    if (!this.localManager) {
      logger.info('Creating singleton local workspace manager');
      this.localManager = new LocalWorkspaceManager();
    }
    return this.localManager;
  }

  /**
   * Clear singleton instances (mainly for testing)
   */
  static reset(): void {
    this.containerManager = undefined;
    this.worktreeManager = undefined;
    this.localManager = undefined;
  }
}
