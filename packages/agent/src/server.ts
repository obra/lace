import { randomUUID } from 'node:crypto';
import type { JsonRpcPeer } from '@lace/ent-protocol';
import {
  ensureSessionFiles,
  getSessionDir,
  listSessions,
  loadSession,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
  type LoadedSession,
  type SessionState,
} from './storage/session-store';
import { appendDurableEvent, readDurableEvents } from './storage/event-log';
import type { PermissionRequest, SessionUpdate, ToolResult } from './protocol/types';
import { shellExecTool, runShellExec } from './tools/shell-exec';
import { ProviderCatalogManager } from '@lace/core/providers/catalog/manager';
import { ProviderInstanceManager } from '@lace/core/providers/instance/manager';
import type { CatalogModel } from '@lace/core/providers/catalog/types';

const SUPPORTED_PROVIDER_TYPES = new Set(['anthropic', 'openai', 'gemini', 'lmstudio', 'ollama']);

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return truncated > 0 ? truncated : null;
}

function getEndpointFromConfig(config: Record<string, unknown>): string | undefined {
  const endpoint =
    toNonEmptyString(config.endpoint) ??
    toNonEmptyString(config.baseUrl) ??
    toNonEmptyString(config.baseURL);

  if (!endpoint) return undefined;

  try {
    // Require absolute URL, consistent with core ProviderInstanceSchema
    new URL(endpoint);
  } catch {
    throw new Error('endpoint must be a valid absolute URL');
  }

  return endpoint;
}

function assertConfigHasNoCredentials(config: Record<string, unknown>): void {
  const forbiddenKeys = ['apiKey', 'api_key', 'token', 'accessToken', 'authorization'];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      throw new Error(`Connection config MUST NOT include credentials (${key})`);
    }
  }
}

function mapCatalogModelToModelInfo(model: CatalogModel, providerId: string) {
  return {
    modelId: model.id,
    name: model.name,
    providerId,
    contextWindow: model.context_window,
    maxOutput: model.default_max_tokens,
    supportsThinking: !!model.can_reason || !!model.has_reasoning_effort,
    supportsImages: !!model.supports_attachments,
  };
}

export type AgentServerState = {
  initialized: boolean;
  activeSession: LoadedSession | null;
  config: {
    executionMode: 'plan' | 'execute';
    approvalMode:
      | 'ask'
      | 'approveReads'
      | 'approveEdits'
      | 'approve'
      | 'deny'
      | 'dangerouslySkipPermissions';
    connectionId?: string;
    modelId?: string;
    maxBudgetUsd?: number;
    maxThinkingTokens?: number;
  };
  activeTurn: null | {
    turnId: string;
    startedAt: string;
    status: 'running' | 'awaiting_permission';
    abortController: AbortController;
  };
  providerCatalog: ProviderCatalogManager;
  providerCatalogLoaded: boolean;
  providerInstances: ProviderInstanceManager;
};

export function createAgentServerState(): AgentServerState {
  return {
    initialized: false,
    activeSession: null,
    config: { executionMode: 'execute', approvalMode: 'ask' },
    activeTurn: null,
    providerCatalog: new ProviderCatalogManager(),
    providerCatalogLoaded: false,
    providerInstances: new ProviderInstanceManager(),
  };
}

