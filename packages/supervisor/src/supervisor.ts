import type { JsonRpcPeer } from '@lace/ent-protocol';
import { SessionIdSchema } from '@lace/ent-protocol';
import { SupervisorAgentProcess, type PermissionDecision } from './supervisor-agent-process';
import { WorkspaceSessionStore, type WorkspaceSessionRecord } from './workspace-session-store';

export type WorkspaceSessionHandle = {
  workspaceSessionId: string;
  sessionId: string;
  workDir: string;
  pid: number;
};

export type AgentSessionHandle = {
  sessionId: string;
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
  private readonly store: WorkspaceSessionStore;
  private readonly sessions = new Map<
    string,
    {
      workDir: string;
      primarySessionId: string;
      agentsBySessionId: Map<string, SupervisorAgentProcess>;
    }
  >();
  private readonly onSessionUpdate?: SupervisorOptions['onSessionUpdate'];
  private readonly onPermissionRequest?: SupervisorOptions['onPermissionRequest'];

  constructor(options: SupervisorOptions) {
    this.laceDir = options.laceDir;
    this.store = new WorkspaceSessionStore(this.laceDir);
    this.onSessionUpdate = options.onSessionUpdate;
    this.onPermissionRequest = options.onPermissionRequest;
  }

  private requireWorkspace(workspaceSessionId: string) {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return found;
  }

  private requireAgent(workspaceSessionId: string, sessionId?: string) {
    const ws = this.requireWorkspace(workspaceSessionId);
    const resolvedSessionId = sessionId ?? ws.primarySessionId;
    const agent = ws.agentsBySessionId.get(resolvedSessionId);
    if (!agent) {
      throw new Error(
        `Unknown sessionId for workspaceSessionId ${workspaceSessionId}: ${resolvedSessionId}`
      );
    }
    return { agent, sessionId: resolvedSessionId, workDir: ws.workDir };
  }

  private async spawnNewAgentSession(
    workspaceSessionId: string,
    workDir: string
  ): Promise<{ agent: SupervisorAgentProcess; sessionId: string; pid: number }> {
    let activeSessionId: string | undefined;

    const agent = new SupervisorAgentProcess({
      laceDir: this.laceDir,
      onSessionUpdate: (update) => {
        if (!activeSessionId) return;
        if (this.onSessionUpdate)
          this.onSessionUpdate(workspaceSessionId, { sessionId: activeSessionId, ...update });
      },
      onPermissionRequest: async (params) => {
        if (!activeSessionId) return { decision: 'deny' };
        if (!this.onPermissionRequest) return { decision: 'deny' };
        return await this.onPermissionRequest(workspaceSessionId, {
          sessionId: activeSessionId,
          ...params,
        });
      },
    });

    await agent.peer.request('initialize', {
      protocolVersion: '1.0',
      config: { approvalMode: 'ask' },
    });

    const created = (await agent.peer.request('session/new', { workDir })) as { sessionId: string };
    activeSessionId = created.sessionId;

    return { agent, sessionId: created.sessionId, pid: agent.proc.pid ?? -1 };
  }

  private async spawnLoadedAgentSession(
    workspaceSessionId: string,
    sessionId: string
  ): Promise<{ agent: SupervisorAgentProcess; workDir: string; pid: number }> {
    let activeSessionId: string | undefined = sessionId;

    const agent = new SupervisorAgentProcess({
      laceDir: this.laceDir,
      onSessionUpdate: (update) => {
        if (!activeSessionId) return;
        if (this.onSessionUpdate)
          this.onSessionUpdate(workspaceSessionId, { sessionId: activeSessionId, ...update });
      },
      onPermissionRequest: async (params) => {
        if (!activeSessionId) return { decision: 'deny' };
        if (!this.onPermissionRequest) return { decision: 'deny' };
        return await this.onPermissionRequest(workspaceSessionId, {
          sessionId: activeSessionId,
          ...params,
        });
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

    return { agent, workDir: meta.workDir, pid: agent.proc.pid ?? -1 };
  }

  async createWorkspaceSession(workDir: string): Promise<WorkspaceSessionHandle> {
    const workspaceSessionId = this.store.createWorkspaceSessionId();
    this.store.create(workspaceSessionId, workDir);

    this.sessions.set(workspaceSessionId, {
      workDir,
      primarySessionId: '',
      agentsBySessionId: new Map(),
    });

    const created = await this.createAgentSession(workspaceSessionId);

    const ws = this.requireWorkspace(workspaceSessionId);
    ws.primarySessionId = created.sessionId;

    return {
      workspaceSessionId,
      workDir,
      sessionId: created.sessionId,
      pid: created.pid,
    };
  }

  async attachWorkspaceSession(sessionId: string): Promise<WorkspaceSessionHandle> {
    if (!SessionIdSchema.safeParse(sessionId).success) {
      throw new Error('Invalid sessionId');
    }

    const workspaceSessionId = this.store.createWorkspaceSessionId();

    const loaded = await this.spawnLoadedAgentSession(workspaceSessionId, sessionId);

    this.store.create(workspaceSessionId, loaded.workDir);
    this.store.upsertAgent(workspaceSessionId, { sessionId });

    this.sessions.set(workspaceSessionId, {
      workDir: loaded.workDir,
      primarySessionId: sessionId,
      agentsBySessionId: new Map([[sessionId, loaded.agent]]),
    });

    return {
      workspaceSessionId,
      sessionId,
      workDir: loaded.workDir,
      pid: loaded.pid,
    };
  }

  async createAgentSession(workspaceSessionId: string): Promise<AgentSessionHandle> {
    const ws = this.requireWorkspace(workspaceSessionId);

    const created = await this.spawnNewAgentSession(workspaceSessionId, ws.workDir);
    ws.agentsBySessionId.set(created.sessionId, created.agent);

    if (!ws.primarySessionId) ws.primarySessionId = created.sessionId;
    this.store.upsertAgent(workspaceSessionId, { sessionId: created.sessionId });

    return { sessionId: created.sessionId, pid: created.pid };
  }

  getPeer(workspaceSessionId: string, sessionId?: string): JsonRpcPeer {
    return this.requireAgent(workspaceSessionId, sessionId).agent.peer;
  }

  async prompt(workspaceSessionId: string, content: unknown[]): Promise<unknown> {
    this.store.touch(workspaceSessionId);
    return await this.getPeer(workspaceSessionId).request('session/prompt', { content });
  }

  async promptSession(
    workspaceSessionId: string,
    sessionId: string,
    content: unknown[]
  ): Promise<unknown> {
    this.store.touch(workspaceSessionId);
    return await this.getPeer(workspaceSessionId, sessionId).request('session/prompt', { content });
  }

  listWorkspaceSessions(): WorkspaceSessionRecord[] {
    return this.store.list();
  }

  async listProviders(workspaceSessionId: string): Promise<{
    providers: Array<{
      providerId: string;
      displayName: string;
      supportsConnections: boolean;
      supportsCatalogRefresh?: boolean;
    }>;
  }> {
    return (await this.getPeer(workspaceSessionId).request('ent/providers/list')) as any;
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
    return (await this.getPeer(workspaceSessionId).request(
      'ent/connections/list',
      params ?? {}
    )) as any;
  }

  async upsertConnection(
    workspaceSessionId: string,
    params: {
      providerId?: string;
      connection: { connectionId?: string; name: string; config: Record<string, unknown> };
    }
  ): Promise<{ connectionId: string; providerId: string; created: boolean }> {
    return (await this.getPeer(workspaceSessionId).request(
      'ent/connections/upsert',
      params
    )) as any;
  }

  async deleteConnection(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ ok: true }> {
    return (await this.getPeer(workspaceSessionId).request(
      'ent/connections/delete',
      params
    )) as any;
  }

  async connectionCredentialStatus(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ connectionId: string; state: string; accountLabel?: string; expiresAt?: string }> {
    return (await this.getPeer(workspaceSessionId).request(
      'ent/connections/credentials/status',
      params
    )) as any;
  }

  async connectionCredentialStart(
    workspaceSessionId: string,
    params: { connectionId: string; method?: 'api_key' | 'device_code' | 'browser' | 'token' }
  ): Promise<unknown> {
    return await this.getPeer(workspaceSessionId).request(
      'ent/connections/credentials/start',
      params
    );
  }

  async connectionCredentialSubmit(
    workspaceSessionId: string,
    params: { connectionId: string; values: Record<string, string> }
  ): Promise<{ ok: boolean; error?: string }> {
    return (await this.getPeer(workspaceSessionId).request(
      'ent/connections/credentials/submit',
      params
    )) as any;
  }

  async connectionCredentialClear(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ ok: true }> {
    return (await this.getPeer(workspaceSessionId).request(
      'ent/connections/credentials/clear',
      params
    )) as any;
  }

  async listModels(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ providerId: string; connectionId: string; models: Array<{ modelId: string }> }> {
    return (await this.getPeer(workspaceSessionId).request('ent/models/list', params)) as any;
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
    return (await this.getPeer(workspaceSessionId).request('ent/job/list')) as any;
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
    return await this.getPeer(workspaceSessionId).request('ent/job/output', params);
  }

  async killJob(
    workspaceSessionId: string,
    params: { jobId: string }
  ): Promise<{ success: boolean }> {
    return (await this.getPeer(workspaceSessionId).request('ent/job/kill', params)) as any;
  }

  cancel(workspaceSessionId: string): void {
    this.getPeer(workspaceSessionId).notify('session/cancel');
  }

  async shutdownWorkspaceSession(workspaceSessionId: string): Promise<void> {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) return;
    this.sessions.delete(workspaceSessionId);
    const agents = Array.from(found.agentsBySessionId.values());
    for (const agent of agents) {
      await agent.shutdown();
    }
  }

  async shutdown(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.shutdownWorkspaceSession(id);
    }
  }
}
