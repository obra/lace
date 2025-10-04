// ABOUTME: Worktree workspace manager for git-isolated local execution
// ABOUTME: Creates git worktrees for session isolation without containers

import { ExecOptions, ExecResult } from '@lace/core/containers/types';
import { logger } from '@lace/core/utils/logger';
import { exec, execFile, ExecFileOptions } from 'child_process';
import { promisify } from 'util';
import type { WorkspaceInfo } from './workspace-container-manager';
import type { IWorkspaceManager } from './workspace-manager';
import { WorktreeManager } from './worktree-manager';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

    const commonOptions = {
      cwd: options.workingDirectory || workspace.clonePath, // Execute in worktree
      timeout: options.timeout || 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: {
        ...process.env,
        ...options.environment,
        SESSION_ID: sessionId,
      },
    };

    try {
      let stdout: Buffer | string;
      let stderr: Buffer | string;

      if (Array.isArray(options.command)) {
        // Use execFile for array commands - no shell interpretation
        const [command, ...args] = options.command;
        const execFileOptions: ExecFileOptions = {
          ...commonOptions,
          encoding: 'buffer',
        };
        const result = await execFileAsync(command, args, execFileOptions);
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        // String commands use exec with shell
        const execOptions = {
          ...commonOptions,
          encoding: 'buffer' as const,
        };
        const result = await execAsync(options.command, execOptions);
        stdout = result.stdout;
        stderr = result.stderr;
      }

      return {
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
        exitCode: 0,
      };
    } catch (error: unknown) {
      // Command executed but returned non-zero exit code
      if (error && typeof error === 'object' && 'code' in error) {
        const execError = error as {
          code?: number;
          stdout?: Buffer | string;
          stderr?: Buffer | string;
        };
        return {
          stdout: execError.stdout?.toString() || '',
          stderr: execError.stderr?.toString() || '',
          exitCode: typeof execError.code === 'number' ? execError.code : 1,
        };
      }
      throw error;
    }
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