export function registerAgentRpcMethods(peer: JsonRpcPeer, state: AgentServerState): void {
  peer.onRequest('initialize', async (params: unknown) => {
    const parsed = params as
      | {
          protocolVersion?: string;
          config?: {
            approvalMode?: string;
            executionMode?: string;
            providerId?: string;
            connectionId?: string;
            modelId?: string;
            maxBudgetUsd?: number;
            maxThinkingTokens?: number;
          };
        }
      | undefined;

    state.initialized = true;
    if (parsed?.config?.executionMode === 'plan') state.config.executionMode = 'plan';
    if (parsed?.config?.executionMode === 'execute') state.config.executionMode = 'execute';

    const approvalMode = parsed?.config?.approvalMode;
    if (
      approvalMode === 'ask' ||
      approvalMode === 'approveReads' ||
      approvalMode === 'approveEdits' ||
      approvalMode === 'approve' ||
      approvalMode === 'deny' ||
      approvalMode === 'dangerouslySkipPermissions'
    ) {
      state.config.approvalMode = approvalMode;
    }

    if (typeof parsed?.config?.connectionId === 'string')
      state.config.connectionId = parsed.config.connectionId;
    if (typeof parsed?.config?.modelId === 'string') state.config.modelId = parsed.config.modelId;
    if (typeof parsed?.config?.maxBudgetUsd === 'number')
      state.config.maxBudgetUsd = parsed.config.maxBudgetUsd;
    if (typeof parsed?.config?.maxThinkingTokens === 'number')
      state.config.maxThinkingTokens = parsed.config.maxThinkingTokens;

    return {
      protocolVersion: '1.0',
      agentInfo: { name: 'lace-agent', version: '0.1.0' },
      capabilities: {
        streaming: true,
        multiTurn: true,
        tools: [shellExecTool],
        'ent/contextInjection': true,
        'ent/backgroundJobs': false,
        'ent/fileCheckpointing': false,
        'ent/structuredOutput': false,
        'ent/providers': { list: true, connections: true, models: true },
      },
    };
  });

  peer.onRequest('ent/agent/ping', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    return { ok: true, timestamp: new Date().toISOString() };
  });

  peer.onRequest('ent/agent/status', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const effectiveConfig = state.activeSession?.state.config
      ? { ...state.config, ...state.activeSession.state.config }
      : state.config;

    const pendingPermissions: PermissionRequest[] = [];
    if (state.activeSession) {
      for (const pending of state.activeSession.state.pendingPermissions || []) {
        if (!pending.requestId) continue;
        pendingPermissions.push({
          requestId: pending.requestId,
          toolCallId: pending.toolCallId,
          sessionId: state.activeSession.meta.sessionId,
          turnId: pending.turnId,
          turnSeq: pending.turnSeq,
          jobId: pending.jobId,
          tool: pending.tool,
          kind: pending.kind,
          resource: pending.resource,
          options: pending.options,
          requestedAt: pending.requestedAt,
        });
      }
    }

    return {
      models: [],
      mcpServers: [],
      currentSession: state.activeSession
        ? {
            sessionId: state.activeSession.meta.sessionId,
            messageCount: 0,
            tokensUsed: 0,
            costUsd: 0,
            connectionId: effectiveConfig.connectionId,
            modelId: effectiveConfig.modelId,
          }
        : undefined,
      currentTurn: state.activeTurn
        ? {
            turnId: state.activeTurn.turnId,
            status: state.activeTurn.status,
            startedAt: state.activeTurn.startedAt,
          }
        : undefined,
      pendingPermissions,
      limits: {
        maxBudgetUsd: effectiveConfig.maxBudgetUsd,
        budgetUsedUsd: 0,
      },
    };
  });

  const ensureProviderCatalogLoaded = async () => {
    if (!state.providerCatalogLoaded) {
      await state.providerCatalog.loadCatalogs();
      state.providerCatalogLoaded = true;
    }
  };

  peer.onRequest('ent/providers/list', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    await ensureProviderCatalogLoaded();

    const providers = state.providerCatalog
      .getAvailableProviders()
      .filter((p) => SUPPORTED_PROVIDER_TYPES.has(p.type.toLowerCase()))
      .map((p) => ({
        providerId: p.id,
        displayName: p.name,
        supportsConnections: true,
        supportsCatalogRefresh: false,
      }));

    return { providers };
  });

  peer.onRequest('ent/connections/list', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { providerId?: string } | undefined;
    const providerIdFilter = typeof parsed?.providerId === 'string' ? parsed.providerId : undefined;

    const instances = await state.providerInstances.loadInstances();
    const connections = Object.entries(instances.instances)
      .filter(([_id, inst]) =>
        providerIdFilter ? inst.catalogProviderId === providerIdFilter : true
      )
      .map(([connectionId, inst]) => {
        const credential = state.providerInstances.loadCredential(connectionId);
        const credentialState = credential?.apiKey ? 'ready' : 'missing';
        return {
          connectionId,
          providerId: inst.catalogProviderId,
          name: inst.displayName,
          credentialState,
        };
      });

    return { connections };
  });

  peer.onRequest('ent/connections/upsert', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as {
      providerId?: string;
      connection: { connectionId?: string; name: string; config: Record<string, unknown> };
    };

    const name = toNonEmptyString(parsed?.connection?.name);
    if (!name) throw new Error('connection.name is required');

    const config = parsed?.connection?.config;
    if (!config || typeof config !== 'object') throw new Error('connection.config is required');
    assertConfigHasNoCredentials(config);

    const requestedConnectionId = toNonEmptyString(parsed?.connection?.connectionId);
    const instances = await state.providerInstances.loadInstances();

    const isUpdate = !!requestedConnectionId && !!instances.instances[requestedConnectionId];
    const created = !isUpdate;

    const connectionId = requestedConnectionId ?? `conn_${randomUUID()}`;
    const existing = instances.instances[connectionId];

    if (existing) {
      if (
        typeof parsed.providerId === 'string' &&
        parsed.providerId.length > 0 &&
        parsed.providerId !== existing.catalogProviderId
      ) {
        throw new Error('connectionId is already paired to a different providerId');
      }

      const endpoint = getEndpointFromConfig(config);
      const timeoutInput = (config as any).timeout;
      const timeout = timeoutInput === undefined ? undefined : toPositiveInt(timeoutInput);
      if (timeoutInput !== undefined && timeout === null)
        throw new Error('timeout must be a positive integer');
      const retryPolicy = typeof config.retryPolicy === 'string' ? config.retryPolicy : undefined;
      const modelConfigInput = (config as any).modelConfig;
      const modelConfig =
        modelConfigInput === undefined
          ? undefined
          : typeof modelConfigInput === 'object' && modelConfigInput
            ? modelConfigInput
            : null;
      if (modelConfigInput !== undefined && modelConfig === null)
        throw new Error('modelConfig must be an object');

      await state.providerInstances.updateInstance(connectionId, {
        displayName: name,
        ...(endpoint ? { endpoint } : {}),
        ...(timeout ? { timeout } : {}),
        ...(retryPolicy ? { retryPolicy } : {}),
        ...(modelConfig ? { modelConfig: modelConfig as any } : {}),
      });

      return { connectionId, providerId: existing.catalogProviderId, created: false };
    }

    const providerId = toNonEmptyString(parsed?.providerId);
    if (!providerId) throw new Error('providerId is required when creating a new connection');

    await ensureProviderCatalogLoaded();
    const catalogProvider = state.providerCatalog.getProvider(providerId);
    if (!catalogProvider) throw new Error(`Unknown providerId: ${providerId}`);
    if (!SUPPORTED_PROVIDER_TYPES.has(catalogProvider.type.toLowerCase())) {
      throw new Error(`Provider is not supported by this agent: ${providerId}`);
    }

    const endpoint = getEndpointFromConfig(config);
    const timeoutInput = (config as any).timeout;
    const timeout = timeoutInput === undefined ? undefined : toPositiveInt(timeoutInput);
    if (timeoutInput !== undefined && timeout === null)
      throw new Error('timeout must be a positive integer');
    const retryPolicy = typeof config.retryPolicy === 'string' ? config.retryPolicy : undefined;
    const modelConfigInput = (config as any).modelConfig;
    const modelConfig =
      modelConfigInput === undefined
        ? undefined
        : typeof modelConfigInput === 'object' && modelConfigInput
          ? modelConfigInput
          : null;
    if (modelConfigInput !== undefined && modelConfig === null)
      throw new Error('modelConfig must be an object');

    await state.providerInstances.saveInstances({
      ...instances,
      instances: {
        ...instances.instances,
        [connectionId]: {
          displayName: name,
          catalogProviderId: providerId,
          ...(endpoint ? { endpoint } : {}),
          ...(timeout ? { timeout } : {}),
          ...(retryPolicy ? { retryPolicy } : {}),
          ...(modelConfig ? { modelConfig: modelConfig as any } : {}),
        },
      },
    });

    return { connectionId, providerId, created };
  });

  peer.onRequest('ent/connections/delete', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    await state.providerInstances.deleteInstance(connectionId);
    return { ok: true };
  });

  peer.onRequest('ent/connections/test', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string; modelId?: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) return { ok: false, error: 'Connection not found' };

    const credential = state.providerInstances.loadCredential(connectionId);
    if (!credential?.apiKey) return { ok: false, error: 'Missing credentials' };

    await ensureProviderCatalogLoaded();
    const provider = state.providerCatalog.getProvider(instance.catalogProviderId);
    if (!provider) return { ok: false, error: 'Provider not found' };

    const requestedModelId = toNonEmptyString(parsed?.modelId);
    if (requestedModelId) {
      const hasModel = provider.models.some((m) => m.id === requestedModelId);
      if (!hasModel) return { ok: false, error: 'Model not found for provider' };
    }

    return { ok: true };
  });

  peer.onRequest('ent/connections/credentials/status', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId]) throw { code: 1, message: 'ConnectionNotFound' };

    const credential = state.providerInstances.loadCredential(connectionId);
    return {
      connectionId,
      state: credential?.apiKey ? 'ready' : 'missing',
    };
  });

  peer.onRequest('ent/connections/credentials/start', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string; method?: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId]) throw { code: 1, message: 'ConnectionNotFound' };

    const credential = state.providerInstances.loadCredential(connectionId);
    const requestedMethod = toNonEmptyString(parsed?.method);

    if (!requestedMethod && credential?.apiKey) {
      return { kind: 'ready' };
    }

    return {
      kind: 'needs_input',
      fields: [{ name: 'apiKey', label: 'API Key', secret: true }],
    };
  });

  peer.onRequest('ent/connections/credentials/submit', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string; values: Record<string, string> };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId]) throw { code: 1, message: 'ConnectionNotFound' };

    const values = parsed?.values;
    if (!values || typeof values !== 'object') return { ok: false, error: 'values is required' };

    const apiKey =
      toNonEmptyString((values as any).apiKey) ??
      toNonEmptyString((values as any).api_key) ??
      toNonEmptyString((values as any).key);

    if (!apiKey) return { ok: false, error: 'apiKey is required' };

    await state.providerInstances.saveCredential(connectionId, { apiKey });
    return { ok: true };
  });

  peer.onRequest('ent/connections/credentials/clear', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId]) throw { code: 1, message: 'ConnectionNotFound' };

    await state.providerInstances.clearCredential(connectionId);
    return { ok: true };
  });

  peer.onRequest('ent/models/list', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throw new Error('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) throw { code: 1, message: 'ConnectionNotFound' };

    await ensureProviderCatalogLoaded();
    const providerId = instance.catalogProviderId;
    const provider = state.providerCatalog.getProvider(providerId);
    if (!provider) throw new Error(`Unknown providerId: ${providerId}`);

    const models = provider.models.map((m) => mapCatalogModelToModelInfo(m, providerId));
    return { providerId, connectionId, models };
  });

  peer.onRequest('session/new', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (state.activeSession) throw { code: 2, message: 'SessionBusy' };

    const parsed = params as { workDir: string; persona?: string; systemPrompt?: unknown };
    if (!parsed?.workDir) throw new Error('workDir is required');

    const sessionId = `sess_${randomUUID()}`;
    const created = new Date().toISOString();

    const sessionDir = getSessionDir(sessionId);
    writeSessionMeta(sessionDir, { sessionId, workDir: parsed.workDir, created });
    writeSessionState(sessionDir, {
      nextEventSeq: 1,
      nextStreamSeq: 1,
      config: {
        executionMode: state.config.executionMode,
        approvalMode: state.config.approvalMode,
        connectionId: state.config.connectionId,
        modelId: state.config.modelId,
        maxBudgetUsd: state.config.maxBudgetUsd,
        maxThinkingTokens: state.config.maxThinkingTokens,
      },
    });
    ensureSessionFiles(sessionDir);

    state.activeSession = loadSession(sessionId);

    return { sessionId, created };
  });

  peer.onRequest('session/list', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { workDir?: string } | undefined;
    const workDirFilter = parsed?.workDir;

    return { sessions: listSessions(workDirFilter) };
  });

  peer.onRequest('session/load', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { sessionId: string; fork?: boolean };
    if (!parsed?.sessionId) throw new Error('sessionId is required');
    if (parsed.fork) throw new Error('fork not implemented');

    if (state.activeSession && state.activeSession.meta.sessionId !== parsed.sessionId) {
      throw { code: 2, message: 'SessionBusy' };
    }

    const loaded = loadSession(parsed.sessionId);
    state.activeSession = loaded;
    return {
      sessionId: parsed.sessionId,
      messageCount: 0,
      lastActive: loaded.meta.created,
    };
  });

  peer.onRequest('ent/session/configure', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const parsed = params as Partial<{
      connectionId: string;
      modelId: string;
      maxThinkingTokens: number;
      maxBudgetUsd: number;
      approvalMode:
        | 'ask'
        | 'approveReads'
        | 'approveEdits'
        | 'approve'
        | 'deny'
        | 'dangerouslySkipPermissions';
    }>;

    const currentState = readSessionState(state.activeSession.dir);
    const currentConfig = currentState.config || {};
    const effectiveBefore = { ...state.config, ...currentConfig };
    const nextConfig = { ...currentConfig };
    const applied: string[] = [];

    if (
      typeof parsed.connectionId === 'string' &&
      parsed.connectionId !== effectiveBefore.connectionId
    ) {
      nextConfig.connectionId = parsed.connectionId;
      applied.push('connectionId');
    }

    if (typeof parsed.modelId === 'string' && parsed.modelId !== effectiveBefore.modelId) {
      nextConfig.modelId = parsed.modelId;
      applied.push('modelId');
    }

    if (
      typeof parsed.maxThinkingTokens === 'number' &&
      parsed.maxThinkingTokens !== effectiveBefore.maxThinkingTokens
    ) {
      nextConfig.maxThinkingTokens = parsed.maxThinkingTokens;
      applied.push('maxThinkingTokens');
    }

    if (
      typeof parsed.maxBudgetUsd === 'number' &&
      parsed.maxBudgetUsd !== effectiveBefore.maxBudgetUsd
    ) {
      nextConfig.maxBudgetUsd = parsed.maxBudgetUsd;
      applied.push('maxBudgetUsd');
    }

    if (
      parsed.approvalMode &&
      parsed.approvalMode !== effectiveBefore.approvalMode &&
      (parsed.approvalMode === 'ask' ||
        parsed.approvalMode === 'approveReads' ||
        parsed.approvalMode === 'approveEdits' ||
        parsed.approvalMode === 'approve' ||
        parsed.approvalMode === 'deny' ||
        parsed.approvalMode === 'dangerouslySkipPermissions')
    ) {
      nextConfig.approvalMode = parsed.approvalMode;
      applied.push('approvalMode');
    }

    const nextState = { ...currentState, config: nextConfig };
    writeSessionState(state.activeSession.dir, nextState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);

    const effectiveAfter = { ...state.config, ...(state.activeSession.state.config || {}) };

    return {
      applied,
      config: {
        connectionId: effectiveAfter.connectionId,
        modelId: effectiveAfter.modelId,
        maxThinkingTokens: effectiveAfter.maxThinkingTokens,
        maxBudgetUsd: effectiveAfter.maxBudgetUsd,
        approvalMode: effectiveAfter.approvalMode,
      },
    };
  });

  peer.onRequest('ent/session/inject', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const parsed = params as { content: unknown[]; priority: 'immediate' | 'normal' | 'deferred' };
    const priority =
      parsed?.priority === 'immediate' ||
      parsed?.priority === 'normal' ||
      parsed?.priority === 'deferred'
        ? parsed.priority
        : 'normal';

    let sessionState: SessionState = readSessionState(state.activeSession.dir);
    const { nextState } = appendDurableEvent(state.activeSession.dir, sessionState, {
      type: 'context_injected',
      data: { content: Array.isArray(parsed?.content) ? parsed.content : [], priority },
    });
    sessionState = nextState;
    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = { ...state.activeSession, state: sessionState };

    peer.notify('session/update', {
      sessionId: state.activeSession.meta.sessionId,
      streamSeq: sessionState.nextStreamSeq,
      turnId: state.activeTurn?.turnId,
      turnSeq: state.activeTurn ? 0 : undefined,
      type: 'context_injected',
      priority,
      messageCount: 0,
    });

    writeSessionState(state.activeSession.dir, {
      ...sessionState,
      nextStreamSeq: sessionState.nextStreamSeq + 1,
    });

    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    return undefined;
  });

  peer.onRequest('ent/session/events', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };

    const parsed = params as
      | { afterEventSeq?: number; limit?: number; types?: string[] }
      | undefined;
    const result = readDurableEvents(state.activeSession.dir, {
      afterEventSeq: parsed?.afterEventSeq,
      limit: parsed?.limit,
      types: parsed?.types,
    });

    return result;
  });

  peer.onRequest('session/cancel', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) return undefined;

    if (state.activeTurn) {
      state.activeTurn.abortController.abort();
      return undefined;
    }

    const sessionState = readSessionState(state.activeSession.dir);
    sessionState.pendingPermissions = [];
    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    return undefined;
  });

  peer.onRequest('session/prompt', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw { code: 1, message: 'SessionNotFound' };
    if (state.activeTurn) throw { code: 2, message: 'SessionBusy' };

    const effectiveConfig = state.activeSession.state.config
      ? { ...state.config, ...state.activeSession.state.config }
      : state.config;

    const parsed = params as { content: unknown[] };
    const turnId = `turn_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    state.activeTurn = { turnId, startedAt, status: 'running', abortController };

    let sessionState: SessionState = readSessionState(state.activeSession.dir);
    let durableTurnSeq = 0;
    const writeAndAdvance = (event: { type: string; data: Record<string, unknown> }) => {
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: event.type,
        data: event.data,
        turnId,
        turnSeq: durableTurnSeq++,
      });
      sessionState = nextState;
    };

    writeAndAdvance({ type: 'prompt', data: { content: parsed.content } });
    writeAndAdvance({ type: 'turn_start', data: {} });

    const emitUpdate = (turnSeq: number, update: SessionUpdate) => {
      peer.notify('session/update', {
        sessionId: state.activeSession!.meta.sessionId,
        streamSeq: sessionState.nextStreamSeq,
        turnId,
        turnSeq,
        ...update,
      });
      sessionState = { ...sessionState, nextStreamSeq: sessionState.nextStreamSeq + 1 };
    };

    emitUpdate(0, { type: 'text_delta', text: 'hello' });

    if (abortController.signal.aborted) {
      writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

      writeSessionState(state.activeSession.dir, sessionState);
      state.activeSession = loadSession(state.activeSession.meta.sessionId);
      state.activeTurn = null;

      return {
        turnId,
        stopReason: 'cancelled',
        content: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const promptText = (parsed.content as any[])
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');

    const runMatch = promptText.match(/^\s*run:\s*(.+)\s*$/m);
    const command = runMatch?.[1]?.trim();

    if (command && effectiveConfig.executionMode === 'execute') {
      const toolCallId = `tool_${randomUUID()}`;
      const toolInput = { command } as Record<string, unknown>;
      let shouldExecuteTool = true;

      emitUpdate(1, {
        type: 'tool_use',
        toolCallId,
        name: shellExecTool.name,
        kind: shellExecTool.kind,
        input: toolInput,
        status: 'pending',
      });

      const requiresPermission =
        shellExecTool.requiresPermission &&
        effectiveConfig.approvalMode !== 'approve' &&
        effectiveConfig.approvalMode !== 'dangerouslySkipPermissions' &&
        effectiveConfig.approvalMode !== 'deny';

      if (effectiveConfig.approvalMode === 'deny') {
        const denied: ToolResult = {
          outcome: 'denied',
          content: [{ type: 'error', message: 'Denied by policy' }],
        };

        shouldExecuteTool = false;
        emitUpdate(1, {
          type: 'tool_use',
          toolCallId,
          name: shellExecTool.name,
          kind: shellExecTool.kind,
          input: toolInput,
          status: 'denied',
          result: denied,
        });

        writeAndAdvance({
          type: 'tool_use',
          data: {
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: toolInput,
            result: denied,
          },
        });
      } else {
        let finalInput = toolInput;

        if (requiresPermission) {
          state.activeTurn = { turnId, startedAt, status: 'awaiting_permission', abortController };

          const options = [
            { optionId: 'allow', label: 'Allow' },
            { optionId: 'deny', label: 'Deny' },
          ];

          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: toolInput,
            status: 'awaiting_permission',
          });

          type PendingPermission = NonNullable<SessionState['pendingPermissions']>[number];
          const pending: PendingPermission = {
            toolCallId,
            turnId,
            turnSeq: 1,
            tool: shellExecTool.name,
            kind: shellExecTool.kind,
            resource: command,
            options,
            requestedAt: new Date().toISOString(),
            input: toolInput,
          };

          sessionState.pendingPermissions = [...(sessionState.pendingPermissions || []), pending];
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };

          const { requestId, result } = peer.requestWithId('session/request_permission', {
            sessionId: state.activeSession.meta.sessionId,
            turnId,
            turnSeq: 1,
            toolCallId,
            tool: shellExecTool.name,
            kind: shellExecTool.kind,
            resource: command,
            options,
          });

          pending.requestId = String(requestId);
          sessionState.pendingPermissions = (sessionState.pendingPermissions || []).map((p) =>
            p.toolCallId === toolCallId ? pending : p
          );
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };

          const abortPromise = new Promise<never>((_, reject) => {
            abortController.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            });
          });

          let permissionResponse: any;
          try {
            permissionResponse = await Promise.race([result, abortPromise]);
          } catch {
            peer.abandonRequest(requestId);

            sessionState.pendingPermissions = (sessionState.pendingPermissions || []).filter(
              (p) => p.toolCallId !== toolCallId
            );
            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = { ...state.activeSession, state: sessionState };

            const cancelled: ToolResult = {
              outcome: 'cancelled',
              content: [{ type: 'error', message: 'Cancelled' }],
            };

            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: toolInput,
              status: 'cancelled',
              result: cancelled,
            });

            writeAndAdvance({
              type: 'tool_use',
              data: {
                toolCallId,
                name: shellExecTool.name,
                kind: shellExecTool.kind,
                input: toolInput,
                result: cancelled,
              },
            });
            writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
            state.activeTurn = null;

            return {
              turnId,
              stopReason: 'cancelled',
              content: [],
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }

          sessionState.pendingPermissions = (sessionState.pendingPermissions || []).filter(
            (p) => p.toolCallId !== toolCallId
          );
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };
          state.activeTurn = { turnId, startedAt, status: 'running', abortController };

          const decision = permissionResponse?.decision;
          if (decision === 'deny') {
            const denied: ToolResult = {
              outcome: 'denied',
              content: [{ type: 'error', message: 'Denied' }],
            };

            shouldExecuteTool = false;
            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: toolInput,
              status: 'denied',
              result: denied,
            });

            writeAndAdvance({
              type: 'tool_use',
              data: {
                toolCallId,
                name: shellExecTool.name,
                kind: shellExecTool.kind,
                input: toolInput,
                result: denied,
              },
            });
          } else {
            if (
              permissionResponse?.updatedInput &&
              typeof permissionResponse.updatedInput === 'object'
            ) {
              finalInput = permissionResponse.updatedInput as Record<string, unknown>;
            }

            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: finalInput,
              status: 'running',
            });
          }
        } else {
          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: finalInput,
            status: 'running',
          });
        }

        if (shouldExecuteTool && !abortController.signal.aborted) {
          const commandToRun = String((finalInput as any).command || '');
          const result = await runShellExec(
            { command: commandToRun },
            { defaultCwd: state.activeSession.meta.workDir, signal: abortController.signal }
          );

          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: finalInput,
            status: result.outcome,
            result,
          });

          writeAndAdvance({
            type: 'tool_use',
            data: {
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: finalInput,
              result,
            },
          });

          if (result.outcome === 'cancelled') {
            writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
            state.activeTurn = null;

            return {
              turnId,
              stopReason: 'cancelled',
              content: [],
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
        }
      }
    }

    writeAndAdvance({
      type: 'message',
      data: { content: [{ type: 'text', text: 'hello' }] },
    });
    writeAndAdvance({ type: 'turn_end', data: { stopReason: 'end_turn' } });

    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    state.activeTurn = null;

    return {
      turnId,
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'hello' }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  });
}
