// ABOUTME: Manages containerized workspaces for isolated development sessions
// ABOUTME: Integrates git clones with container runtime for secure code execution

import { ContainerRuntime, ContainerConfig, ExecOptions, ExecResult } from '~/containers/types';
import { CloneManager } from './clone-manager';
import { logger } from '~/utils/logger';
import type { IWorkspaceManager } from './workspace-manager';

export interface WorkspaceInfo {
  sessionId: string;
  projectDir: string;
  clonePath: string;
  containerId: string;
  state: string;
}

export class WorkspaceContainerManager implements IWorkspaceManager {
  private workspaces = new Map<string, WorkspaceInfo>();

  constructor(private runtime: ContainerRuntime) {}

  /**
   * Create a new containerized workspace for a session
   */
  async createWorkspace(projectDir: string, sessionId: string): Promise<WorkspaceInfo> {
    if (this.workspaces.has(sessionId)) {
      throw new Error('Workspace already exists for session');
    }

    logger.info('Creating workspace', { projectDir, sessionId });

    // Create local clone
    const clonePath = await CloneManager.createSessionClone(projectDir, sessionId);

    // Create container with clone mounted
    const containerConfig: ContainerConfig = {
      id: `workspace-${sessionId}`,
      workingDirectory: '/workspace',
      mounts: [
        {
          source: clonePath,
          target: '/workspace',
          readonly: false,
        },
      ],
      environment: {
        NODE_ENV: 'development',
        SESSION_ID: sessionId,
      },
    };

    const containerId = await this.runtime.create(containerConfig);
    await this.runtime.start(containerId);

    const workspace: WorkspaceInfo = {
      sessionId,
      projectDir,
      clonePath,
      containerId,
      state: 'running',
    };

    this.workspaces.set(sessionId, workspace);

    logger.info('Workspace created', { sessionId, containerId });

    return workspace;
  }

  /**
   * Destroy a workspace (remove container and clone)
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
      // Remove clone
      await CloneManager.removeSessionClone(sessionId);
    } catch (error) {
      logger.warn('Failed to remove clone', { sessionId, error });
    }

    this.workspaces.delete(sessionId);

    logger.info('Workspace destroyed', { sessionId });
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
   * Get info about a workspace
   */
  async inspectWorkspace(sessionId: string): Promise<WorkspaceInfo | null> {
    const workspace = this.workspaces.get(sessionId);
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
}
