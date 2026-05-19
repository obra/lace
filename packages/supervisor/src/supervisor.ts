import { z } from 'zod';
import {
  EntConnectionsCredentialsClearRequestSchema,
  EntConnectionsCredentialsClearResponseSchema,
  EntConnectionsCredentialsStartRequestSchema,
  EntConnectionsCredentialsStartResponseSchema,
  EntConnectionsCredentialsStatusRequestSchema,
  EntConnectionsCredentialsStatusResponseSchema,
  EntConnectionsCredentialsSubmitRequestSchema,
  EntConnectionsCredentialsSubmitResponseSchema,
  EntConnectionsDeleteRequestSchema,
  EntConnectionsDeleteResponseSchema,
  EntConnectionsListRequestSchema,
  EntConnectionsListResponseSchema,
  EntConnectionsUpsertRequestSchema,
  EntConnectionsUpsertResponseSchema,
  EntJobKillRequestSchema,
  EntJobKillResponseSchema,
  EntJobListRequestSchema,
  EntJobListResponseSchema,
  EntJobOutputRequestSchema,
  EntJobOutputResponseSchema,
  EntModelsListRequestSchema,
  EntModelsListResponseSchema,
  EntProvidersListRequestSchema,
  EntProvidersListResponseSchema,
  InitializeRequestSchema,
  InitializeResponseSchema,
  isSessionId,
  type JsonRpcPeer,
  type SessionId,
  type ToolPolicy,
  SessionListRequestSchema,
  SessionListResponseSchema,
  SessionLoadRequestSchema,
  SessionLoadResponseSchema,
  SessionNewRequestSchema,
  SessionNewResponseSchema,
  SessionPromptRequestSchema,
  SessionPromptResponseSchema,
} from '@lace/ent-protocol';
import {
  SupervisorAgentProcess,
  type PermissionDecision,
  type PermissionRequestParams,
  type SessionUpdateParams,
} from './supervisor-agent-process';
import { WorkspaceSessionStore, type WorkspaceSessionRecord } from './workspace-session-store';

type InitializeParams = z.infer<typeof InitializeRequestSchema>['params'];
type SessionPromptParams = z.infer<typeof SessionPromptRequestSchema>['params'];
type SessionPromptResult = z.infer<typeof SessionPromptResponseSchema>['result'];

function supervisorInitializeParams(config?: Record<string, unknown>): InitializeParams {
  return InitializeRequestSchema.shape.params.parse({
    protocolVersion: '1.0',
    clientInfo: { name: 'lace-supervisor', version: '0.1.0' },
    capabilities: { streaming: true, permissions: true, 'ent/jobStreaming': 'full' },
    ...(config ? { config } : {}),
  });
}

export type WorkspaceSessionHandle = {
  workspaceSessionId: string;
  sessionId: SessionId;
  workDir: string;
  pid: number;
};

export type AgentSessionHandle = {
  sessionId: SessionId;
  pid: number;
};

export type CreateAgentSessionOptions = {
  persona?: string;
};

export type SupervisorOptions = {
  storeDir: string;
  onSessionUpdate?: (workspaceSessionId: string, update: SessionUpdateParams) => void;
  onPermissionRequest?: (
    workspaceSessionId: string,
    params: PermissionRequestParams
  ) => Promise<PermissionDecision>;
};

export class Supervisor {
  private readonly storeDir: string;
  private readonly store: WorkspaceSessionStore;
  private readonly sessions = new Map<
    string,
    {
      workDir: string;
      primarySessionId: SessionId | null;
      agentsBySessionId: Map<SessionId, SupervisorAgentProcess>;
    }
  >();
  private readonly onSessionUpdate?: SupervisorOptions['onSessionUpdate'];
  private readonly onPermissionRequest?: SupervisorOptions['onPermissionRequest'];

  constructor(options: SupervisorOptions) {
    this.storeDir = options.storeDir;
    this.store = new WorkspaceSessionStore(this.storeDir);
    this.onSessionUpdate = options.onSessionUpdate;
    this.onPermissionRequest = options.onPermissionRequest;
  }

  private requireWorkspace(workspaceSessionId: string) {
    const found = this.sessions.get(workspaceSessionId);
    if (!found) throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    return found;
  }

  private async ensureActive(workspaceSessionId: string): Promise<void> {
    if (this.sessions.has(workspaceSessionId)) return;
    await this.activateWorkspaceSession(workspaceSessionId);
  }

