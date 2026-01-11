// ABOUTME: Local workspace manager that runs directly on host without containers
// ABOUTME: Provides same interface as WorkspaceContainerManager for null-container mode

import { ExecOptions, ExecResult } from '@lace/agent/containers/types';
import { logger } from '@lace/agent/utils/logger';
import { executeCommand } from './command-runner';
import type { WorkspaceInfo } from './workspace-container-manager';
import type { IWorkspaceManager } from './workspace-manager';

/**
 * Local workspace manager that executes directly on the host system.
 * No containers, no cloning - uses the project directory directly.
 */
export class LocalWorkspaceManager implements IWorkspaceManager {
  private workspaces = new Map<string, WorkspaceInfo>();

  /**
   * Create a "workspace" that just uses the project directory directly
   */
  createWorkspace(projectDir: string, sessionId: string): Promise<WorkspaceInfo> {
    if (this.workspaces.has(sessionId)) {
      logger.info('Workspace already exists, returning existing', { sessionId });
      return Promise.resolve(this.workspaces.get(sessionId) as WorkspaceInfo);
    }

    logger.info('Creating local workspace (no container)', { projectDir, sessionId });

    const workspace: WorkspaceInfo = {
      sessionId,
      projectDir,
      clonePath: projectDir, // No clone, use project directly
      containerId: `local-${sessionId}`, // Fake container ID for consistency
      state: 'running', // Always "running" for local mode
    };

    this.workspaces.set(sessionId, workspace);

    logger.info('Local workspace created', { sessionId });

    return Promise.resolve(workspace);
  }

  /**
   * Destroy workspace (just remove from registry, no cleanup needed)
   */
  destroyWorkspace(sessionId: string): Promise<void> {
    this.workspaces.delete(sessionId);
    logger.info('Local workspace removed from registry', { sessionId });
    return Promise.resolve();
  }

  /**
   * Execute a command locally in the project directory
   */
  async executeInWorkspace(sessionId: string, options: ExecOptions): Promise<ExecResult> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    return executeCommand({
      command: options.command,
      cwd: options.workingDirectory ?? workspace.projectDir,
      timeout: options.timeout,
      environment: {
        ...options.environment,
        SESSION_ID: sessionId,
      },
    });
  }

  /**
   * Get info about a workspace
   */
  inspectWorkspace(sessionId: string): Promise<WorkspaceInfo | null> {
    return Promise.resolve(this.workspaces.get(sessionId) || null);
  }

  /**
   * List all active workspaces
   */
  listWorkspaces(): Promise<WorkspaceInfo[]> {
    return Promise.resolve(Array.from(this.workspaces.values()));
  }

  /**
   * No path translation needed for local execution
   */
  translateToContainer(sessionId: string, hostPath: string): string {
    return hostPath; // Pass through - no translation needed
  }

  /**
   * No path translation needed for local execution
   */
  translateToHost(sessionId: string, containerPath: string): string {
    return containerPath; // Pass through - no translation needed
  }
}
