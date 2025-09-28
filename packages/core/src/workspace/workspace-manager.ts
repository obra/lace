// ABOUTME: Common interface and factory for workspace managers
// ABOUTME: Supports both containerized and local (null-container) execution modes

import { ExecOptions, ExecResult } from '~/containers/types';
import { WorkspaceContainerManager, WorkspaceInfo } from './workspace-container-manager';
import { LocalWorkspaceManager } from './local-workspace-manager';
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

export type WorkspaceMode = 'container' | 'local';

/**
 * Factory for creating workspace managers based on mode
 */
export class WorkspaceManagerFactory {
  /**
   * Create a workspace manager based on the specified mode
   */
  static create(mode: WorkspaceMode = 'local'): IWorkspaceManager {
    logger.info('Creating workspace manager', { mode });

    switch (mode) {
      case 'container':
        // For now, only support Apple containers on macOS
        // TODO: Add DockerContainerRuntime for Linux (#325)
        if (process.platform !== 'darwin') {
          logger.warn('Container mode not supported on this platform, falling back to local mode', {
            platform: process.platform,
          });
          return new LocalWorkspaceManager();
        }
        return new WorkspaceContainerManager(new AppleContainerRuntime());

      case 'local':
      default:
        return new LocalWorkspaceManager();
    }
  }
}