  private requireAgent(workspaceSessionId: string, sessionId?: string) {
    const ws = this.requireWorkspace(workspaceSessionId);
    const resolvedSessionId = sessionId
      ? (sessionId as SessionId)
      : (ws.primarySessionId ?? undefined);
    if (!resolvedSessionId) {
      throw new Error(`No primary session for workspaceSessionId ${workspaceSessionId}`);
    }
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
    workDir: string,
    options?: CreateAgentSessionOptions
  ): Promise<{ agent: SupervisorAgentProcess; sessionId: SessionId; pid: number }> {
    // eslint-disable-next-line prefer-const -- assigned after session/new so early agent updates are ignored
    let activeSessionId: SessionId | undefined;

    const agent = new SupervisorAgentProcess({
      onSessionUpdate: (update) => {
        if (!activeSessionId) return;
        if (update.sessionId !== activeSessionId) return;
        if (this.onSessionUpdate) this.onSessionUpdate(workspaceSessionId, update);
      },
      onPermissionRequest: async (params) => {
        if (!activeSessionId) return { decision: 'deny' };
        if (params.sessionId !== activeSessionId) return { decision: 'deny' };

        const toolPolicy = this.store
          .get(workspaceSessionId)
          ?.agents.find((a) => a.sessionId === activeSessionId)?.toolPolicies?.[params.tool];
        if (toolPolicy === 'allow') return { decision: 'allow' };
        if (toolPolicy === 'deny' || toolPolicy === 'disable') return { decision: 'deny' };

        if (!this.onPermissionRequest) return { decision: 'deny' };
        return await this.onPermissionRequest(workspaceSessionId, params);
      },
    });

    await requestEnt(
      agent.peer,
      'initialize',
      InitializeRequestSchema.shape.params,
      InitializeResponseSchema.shape.result,
      supervisorInitializeParams({ approvalMode: 'ask' })
    );

    const created = await requestEnt(
      agent.peer,
      'session/new',
      SessionNewRequestSchema.shape.params,
      SessionNewResponseSchema.shape.result,
      { cwd: workDir, mcpServers: [], ...(options?.persona ? { persona: options.persona } : {}) }
    );
    activeSessionId = created.sessionId;

    return { agent, sessionId: created.sessionId, pid: agent.proc.pid ?? -1 };
  }

  private async spawnLoadedAgentSession(
    workspaceSessionId: string,
    sessionId: SessionId
  ): Promise<{ agent: SupervisorAgentProcess; workDir: string; pid: number }> {
    const activeSessionId: SessionId = sessionId;

    const agent = new SupervisorAgentProcess({
      onSessionUpdate: (update) => {
        if (!activeSessionId) return;
        if (update.sessionId !== activeSessionId) return;
        if (this.onSessionUpdate) this.onSessionUpdate(workspaceSessionId, update);
      },
      onPermissionRequest: async (params) => {
        if (!activeSessionId) return { decision: 'deny' };
        if (params.sessionId !== activeSessionId) return { decision: 'deny' };

        const toolPolicy = this.store
          .get(workspaceSessionId)
          ?.agents.find((a) => a.sessionId === activeSessionId)?.toolPolicies?.[params.tool];
        if (toolPolicy === 'allow') return { decision: 'allow' };
        if (toolPolicy === 'deny' || toolPolicy === 'disable') return { decision: 'deny' };

        if (!this.onPermissionRequest) return { decision: 'deny' };
        return await this.onPermissionRequest(workspaceSessionId, params);
      },
    });

    await requestEnt(
      agent.peer,
      'initialize',
      InitializeRequestSchema.shape.params,
      InitializeResponseSchema.shape.result,
      supervisorInitializeParams({ approvalMode: 'ask' })
    );

    const stored = this.store.get(workspaceSessionId);
    if (!stored) {
      await agent.shutdown();
      throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    }

    await requestEnt(
      agent.peer,
      'session/load',
      SessionLoadRequestSchema.shape.params,
      SessionLoadResponseSchema.shape.result,
      { sessionId, cwd: stored.workDir, mcpServers: [] }
    );

    const list = await requestEnt(
      agent.peer,
      'session/list',
      SessionListRequestSchema.shape.params,
      SessionListResponseSchema.shape.result,
      {}
    );
    const meta = list.sessions.find((s) => s.sessionId === sessionId);
    if (!meta) {
      await agent.shutdown();
      throw new Error(`Session not found: ${sessionId}`);
    }

    return { agent, workDir: meta.cwd, pid: agent.proc.pid ?? -1 };
  }

