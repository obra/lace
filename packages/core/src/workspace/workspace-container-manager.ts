// ABOUTME: Manages containerized workspaces for isolated development sessions
// ABOUTME: Uses git worktrees with dual mounts for connected git workflow

import { ContainerRuntime, ContainerConfig, ExecOptions, ExecResult } from '~/containers/types';
import { WorktreeManager } from '~/workspace/worktree-manager';
import { logger } from '~/utils/logger';
import type { IWorkspaceManager } from '~/workspace/workspace-manager';
import { join } from 'path';

export interface WorkspaceInfo {
  sessionId: string;
  projectDir: string;
  clonePath: string; // For worktrees, this is the worktree path
  containerId: string;
  state: string;
  containerMountPath?: string; // Path where project is mounted inside container
  branchName?: string; // Git branch name for this session
}

export class WorkspaceContainerManager implements IWorkspaceManager {
  private workspaces = new Map<string, WorkspaceInfo>();

  constructor(private runtime: ContainerRuntime) {}

  /**
   * Create a new containerized workspace for a session
   */
  async createWorkspace(projectDir: string, sessionId: string): Promise<WorkspaceInfo> {
    // Check if workspace already exists (in memory or on system)
    const existing = await this.inspectWorkspace(sessionId);
    if (existing) {
      logger.info('Workspace already exists, returning existing', {
        sessionId,
        state: existing.state,
      });
      // Update project directory in case it was missing
      if (!existing.projectDir) {
        existing.projectDir = projectDir;
      }
      return existing;
    }

    logger.info('Creating workspace', { projectDir, sessionId });

    // Create git worktree for this session
    const worktreePath = await WorktreeManager.createSessionWorktree(projectDir, sessionId);
    const branchName = WorktreeManager.getSessionBranchName(sessionId);

    // Define where to mount in the container
    const containerMountPath = '/workspace';
    const gitDirMount = '/workspace/.git-main';

    // Get the git directory path for this worktree (used in environment setup)
    const _gitWorktreeDir = join(projectDir, '.git', 'worktrees', sessionId);

    // Get user's git configuration
    const gitConfig = await this.getGitUserConfig();

    // Create container with dual mounts: working tree + git database
    const containerConfig: ContainerConfig = {
      id: `workspace-${sessionId}`,
      workingDirectory: containerMountPath,
      mounts: [
        {
          source: worktreePath,
          target: containerMountPath,
          readonly: false,
        },
        {
          source: join(projectDir, '.git'),
          target: gitDirMount,
          readonly: false, // Need write access for commits
        },
      ],
      environment: {
        NODE_ENV: 'development',
        SESSION_ID: sessionId,
        // Configure git to use the mounted directories
        GIT_DIR: `${gitDirMount}/worktrees/${sessionId}`,
        GIT_WORK_TREE: containerMountPath,
        // Pass through user's git identity
        ...gitConfig,
      },
    };

    const containerId = await this.runtime.create(containerConfig);
    await this.runtime.start(containerId);

    const workspace: WorkspaceInfo = {
      sessionId,
      projectDir,
      clonePath: worktreePath,
      containerId,
      state: 'running',
      containerMountPath,
      branchName,
    };

    this.workspaces.set(sessionId, workspace);

    logger.info('Workspace created', { sessionId, containerId });

    return workspace;
  }

