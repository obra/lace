// ABOUTME: Worktree workspace manager for git-isolated local execution
// ABOUTME: Creates git worktrees for session isolation without containers

import { ExecOptions, ExecResult } from '@lace/agent/containers/types';
import { logger } from '@lace/agent/utils/logger';
import { executeCommand } from './command-runner';
import type { WorkspaceInfo } from './workspace-container-manager';
import type { IWorkspaceManager } from './workspace-manager';
import { WorktreeManager } from './worktree-manager';

/**
 * Worktree workspace manager that creates git worktrees for session isolation.
 * Executes commands locally (on host) but with file isolation via git worktrees.
 */
export class WorktreeWorkspaceManager implements IWorkspaceManager {
  private workspaces = new Map<string, WorkspaceInfo>();

  /**
   * Create a git worktree for the session
   */
  async createWorkspace(projectDir: string, sessionId: string): Promise<WorkspaceInfo> {
    // Check if workspace already exists
    if (this.workspaces.has(sessionId)) {
      logger.info('Worktree workspace already exists, returning existing', { sessionId });
      return this.workspaces.get(sessionId) as WorkspaceInfo;
    }

    logger.info('Creating worktree workspace (local execution)', { projectDir, sessionId });

    // Create git worktree for this session
    const worktreePath = await WorktreeManager.createSessionWorktree(projectDir, sessionId);
    const branchName = WorktreeManager.getSessionBranchName(sessionId);

    const workspace: WorkspaceInfo = {
      sessionId,
      projectDir, // Original project location
      clonePath: worktreePath, // Worktree path
      containerId: `worktree-${sessionId}`, // Pseudo-container ID for consistency
      state: 'running', // Always "running" for local execution
      branchName,
    };

    this.workspaces.set(sessionId, workspace);

    logger.info('Worktree workspace created', {
      sessionId,
      worktreePath,
      branchName,
    });

    return workspace;
  }

  /**
   * Destroy workspace (remove worktree)
   */
  async destroyWorkspace(sessionId: string): Promise<void> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      logger.warn('Workspace not found for destruction', { sessionId });
      return;
    }

    logger.info('Destroying worktree workspace', { sessionId });

    // Remove the git worktree
    await WorktreeManager.removeSessionWorktree(workspace.projectDir, sessionId);

    this.workspaces.delete(sessionId);

    logger.info('Worktree workspace destroyed', { sessionId });
  }

  /**
   * Execute a command locally in the worktree directory
   */
  async executeInWorkspace(sessionId: string, options: ExecOptions): Promise<ExecResult> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    return executeCommand({
      command: options.command,
      cwd: options.workingDirectory ?? workspace.clonePath, // Execute in worktree
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
   * List all active worktree workspaces
   */
  listWorkspaces(): Promise<WorkspaceInfo[]> {
    return Promise.resolve(Array.from(this.workspaces.values()));
  }

  /**
   * No path translation needed for local execution
   */
  translateToContainer(sessionId: string, hostPath: string): string {
    return hostPath; // No container, no translation
  }

  /**
   * No path translation needed for local execution
   */
  translateToHost(sessionId: string, containerPath: string): string {
    return containerPath; // No container, no translation
  }
}