  async createWorkspaceSession(workDir: string): Promise<WorkspaceSessionHandle> {
    const workspaceSessionId = this.store.createWorkspaceSessionId();
    this.store.create(workspaceSessionId, workDir);

    this.sessions.set(workspaceSessionId, {
      workDir,
      primarySessionId: null,
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
    if (!isSessionId(sessionId)) {
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

  async activateWorkspaceSession(workspaceSessionId: string): Promise<WorkspaceSessionHandle> {
    // If already active, return existing handle
    const existing = this.sessions.get(workspaceSessionId);
    if (existing && existing.primarySessionId) {
      const primaryAgent = existing.agentsBySessionId.get(existing.primarySessionId);
      return {
        workspaceSessionId,
        sessionId: existing.primarySessionId,
        workDir: existing.workDir,
        pid: primaryAgent?.proc.pid ?? -1,
      };
    }

    // Look up in persistent store
    const record = this.store.get(workspaceSessionId);
    if (!record) {
      throw new Error(`Unknown workspaceSessionId: ${workspaceSessionId}`);
    }

    if (record.agents.length === 0) {
      throw new Error(`Workspace session has no agents: ${workspaceSessionId}`);
    }

    // Get primary agent (first agent in list)
    const primaryAgentMeta = record.agents[0]!;
    const primarySessionId = primaryAgentMeta.sessionId as SessionId;

    // Spawn agent process and load the session
    const loaded = await this.spawnLoadedAgentSession(workspaceSessionId, primarySessionId);

    // Add to in-memory sessions map
    this.sessions.set(workspaceSessionId, {
      workDir: loaded.workDir,
      primarySessionId,
      agentsBySessionId: new Map([[primarySessionId, loaded.agent]]),
    });

    return {
      workspaceSessionId,
      sessionId: primarySessionId,
      workDir: loaded.workDir,
      pid: loaded.pid,
    };
  }

  async createAgentSession(
    workspaceSessionId: string,
    options?: CreateAgentSessionOptions
  ): Promise<AgentSessionHandle> {
    await this.ensureActive(workspaceSessionId);
    const ws = this.requireWorkspace(workspaceSessionId);

    const created = await this.spawnNewAgentSession(workspaceSessionId, ws.workDir, options);
    ws.agentsBySessionId.set(created.sessionId, created.agent);

    if (!ws.primarySessionId) ws.primarySessionId = created.sessionId;
    this.store.upsertAgent(workspaceSessionId, { sessionId: created.sessionId });

    return { sessionId: created.sessionId, pid: created.pid };
  }

  async getPeer(workspaceSessionId: string, sessionId?: string): Promise<JsonRpcPeer> {
    await this.ensureActive(workspaceSessionId);
    return this.requireAgent(workspaceSessionId, sessionId).agent.peer;
  }

  async prompt(
    workspaceSessionId: string,
    content: SessionPromptParams['content']
  ): Promise<SessionPromptResult> {
    this.store.touch(workspaceSessionId);
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'session/prompt',
      SessionPromptRequestSchema.shape.params,
      SessionPromptResponseSchema.shape.result,
      { content }
    );
  }

  async promptSession(
    workspaceSessionId: string,
    sessionId: string,
    content: SessionPromptParams['content']
  ): Promise<SessionPromptResult> {
    this.store.touch(workspaceSessionId);
    return await requestEnt(
      await this.getPeer(workspaceSessionId, sessionId),
      'session/prompt',
      SessionPromptRequestSchema.shape.params,
      SessionPromptResponseSchema.shape.result,
      { content }
    );
  }

  listWorkspaceSessions(): WorkspaceSessionRecord[] {
    return this.store.list();
  }

  getWorkspaceSession(workspaceSessionId: string): WorkspaceSessionRecord | undefined {
    return this.store.get(workspaceSessionId);
  }

  updateWorkspaceSession(
    workspaceSessionId: string,
    updates: Partial<Pick<WorkspaceSessionRecord, 'projectId' | 'name'>>
  ): void {
    this.store.update(workspaceSessionId, updates);
  }

  async deleteWorkspaceSession(workspaceSessionId: string): Promise<boolean> {
    const inMemory = this.sessions.get(workspaceSessionId);
    if (inMemory) {
      const agents = Array.from(inMemory.agentsBySessionId.values());
      await Promise.allSettled(agents.map((a) => a.shutdown()));
      this.sessions.delete(workspaceSessionId);
    }

    const existedInStore = this.store.delete(workspaceSessionId);
    return Boolean(inMemory) || existedInStore;
  }

  upsertAgentSessionMeta(
    workspaceSessionId: string,
    params: {
      sessionId: string;
      name?: string;
      connectionId?: string;
      modelId?: string;
      toolPolicies?: Record<string, ToolPolicy>;
    }
  ): void {
    this.store.upsertAgent(workspaceSessionId, params);
  }

  async listProviders(workspaceSessionId: string): Promise<{
    providers: Array<{
      providerId: string;
      displayName: string;
      supportsConnections: boolean;
      supportsCatalogRefresh?: boolean;
    }>;
  }> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/providers/list',
      EntProvidersListRequestSchema.shape.params,
      EntProvidersListResponseSchema.shape.result,
      {}
    );
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
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/connections/list',
      EntConnectionsListRequestSchema.shape.params,
      EntConnectionsListResponseSchema.shape.result,
      params ?? {}
    );
  }