  /**
   * Destroy a workspace (remove container and worktree)
   * Note: Keeps the session branch by default - user can merge or delete manually
   */
  async destroyWorkspace(sessionId: string): Promise<void> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      return; // Already destroyed
    }

    logger.info('Destroying workspace', { sessionId });

    try {
      // Stop and remove container
      await this.runtime.stop(workspace.containerId);
      await this.runtime.remove(workspace.containerId);
    } catch (error) {
      logger.warn('Failed to remove container', { sessionId, error });
    }

    try {
      // Remove worktree but keep branch (user may want to merge it)
      await WorktreeManager.removeSessionWorktree(workspace.projectDir, sessionId, false);
    } catch (error) {
      logger.warn('Failed to remove worktree', { sessionId, error });
    }

    this.workspaces.delete(sessionId);

    logger.info('Workspace destroyed', { sessionId, branchKept: workspace.branchName });
  }

  /**
   * Execute a command in a workspace container
   */
  async executeInWorkspace(sessionId: string, options: ExecOptions): Promise<ExecResult> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    return this.runtime.exec(workspace.containerId, options);
  }

  /**
   * Get info about a workspace, checking both memory and system state
   */
  async inspectWorkspace(sessionId: string): Promise<WorkspaceInfo | null> {
    // First check in-memory cache
    let workspace = this.workspaces.get(sessionId);

    // If not in memory, check if container and worktree still exist on system
    if (!workspace) {
      const containerId = `workspace-${sessionId}`;

      // Check if container exists
      try {
        const containerInfo = await this.runtime.inspect(containerId);

        // Check if worktree exists
        const worktreePath = WorktreeManager.getWorktreePath(sessionId);
        const { existsSync } = await import('fs');

        if (containerInfo && existsSync(worktreePath)) {
          // Reconstruct workspace info from existing resources
          const branchName = WorktreeManager.getSessionBranchName(sessionId);
          workspace = {
            sessionId,
            projectDir: '', // Will be set when needed
            clonePath: worktreePath,
            containerId,
            state: containerInfo.state,
            containerMountPath: '/workspace', // Standard mount path
            branchName,
          };

          // Cache it for future lookups
          this.workspaces.set(sessionId, workspace);

          logger.info('Found existing workspace resources, restored to cache', {
            sessionId,
            containerId,
            worktreePath,
            branchName,
            state: containerInfo.state,
          });
        }
      } catch (error) {
        // Container or worktree doesn't exist, return null
        logger.debug('No existing workspace found', { sessionId, error });
        return null;
      }
    }

    if (!workspace) {
      return null;
    }

    // Update state from container runtime
    try {
      const containerInfo = await this.runtime.inspect(workspace.containerId);
      workspace.state = containerInfo.state;
    } catch {
      workspace.state = 'unknown';
    }

    return workspace;
  }

  /**
   * List all active workspaces
   */
  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    const workspaces: WorkspaceInfo[] = [];

    for (const workspace of this.workspaces.values()) {
      // Update state from container runtime
      try {
        const containerInfo = await this.runtime.inspect(workspace.containerId);
        workspace.state = containerInfo.state;
        workspaces.push({ ...workspace });
      } catch {
        // Container doesn't exist, clean up
        this.workspaces.delete(workspace.sessionId);
      }
    }

    return workspaces;
  }

  /**
   * Translate host path to container path for a workspace
   */
  translateToContainer(sessionId: string, hostPath: string): string {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      return hostPath;
    }

    return this.runtime.translateToContainer(hostPath, workspace.containerId);
  }

  /**
   * Translate container path to host path for a workspace
   */
  translateToHost(sessionId: string, containerPath: string): string {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      return containerPath;
    }

    return this.runtime.translateToHost(containerPath, workspace.containerId);
  }

  /**
   * Get user's git configuration to pass into container
   */
  private async getGitUserConfig(): Promise<Record<string, string>> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const config: Record<string, string> = {};

    try {
      // Get user name
      const { stdout: name } = await execAsync('git config --global user.name');
      if (name.trim()) {
        config.GIT_AUTHOR_NAME = name.trim();
        config.GIT_COMMITTER_NAME = name.trim();
      }
    } catch {
      // Not set, will use defaults
    }

    try {
      // Get user email
      const { stdout: email } = await execAsync('git config --global user.email');
      if (email.trim()) {
        config.GIT_AUTHOR_EMAIL = email.trim();
        config.GIT_COMMITTER_EMAIL = email.trim();
      }
    } catch {
      // Not set, will use defaults
    }

    logger.debug('Git user config for container', { config });

    return config;
  }
}
