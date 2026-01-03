import type { JsonRpcPeer } from '@lace/ent-protocol';
import { SessionIdSchema } from '@lace/ent-protocol';
import { SupervisorAgentProcess, type PermissionDecision } from './supervisor-agent-process';

export type WorkspaceSessionHandle = {
  workspaceSessionId: string;
  sessionId: string;
  workDir: string;
  pid: number;
};

export type SupervisorOptions = {
  laceDir: string;
  onSessionUpdate?: (workspaceSessionId: string, update: Record<string, unknown>) => void;
  onPermissionRequest?: (
    workspaceSessionId: string,
    params: Record<string, unknown>
  ) => Promise<PermissionDecision>;
};

export class Supervisor {
  private readonly laceDir: string;
  private readonly sessions = new Map<
    string,
    {
      agent: SupervisorAgentProcess;
      sessionId: string;
      workDir: string;
    }
  >();
  private nextWorkspaceSessionId = 1;
  private readonly onSessionUpdate?: SupervisorOptions['onSessionUpdate'];
  private readonly onPermissionRequest?: SupervisorOptions['onPermissionRequest'];

  constructor(options: SupervisorOptions) {
    this.laceDir = options.laceDir;
    this.onSessionUpdate = options.onSessionUpdate;
    this.onPermissionRequest = options.onPermissionRequest;
  }

  async createWorkspaceSession(workDir: string): Promise<WorkspaceSessionHandle> {
    const workspaceSessionId = `ws_${this.nextWorkspaceSessionId++}`;

    const agent = new SupervisorAgentProcess({
      laceDir: this.laceDir,
      onSessionUpdate: (update) => {
        if (this.onSessionUpdate) this.onSessionUpdate(workspaceSessionId, update);
      },
      onPermissionRequest: async (params) => {
        if (!this.onPermissionRequest) return { decision: 'deny' };
        return await this.onPermissionRequest(workspaceSessionId, params);
      },
    });

    await agent.peer.request('initialize', {
      protocolVersion: '1.0',
      config: { approvalMode: 'ask' },
    });

    const created = (await agent.peer.request('session/new', { workDir })) as { sessionId: string };

    this.sessions.set(workspaceSessionId, { agent, sessionId: created.sessionId, workDir });

    return {
      workspaceSessionId,
      sessionId: created.sessionId,
      workDir,
      pid: agent.proc.pid ?? -1,
    };
  }

  async attachWorkspaceSession(sessionId: string): Promise<WorkspaceSessionHandle> {
    if (!SessionIdSchema.safeParse(sessionId).success) {
      throw new Error('Invalid sessionId');
    }

    const workspaceSessionId = `ws_${this.nextWorkspaceSessionId++}`;

    const agent = new SupervisorAgentProcess({
      laceDir: this.laceDir,
      onSessionUpdate: (update) => {
        if (this.onSessionUpdate) this.onSessionUpdate(workspaceSessionId, update);
      },
      onPermissionRequest: async (params) => {
        if (!this.onPermissionRequest) return { decision: 'deny' };
        return await this.onPermissionRequest(workspaceSessionId, params);
      },
    });

    await agent.peer.request('initialize', {
      protocolVersion: '1.0',
      config: { approvalMode: 'ask' },
    });

    await agent.peer.request('session/load', { sessionId });

    const list = (await agent.peer.request('session/list', {})) as {
      sessions: Array<{ sessionId: string; workDir: string }>;
    };
    const meta = list.sessions.find((s) => s.sessionId === sessionId);
    if (!meta) {
      await agent.shutdown();
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.sessions.set(workspaceSessionId, { agent, sessionId, workDir: meta.workDir });

    return {
      workspaceSessionId,
      sessionId,
      workDir: meta.workDir,
      pid: agent.proc.pid ?? -1,
    };
  }

  getPeer(workspaceSessionId: string): JsonRpcPeer {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return found.agent.peer;
  }

  async prompt(workspaceSessionId: string, content: unknown[]): Promise<unknown> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return await found.agent.peer.request('session/prompt', { content });
  }

  async listProviders(workspaceSessionId: string): Promise<{
    providers: Array<{
      providerId: string;
      displayName: string;
      supportsConnections: boolean;
      supportsCatalogRefresh?: boolean;
    }>;
  }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/providers/list')) as any;
  }

  async listConnections(
    workspaceSessionId: string,
    params?: { providerId?: string }
  ): Promise<{
    connections: Array<{
      connectionId: string;
      providerId: string;
      name: string;
      credentialState?: string;
      accountLabel?: string;
    }>;
  }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/connections/list', params ?? {})) as any;
  }

  async upsertConnection(
    workspaceSessionId: string,
    params: {
      providerId?: string;
      connection: { connectionId?: string; name: string; config: Record<string, unknown> };
    }
  ): Promise<{ connectionId: string; providerId: string; created: boolean }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/connections/upsert', params)) as any;
  }

  async deleteConnection(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ ok: true }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/connections/delete', params)) as any;
  }

  async connectionCredentialStatus(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ connectionId: string; state: string; accountLabel?: string; expiresAt?: string }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/connections/credentials/status', params)) as any;
  }

  async connectionCredentialStart(
    workspaceSessionId: string,
    params: { connectionId: string; method?: 'api_key' | 'device_code' | 'browser' | 'token' }
  ): Promise<unknown> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return await found.agent.peer.request('ent/connections/credentials/start', params);
  }

  async connectionCredentialSubmit(
    workspaceSessionId: string,
    params: { connectionId: string; values: Record<string, string> }
  ): Promise<{ ok: boolean; error?: string }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/connections/credentials/submit', params)) as any;
  }

  async connectionCredentialClear(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ ok: true }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/connections/credentials/clear', params)) as any;
  }

  async listModels(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ providerId: string; connectionId: string; models: Array<{ modelId: string }> }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/models/list', params)) as any;
  }

  async listJobs(workspaceSessionId: string): Promise<{
    jobs: Array<{
      jobId: string;
      parentJobId?: string;
      type: string;
      status: string;
      description?: string;
      command?: string;
      startTime: string;
    }>;
  }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/job/list')) as any;
  }

  async jobOutput(
    workspaceSessionId: string,
    params: {
      jobId: string;
      block?: boolean;
      timeout?: number;
      tailBytes?: number;
      afterOffset?: number;
    }
  ): Promise<unknown> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return await found.agent.peer.request('ent/job/output', params);
  }

  async killJob(
    workspaceSessionId: string,
    params: { jobId: string }
  ): Promise<{ success: boolean }> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return (await found.agent.peer.request('ent/job/kill', params)) as any;
  }

  cancel(workspaceSessionId: string): void {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    found.agent.peer.notify('session/cancel');
  }

  async shutdownWorkspaceSession(workspaceSessionId: string): Promise<void> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) return;
    this.sessions.delete(workspaceSessionId);
    await found.agent.shutdown();
  }

  async shutdown(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.shutdownWorkspaceSession(id);
    }
  }
}
