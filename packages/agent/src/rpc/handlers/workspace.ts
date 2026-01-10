// ABOUTME: Workspace management RPC handlers for directory info and initialization

import type { JsonRpcPeer } from '@lace/ent-protocol';
import { WorkspaceManagerFactory } from '../../workspace/workspace-manager';
import { assertInitialized, toNonEmptyString, throwInvalidParams } from '../utils';
import type { AgentServerState } from '../../server-types';

/**
 * Register workspace management handlers with the peer.
 * Handles:
 * - info: Get workspace information for a session
 * - create: Create a new workspace for a session
 */
export function registerWorkspaceHandlers(peer: JsonRpcPeer, state: AgentServerState): void {
  peer.onRequest('ent/workspace/info', async (params: unknown) => {
    assertInitialized(state);
    const parsed = params as { sessionId?: string };
    const sessionId = toNonEmptyString(parsed?.sessionId);
    if (!sessionId) throwInvalidParams('sessionId is required');

    const workspaceManager = WorkspaceManagerFactory.get();
    const workspace = await workspaceManager.inspectWorkspace(sessionId);
    if (!workspace) {
      throw {
        code: -32603,
        message: 'WorkspaceNotFound',
        data: { category: 'workspace', sessionId },
      };
    }

    return {
      sessionId: workspace.sessionId,
      projectDir: workspace.projectDir,
      clonePath: workspace.clonePath,
      containerId: workspace.containerId,
      state: workspace.state,
      containerMountPath: workspace.containerMountPath,
      branchName: workspace.branchName,
    };
  });

  peer.onRequest('ent/workspace/create', async (params: unknown) => {
    assertInitialized(state);
    const parsed = params as { projectDir?: string; sessionId?: string };
    const projectDir = toNonEmptyString(parsed?.projectDir);
    const sessionId = toNonEmptyString(parsed?.sessionId);
    if (!projectDir) throwInvalidParams('projectDir is required');
    if (!sessionId) throwInvalidParams('sessionId is required');

    const workspaceManager = WorkspaceManagerFactory.get();
    const workspace = await workspaceManager.createWorkspace(projectDir, sessionId);

    return {
      sessionId: workspace.sessionId,
      projectDir: workspace.projectDir,
      clonePath: workspace.clonePath,
      containerId: workspace.containerId,
      state: workspace.state,
      containerMountPath: workspace.containerMountPath,
      branchName: workspace.branchName,
    };
  });
}
