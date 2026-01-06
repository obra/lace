// ABOUTME: Web-facing supervisor client singleton
// ABOUTME: Runs supervisor in-process and bridges updates into EventStreamManager SSE broadcasts

import {
  agentMethodHandlers,
  PendingPermissionsTracker,
  Supervisor,
  SupervisorClient,
  type PendingPermission,
  type SupervisorServerEvent,
  type SupervisorSessionUpdate,
} from '@lace/supervisor';
import { ensureLaceDir } from '@lace/web/lib/server/lace-imports';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import type {
  ProtocolEvent,
  PermissionRequestEvent,
  SessionUpdate,
} from '@lace/web/types/protocol-events';

declare global {
  var laceWebSupervisorClient: SupervisorClient | undefined;
  var laceWebSupervisor: Supervisor | undefined;
  var laceWebPendingPermissions: PendingPermissionsTracker | undefined;
}

/**
 * Create a ProtocolEvent wrapper from a supervisor session update.
 * This preserves the raw protocol update data without translation.
 */
function createProtocolEvent(params: {
  workspaceSessionId: string;
  projectId?: string;
  agentSessionId: string;
  update: SupervisorSessionUpdate;
}): ProtocolEvent {
  const { workspaceSessionId, projectId, agentSessionId, update } = params;

  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    update: update as SessionUpdate, // SupervisorSessionUpdate matches SessionUpdate shape
    workspaceSessionId,
    projectId,
    agentSessionId,
  };
}

/**
 * Create a PermissionRequestEvent wrapper from a supervisor permission request.
 */
function createPermissionRequestEvent(params: {
  workspaceSessionId: string;
  projectId?: string;
  request: SupervisorServerEvent & { type: 'permission_request' };
}): PermissionRequestEvent {
  const { workspaceSessionId, projectId, request } = params;

  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    request: request.request,
    workspaceSessionId,
    projectId,
  };
}

function bridgeEventToWeb(event: SupervisorServerEvent, params: { supervisorProjectId?: string }) {
  const manager = EventStreamManager.getInstance();

  if (event.type === 'session_update') {
    const protocolEvent = createProtocolEvent({
      workspaceSessionId: event.workspaceSessionId,
      projectId: params.supervisorProjectId,
      agentSessionId: event.update.sessionId,
      update: event.update,
    });
    manager.broadcast(protocolEvent);
    return;
  }

  if (event.type === 'permission_request') {
    const permissionEvent = createPermissionRequestEvent({
      workspaceSessionId: event.workspaceSessionId,
      projectId: params.supervisorProjectId,
      request: event,
    });
    manager.broadcast(permissionEvent);
  }
}

class InProcessSupervisorClient extends SupervisorClient {
  private readonly supervisor: Supervisor;
  private readonly pendingPermissions: PendingPermissionsTracker;

  constructor(params: { supervisor: Supervisor; pendingPermissions: PendingPermissionsTracker }) {
    super({ baseUrl: 'http://127.0.0.1/in-process' });
    this.supervisor = params.supervisor;
    this.pendingPermissions = params.pendingPermissions;
  }

  override async health(): Promise<{ ok: true }> {
    return { ok: true };
  }

  override async shutdown(): Promise<void> {
    this.pendingPermissions.shutdown();
    await this.supervisor.shutdown();
  }

  override async listWorkspaceSessions() {
    return this.supervisor.listWorkspaceSessions();
  }

  override async getWorkspaceSession(workspaceSessionId: string) {
    return this.supervisor.getWorkspaceSession(workspaceSessionId);
  }

  override async createWorkspaceSession(workDir: string) {
    return await this.supervisor.createWorkspaceSession(workDir);
  }

  override async attachWorkspaceSession(sessionId: string) {
    return await this.supervisor.attachWorkspaceSession(sessionId);
  }

  override async updateWorkspaceSession(
    workspaceSessionId: string,
    updates: { projectId?: string; name?: string }
  ) {
    this.supervisor.updateWorkspaceSession(workspaceSessionId, updates);
    const record = this.supervisor.getWorkspaceSession(workspaceSessionId);
    if (!record) throw new Error('Session not found');
    return record;
  }

  override async deleteWorkspaceSession(workspaceSessionId: string) {
    const ok = await this.supervisor.deleteWorkspaceSession(workspaceSessionId);
    this.pendingPermissions.clearWorkspace(workspaceSessionId);
    return { ok };
  }

  override async createAgentSession(workspaceSessionId: string) {
    return await this.supervisor.createAgentSession(workspaceSessionId);
  }

  override async upsertAgentSessionMeta(
    workspaceSessionId: string,
    params: { sessionId: string; name?: string; connectionId?: string; modelId?: string }
  ) {
    this.supervisor.upsertAgentSessionMeta(workspaceSessionId, params);
  }

  override async prompt(workspaceSessionId: string, content: unknown) {
    return await this.supervisor.prompt(workspaceSessionId, content as never);
  }

  override async promptSession(workspaceSessionId: string, sessionId: string, content: unknown) {
    return await this.supervisor.promptSession(workspaceSessionId, sessionId, content as never);
  }

