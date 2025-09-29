// ABOUTME: Local workspace manager that runs directly on host without containers
// ABOUTME: Provides same interface as WorkspaceContainerManager for null-container mode

import { ExecOptions, ExecResult } from '~/containers/types';
import { logger } from '~/utils/logger';
import { exec, ExecOptionsWithBufferEncoding } from 'child_process';
import { promisify } from 'util';
import type { WorkspaceInfo } from '~/workspace/workspace-container-manager';
import type { IWorkspaceManager } from '~/workspace/workspace-manager';

const execAsync = promisify(exec);

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
      throw new Error('Workspace already exists for session');
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

    // For array commands with shell invocation, we need special handling
    let command: string;
    if (Array.isArray(options.command)) {
      // If it's a shell command (sh -c), we need to properly quote the command
      if (options.command[0] === 'sh' && options.command[1] === '-c' && options.command[2]) {
        command = `sh -c "${options.command[2].replace(/"/g, '\\"')}"`;
      } else {
        command = options.command
          .map((arg) => {
            // Quote arguments that contain spaces or special characters
            if (/[\s"'`$\\]/.test(arg)) {
              return `"${arg.replace(/"/g, '\\"')}"`;
            }
            return arg;
          })
          .join(' ');
      }
    } else {
      command = options.command;
    }

    const execOptions: ExecOptionsWithBufferEncoding = {
      cwd: options.workingDirectory || workspace.projectDir,
      timeout: options.timeout || 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      encoding: 'buffer',
      env: {
        ...process.env,
        ...options.environment,
        SESSION_ID: sessionId,
      },
    };

    try {
      const { stdout, stderr } = await execAsync(command, execOptions);
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
