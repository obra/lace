// ABOUTME: Local workspace manager that runs directly on host without containers
// ABOUTME: Provides same interface as WorkspaceContainerManager for null-container mode

import { ExecOptions, ExecResult } from '@lace/core/containers/types';
import { logger } from '@lace/core/utils/logger';
import { exec, execFile, ExecFileOptions } from 'child_process';
import { promisify } from 'util';
import type { WorkspaceInfo } from './workspace-container-manager';
import type { IWorkspaceManager } from './workspace-manager';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

    const commonOptions = {
      cwd: options.workingDirectory || workspace.projectDir,
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
        // This prevents injection attacks by passing args directly to the executable
        const [command, ...args] = options.command;
        const execFileOptions: ExecFileOptions = {
          ...commonOptions,
          encoding: 'buffer',
        };
        const result = await execFileAsync(command, args, execFileOptions);
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        // String commands use exec with shell (needed for pipes, redirects, etc.)
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