  async upsertConnection(
    workspaceSessionId: string,
    params: {
      providerId?: string;
      connection: { connectionId?: string; name: string; config: Record<string, unknown> };
    }
  ): Promise<{ connectionId: string; providerId: string; created: boolean }> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/connections/upsert',
      EntConnectionsUpsertRequestSchema.shape.params,
      EntConnectionsUpsertResponseSchema.shape.result,
      params
    );
  }

  async deleteConnection(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ ok: true }> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/connections/delete',
      EntConnectionsDeleteRequestSchema.shape.params,
      EntConnectionsDeleteResponseSchema.shape.result,
      params
    );
  }

  async connectionCredentialStatus(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ connectionId: string; state: string; accountLabel?: string; expiresAt?: string }> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/connections/credentials/status',
      EntConnectionsCredentialsStatusRequestSchema.shape.params,
      EntConnectionsCredentialsStatusResponseSchema.shape.result,
      params
    );
  }

  async connectionCredentialStart(
    workspaceSessionId: string,
    params: { connectionId: string; method?: 'api_key' | 'device_code' | 'browser' | 'token' }
  ): Promise<unknown> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/connections/credentials/start',
      EntConnectionsCredentialsStartRequestSchema.shape.params,
      EntConnectionsCredentialsStartResponseSchema.shape.result,
      params
    );
  }

  async connectionCredentialSubmit(
    workspaceSessionId: string,
    params: { connectionId: string; values: Record<string, string> }
  ): Promise<{ ok: boolean; error?: string }> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/connections/credentials/submit',
      EntConnectionsCredentialsSubmitRequestSchema.shape.params,
      EntConnectionsCredentialsSubmitResponseSchema.shape.result,
      params
    );
  }

  async connectionCredentialClear(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ ok: true }> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/connections/credentials/clear',
      EntConnectionsCredentialsClearRequestSchema.shape.params,
      EntConnectionsCredentialsClearResponseSchema.shape.result,
      params
    );
  }

  async listModels(
    workspaceSessionId: string,
    params: { connectionId: string }
  ): Promise<{ providerId: string; connectionId: string; models: Array<{ modelId: string }> }> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/models/list',
      EntModelsListRequestSchema.shape.params,
      EntModelsListResponseSchema.shape.result,
      params
    );
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
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/job/list',
      EntJobListRequestSchema.shape.params,
      EntJobListResponseSchema.shape.result,
      {}
    );
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
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/job/output',
      EntJobOutputRequestSchema.shape.params,
      EntJobOutputResponseSchema.shape.result,
      params
    );
  }

  async killJob(
    workspaceSessionId: string,
    params: { jobId: string }
  ): Promise<{ success: boolean }> {
    return await requestEnt(
      await this.getPeer(workspaceSessionId),
      'ent/job/kill',
      EntJobKillRequestSchema.shape.params,
      EntJobKillResponseSchema.shape.result,
      params
    );
  }

  async cancel(workspaceSessionId: string): Promise<void> {
    await this.ensureActive(workspaceSessionId);
    const { agent, sessionId } = this.requireAgent(workspaceSessionId);
    agent.peer.notify('session/cancel', { sessionId });
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

async function requestEnt<ParamsSchema extends z.ZodTypeAny, ResultSchema extends z.ZodTypeAny>(
  peer: JsonRpcPeer,
  method: string,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  params: z.input<ParamsSchema>
): Promise<z.output<ResultSchema>> {
  const parsedParams = paramsSchema.parse(params);
  const result = await peer.request(method, parsedParams);
  return resultSchema.parse(result);
}