  override async agentRequest(params: {
    workspaceSessionId: string;
    sessionId?: string;
    method: string;
    requestParams?: unknown;
  }) {
    const handler = agentMethodHandlers[params.method];
    if (!handler || handler.kind !== 'request') {
      throw new Error(`Unsupported request method: ${params.method}`);
    }

    const parsedParams = handler.paramsSchema.parse(params.requestParams ?? {}) as unknown;
    const peer = await this.supervisor.getPeer(params.workspaceSessionId, params.sessionId);
    const result = await peer.request(params.method, parsedParams);
    return handler.resultSchema.parse(result) as unknown;
  }

  override async agentNotify(params: {
    workspaceSessionId: string;
    sessionId?: string;
    method: string;
    notifyParams?: unknown;
  }) {
    const handler = agentMethodHandlers[params.method];
    if (!handler || handler.kind !== 'notify') {
      throw new Error(`Unsupported notify method: ${params.method}`);
    }

    const parsedParams = handler.paramsSchema.parse(params.notifyParams ?? {}) as unknown;
    const peer = await this.supervisor.getPeer(params.workspaceSessionId, params.sessionId);
    peer.notify(params.method, parsedParams);
  }

  override async listPendingPermissions(workspaceSessionId: string): Promise<PendingPermission[]> {
    return this.pendingPermissions.listPendingPermissions(workspaceSessionId);
  }

  override async resolvePendingPermission(params: {
    workspaceSessionId: string;
    toolCallId: string;
    decision: 'allow' | 'deny';
    updatedInput?: Record<string, unknown>;
  }): Promise<boolean> {
    const resolved = this.pendingPermissions.resolvePendingPermission(params);
    if (!resolved.ok) {
      if (resolved.error === 'ambiguous') throw new Error('Tool call is ambiguous');
      return false;
    }
    return true;
  }
}

function ensureInProcessSupervisor(): {
  supervisor: Supervisor;
  pendingPermissions: PendingPermissionsTracker;
} {
  if (global.laceWebSupervisor && global.laceWebPendingPermissions) {
    return {
      supervisor: global.laceWebSupervisor,
      pendingPermissions: global.laceWebPendingPermissions,
    };
  }

  const laceDir = ensureLaceDir();
  const pendingPermissions = new PendingPermissionsTracker();
  const supervisor = new Supervisor({
    laceDir,
    onSessionUpdate: (workspaceSessionId, update) => {
      pendingPermissions.onSessionUpdate(workspaceSessionId, update);

      const projectId = supervisor.getWorkspaceSession(workspaceSessionId)?.projectId;
      bridgeEventToWeb(
        {
          type: 'session_update',
          workspaceSessionId,
          ...(projectId ? { projectId } : {}),
          update,
        },
        { supervisorProjectId: projectId }
      );
    },
    onPermissionRequest: async (workspaceSessionId, params) => {
      const projectId = supervisor.getWorkspaceSession(workspaceSessionId)?.projectId;
      const { toolCall, waitForDecision } = pendingPermissions.startPermissionRequest(
        workspaceSessionId,
        params
      );

      bridgeEventToWeb(
        {
          type: 'permission_request',
          workspaceSessionId,
          ...(projectId ? { projectId } : {}),
          request: params,
          ...(toolCall ? { toolCall } : {}),
          requestedAt: new Date().toISOString(),
        },
        { supervisorProjectId: projectId }
      );

      return await waitForDecision;
    },
  });

  global.laceWebSupervisor = supervisor;
  global.laceWebPendingPermissions = pendingPermissions;

  return { supervisor, pendingPermissions };
}

export async function getSupervisor(): Promise<SupervisorClient> {
  if (global.laceWebSupervisorClient) return global.laceWebSupervisorClient;

  const { supervisor, pendingPermissions } = ensureInProcessSupervisor();
  global.laceWebSupervisorClient = new InProcessSupervisorClient({
    supervisor,
    pendingPermissions,
  });
  return global.laceWebSupervisorClient;
}

export async function listPendingPermissions(
  workspaceSessionId: string
): Promise<PendingPermission[]> {
  const supervisor = await getSupervisor();
  return await supervisor.listPendingPermissions(workspaceSessionId);
}

export async function resolvePendingPermission(params: {
  workspaceSessionId: string;
  toolCallId: string;
  decision: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
}): Promise<boolean> {
  const supervisor = await getSupervisor();
  return await supervisor.resolvePendingPermission(params);
}

export async function shutdownSupervisorForTests(): Promise<void> {
  const client = global.laceWebSupervisorClient;
  global.laceWebSupervisorClient = undefined;

  const supervisor = global.laceWebSupervisor;
  global.laceWebSupervisor = undefined;

  const pendingPermissions = global.laceWebPendingPermissions;
  global.laceWebPendingPermissions = undefined;

  pendingPermissions?.shutdown();

  if (client) {
    try {
      await client.shutdown();
      return;
    } catch {
      // fall through
    }
  }

  if (supervisor) {
    try {
      await supervisor.shutdown();
    } catch {
      // ignore
    }
  }
}
