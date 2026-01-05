import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  existsSync,
  appendFileSync,
  readFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { join, resolve as resolvePath, isAbsolute as isAbsolutePath } from 'node:path';
import {
  createNdjsonStdioTransport,
  AcpErrorCodes,
  EntErrorCodes,
  McpServerConfigSchema,
  isSessionId,
  JsonRpcPeer,
  SessionUpdateNotificationSchema,
  type PermissionRequest,
  type ToolInfo,
  type ToolResult,
} from '@lace/ent-protocol';
import type { z } from 'zod';
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
import { appendDurableEvent, readDurableEvents, summarizeDurableEvents } from './storage/event-log';
import {
  writeCheckpoint,
  findCheckpointByEventSeq,
  restoreCheckpointFiles,
} from './storage/checkpoint-store';
import {
  deriveCheckpointFilesFromDurableEvents,
  deriveFilesReadFromDurableEvents,
} from './storage/files-from-events';
import {
  derivePendingPermissionsFromDurableEvents,
  type PendingPermissionRecord,
} from './storage/permissions-from-events';
import { ProviderCatalogManager } from './providers/catalog/manager';
import { ProviderInstanceManager } from './providers/instance/manager';
import {
  ProviderInstanceSchema,
  type CatalogModel,
  type ProviderInstance,
} from './providers/catalog/types';
import { ProviderRegistry } from './providers/registry';
import { AIProvider, type ProviderMessage } from './providers/base-provider';
import { ToolExecutor } from './tools/executor';
import { estimateTokens } from '@lace/agent/utils/token-estimation';
// CoreTool alias for backwards compatibility with provider interface
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type {
  ToolCall as CoreToolCall,
  ToolResult as CoreToolResult,
  ToolPolicy,
} from './tools/types';
import { TestAgentProvider } from './runtime/test-provider';
import { MCPServerManager } from './mcp/server-manager';
import type { MCPServerConfig } from '@lace/agent/config/mcp-types';
import { compactDroppedMessagesWithCore } from './compaction/compact-dropped-messages';
import { WorkspaceManagerFactory } from './workspace/workspace-manager';
import { personaRegistry } from './config/persona-registry';

const SUPPORTED_PROVIDER_TYPES = new Set(['anthropic', 'openai', 'gemini', 'lmstudio', 'ollama']);
const JOB_LOG_DIR = 'jobs';

type SessionUpdateParams = z.infer<typeof SessionUpdateNotificationSchema>['params'];
type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;
type SessionUpdate = DistributiveOmit<SessionUpdateParams, 'sessionId' | 'streamSeq'>;

function throwInvalidParams(reason?: string): never {
  throw {
    code: -32602,
    message: 'InvalidParams',
    data: { category: 'protocol', ...(reason ? { reason } : {}) },
  };
}

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
    throwInvalidParams('endpoint must be a valid absolute URL');
  }

  return endpoint;
}

function assertConfigHasNoCredentials(config: Record<string, unknown>): void {
  const forbiddenKeys = ['apiKey', 'api_key', 'token', 'accessToken', 'authorization'];
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      throwInvalidParams(`Connection config MUST NOT include credentials (${key})`);
    }
  }
}

function parseProviderInstanceOverridesFromConnectionConfig(options: {
  displayName: string;
  catalogProviderId: string;
  config: Record<string, unknown>;
}): Partial<Pick<ProviderInstance, 'endpoint' | 'timeout' | 'retryPolicy' | 'modelConfig'>> {
  const endpoint = getEndpointFromConfig(options.config);

  const timeoutInput = (options.config as any).timeout;
  const timeout = timeoutInput === undefined ? undefined : toPositiveInt(timeoutInput);
  if (timeoutInput !== undefined && timeout === null) {
    throwInvalidParams('timeout must be a positive integer');
  }

  const retryPolicy = toNonEmptyString((options.config as any).retryPolicy) ?? undefined;
  const modelConfigInput = (options.config as any).modelConfig;

  const parsed = ProviderInstanceSchema.safeParse({
    displayName: options.displayName,
    catalogProviderId: options.catalogProviderId,
    ...(endpoint ? { endpoint } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(retryPolicy ? { retryPolicy } : {}),
    ...(modelConfigInput !== undefined ? { modelConfig: modelConfigInput } : {}),
  });

  if (!parsed.success) {
    throwInvalidParams(parsed.error.issues[0]?.message ?? 'Invalid connection config');
  }

  return {
    ...(parsed.data.endpoint ? { endpoint: parsed.data.endpoint } : {}),
    ...(parsed.data.timeout !== undefined ? { timeout: parsed.data.timeout } : {}),
    ...(parsed.data.retryPolicy ? { retryPolicy: parsed.data.retryPolicy } : {}),
    ...(parsed.data.modelConfig ? { modelConfig: parsed.data.modelConfig } : {}),
  };
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

type JobType = 'shell' | 'subagent';
type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

type JobState = {
  jobId: string;
  parentJobId?: string;
  type: JobType;
  status: JobStatus;
  description?: string;
  command?: string;
  subagentContent?: unknown[];
  startedAt: string;
  originTurnId?: string;
  originTurnSeq?: number;
  exitCode?: number;
  outputPath: string;
  proc?: ChildProcess;
  permissionAbortController?: AbortController;
  childPeer?: JsonRpcPeer;
  childSessionId?: string;
  childTransportClose?: () => void;
  finished: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
};

function ensureJobLogDir(sessionDir: string): string {
  const dir = join(sessionDir, JOB_LOG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function getJobOutputPath(sessionDir: string, jobId: string): string {
  return join(ensureJobLogDir(sessionDir), `${jobId}.log`);
}

function extractTextFromContentBlocks(content: unknown[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b) =>
        b &&
        typeof b === 'object' &&
        (b as any).type === 'text' &&
        typeof (b as any).text === 'string'
    )
    .map((b) => String((b as any).text))
    .join('\n');
}

function toolKindFromName(name: string): ToolInfo['kind'] {
  if (name === 'file_read') return 'read';
  if (name === 'file_find') return 'search';
  if (name === 'ripgrep_search') return 'search';
  if (name === 'url_fetch') return 'fetch';
  if (name === 'bash') return 'execute';
  if (name === 'delegate') return 'execute';
  if (name === 'file_write') return 'edit';
  if (name === 'file_edit') return 'edit';
  return 'other';
}

function protocolToolInfoForCoreTool(tool: CoreTool): ToolInfo {
  const kind = toolKindFromName(tool.name);
  return {
    name: tool.name,
    description: tool.description,
    kind,
    inputSchema: tool.inputSchema as Record<string, unknown>,
    requiresPermission: kind !== 'read' && kind !== 'search',
  };
}

function protocolToolResultFromCore(result: CoreToolResult): ToolResult {
  const outcome: ToolResult['outcome'] =
    result.status === 'completed'
      ? 'completed'
      : result.status === 'denied'
        ? 'denied'
        : result.status === 'aborted'
          ? 'cancelled'
          : 'failed';

  const content: ToolResult['content'] = (result.content || []).map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text ?? '' };
    if (c.type === 'image')
      return { type: 'image', data: c.data ?? '', mediaType: 'application/octet-stream' };
    if (c.type === 'resource') return { type: 'text', text: c.uri ?? '' };
    return { type: 'text', text: '' };
  });

  return { outcome, content, ...(result.metadata ? { meta: result.metadata as any } : {}) };
}

function coreToolResultFromProtocol(result: ToolResult, toolCallId: string): CoreToolResult {
  const status: CoreToolResult['status'] =
    result.outcome === 'completed'
      ? 'completed'
      : result.outcome === 'denied'
        ? 'denied'
        : result.outcome === 'cancelled'
          ? 'aborted'
          : 'failed';

  const content: CoreToolResult['content'] = result.content.map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'json') return { type: 'text', text: JSON.stringify(c.data, null, 2) };
    if (c.type === 'image') return { type: 'image', data: c.data };
    if (c.type === 'error') return { type: 'text', text: c.message };
    return { type: 'text', text: '' };
  });

  return {
    id: toolCallId,
    content,
    status,
    ...(result.meta ? { metadata: result.meta } : {}),
  };
}

function shouldAskPermission(
  approvalMode: AgentServerState['config']['approvalMode'],
  toolKind: ReturnType<typeof toolKindFromName>
): boolean {
  if (approvalMode === 'dangerouslySkipPermissions' || approvalMode === 'approve') return false;
  if (approvalMode === 'deny') return false;

  if (approvalMode === 'approveReads') {
    return toolKind !== 'read' && toolKind !== 'search';
  }

  if (approvalMode === 'approveEdits') {
    return toolKind !== 'read' && toolKind !== 'search' && toolKind !== 'edit';
  }

  // ask
  return toolKind !== 'read' && toolKind !== 'search';
}

function isTestProviderEnabled(): boolean {
  return process.env.LACE_AGENT_TEST_PROVIDER === '1';
}

function assertInitialized(state: AgentServerState): void {
  if (!state.initialized)
    throw {
      code: EntErrorCodes.NotInitialized,
      message: 'NotInitialized',
      data: { category: 'agent_internal' },
    };
}

async function createProviderForTurn(options: {
  connectionId?: string;
  modelId?: string;
}): Promise<AIProvider> {
  if (isTestProviderEnabled()) {
    return new TestAgentProvider();
  }

  const connectionId = toNonEmptyString(options.connectionId);
  const modelId = toNonEmptyString(options.modelId);
  if (!connectionId || !modelId) {
    throw new Error('Missing provider configuration: connectionId and modelId are required');
  }

  const registry = ProviderRegistry.getInstance();
  return await registry.createProviderFromInstanceAndModel(connectionId, modelId);
}

function createToolExecutorForMode(
  executionMode: 'plan' | 'execute',
  mcpServerManager?: MCPServerManager
): {
  executor: ToolExecutor;
  toolsForProvider: CoreTool[];
} {
  const executor = new ToolExecutor();
  executor.registerAllAvailableTools();

  if (mcpServerManager) {
    executor.registerMCPTools(mcpServerManager);
  }

  const allTools = executor.getAllTools();
  const filteredTools =
    executionMode === 'plan'
      ? allTools.filter((t) => {
          const kind = toolKindFromName(t.name);
          return kind === 'read' || kind === 'search';
        })
      : allTools;

  // Cast to CoreTool[] for provider compatibility - providers still use core Tool type
  const toolsForProvider = filteredTools as unknown as CoreTool[];

  return { executor, toolsForProvider };
}

function arraysShallowEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function recordsShallowEqual(a?: Record<string, string>, b?: Record<string, string>): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function mcpServerConfigEquivalent(a: MCPServerConfig, b: MCPServerConfig): boolean {
  return (
    a.command === b.command &&
    arraysShallowEqual(a.args, b.args) &&
    recordsShallowEqual(a.env, b.env) &&
    a.enabled === b.enabled &&
    recordsShallowEqual(a.tools as Record<string, string>, b.tools as Record<string, string>)
  );
}

async function reconcileMcpServersForActiveSession(state: AgentServerState): Promise<void> {
  if (!state.activeSession) return;

  const configured = state.activeSession.state.config?.mcpServers;
  const parsed = Array.isArray(configured)
    ? McpServerConfigSchema.array().safeParse(configured)
    : { success: true as const, data: [] as Array<any> };

  if (!parsed.success) {
    console.warn('Invalid mcpServers config in session state; leaving servers unchanged', {
      error: parsed.error,
    });
    return;
  }

  const mcpServers = parsed.data;
  const desired = new Map<string, MCPServerConfig>();

  for (const server of mcpServers) {
    const enabled = typeof server.enabled === 'boolean' ? server.enabled : true;
    const tools: Record<string, ToolPolicy> =
      server.tools && typeof server.tools === 'object' ? server.tools : {};

    desired.set(server.name, {
      command: server.command,
      ...(Array.isArray(server.args) ? { args: server.args } : {}),
      ...(server.env && typeof server.env === 'object' ? { env: server.env } : {}),
      enabled,
      tools,
    });
  }

  for (const existing of state.mcpServerManager.getAllServers()) {
    if (!desired.has(existing.id)) {
      await state.mcpServerManager.stopServer(existing.id);
    }
  }

  for (const [serverId, config] of desired) {
    const existing = state.mcpServerManager.getServer(serverId);
    const needsRestart = existing ? !mcpServerConfigEquivalent(existing.config, config) : false;

    if (needsRestart) {
      await state.mcpServerManager.stopServer(serverId);
    }

    if (!config.enabled) {
      await state.mcpServerManager.stopServer(serverId);
      continue;
    }

    await state.mcpServerManager.startServer(serverId, {
      ...config,
      cwd: state.activeSession.meta.workDir,
    });
  }
}

function buildProviderMessagesFromDurableEvents(sessionDir: string): ProviderMessage[] {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return [];
  }

  const messages: ProviderMessage[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      const data = typeof parsed.data === 'object' && parsed.data ? parsed.data : {};

      if (type === 'prompt') {
        const content = extractTextFromContentBlocks((data as any).content);
        if (content.trim()) messages.push({ role: 'user', content });
        continue;
      }

      if (type === 'context_injected') {
        const content = extractTextFromContentBlocks((data as any).content);
        if (content.trim()) messages.push({ role: 'system', content });
        continue;
      }

      if (type === 'context_compacted') {
        const summary = typeof (data as any).summary === 'string' ? (data as any).summary : '';
        const preserved = Array.isArray((data as any).preserved) ? (data as any).preserved : [];

        messages.length = 0;
        if (summary.trim()) messages.push({ role: 'system', content: summary });

        for (const msg of preserved) {
          if (!msg || typeof msg !== 'object') continue;
          const role = (msg as any).role;
          const content = (msg as any).content;
          if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
          if (typeof content !== 'string') continue;

          const toolCalls = Array.isArray((msg as any).toolCalls)
            ? (msg as any).toolCalls
            : undefined;
          const toolResults = Array.isArray((msg as any).toolResults)
            ? (msg as any).toolResults
            : undefined;

          messages.push({
            role,
            content,
            ...(toolCalls ? { toolCalls } : {}),
            ...(toolResults ? { toolResults } : {}),
          });
        }

        continue;
      }

      if (type === 'message') {
        const content =
          typeof (data as any).content === 'string'
            ? (data as any).content
            : extractTextFromContentBlocks((data as any).content);
        messages.push({ role: 'assistant', content: content ?? '' });
        continue;
      }

      if (type === 'tool_use') {
        const toolCallId = toNonEmptyString((data as any).toolCallId);
        const name = toNonEmptyString((data as any).name);
        const input = (data as any).input;
        const result = (data as any).result as ToolResult | undefined;
        if (!toolCallId || !name) continue;

        const toolCall: CoreToolCall = {
          id: toolCallId,
          name,
          arguments: typeof input === 'object' && input ? (input as any) : {},
        };

        if (messages.length === 0 || messages[messages.length - 1]!.role !== 'assistant') {
          messages.push({ role: 'assistant', content: '', toolCalls: [toolCall] });
        } else {
          const last = messages[messages.length - 1]!;
          last.toolCalls = [...(last.toolCalls || []), toolCall];
        }

        if (result) {
          const coreResult = coreToolResultFromProtocol(result, toolCallId);
          const last = messages[messages.length - 1];
          const canAppendToUser =
            last && last.role === 'user' && last.toolResults && last.toolResults.length > 0;
          if (canAppendToUser) {
            last.toolResults!.push(coreResult);
          } else {
            messages.push({ role: 'user', content: '', toolResults: [coreResult] });
          }
        }

        continue;
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  return messages;
}

function estimateProviderTokens(messages: ProviderMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') total += estimateTokens(message.content);
    if ((message as any).toolCalls)
      total += estimateTokens(JSON.stringify((message as any).toolCalls));
    if ((message as any).toolResults)
      total += estimateTokens(JSON.stringify((message as any).toolResults));
  }
  return total;
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
  mcpServerManager: MCPServerManager;
  jobs: Map<string, JobState>;
  pendingPermissionRequests: Map<
    string,
    {
      requestId: string;
      rpcId: unknown;
      record: PendingPermissionRecord;
      result: Promise<unknown>;
    }
  >;
  sessionMutex: Promise<void>;
  jobStreaming: 'full' | 'coalesced' | 'none';
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
    mcpServerManager: new MCPServerManager(),
    jobs: new Map(),
    pendingPermissionRequests: new Map(),
    sessionMutex: Promise.resolve(),
    jobStreaming: 'full',
  };
}

export function registerAgentRpcMethods(peer: JsonRpcPeer, state: AgentServerState): void {
  const runExclusive = async <T>(work: () => Promise<T> | T): Promise<T> => {
    const previous = state.sessionMutex;
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    state.sessionMutex = previous.then(() => next);
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };

  const emitSessionUpdate = async (
    update: SessionUpdate,
    context?: { turnId?: string; turnSeq?: number; jobId?: string }
  ) => {
    if (!state.activeSession) return;

    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      peer.notify('session/update', {
        sessionId: state.activeSession!.meta.sessionId,
        streamSeq: sessionState.nextStreamSeq,
        turnId: context?.turnId,
        turnSeq: context?.turnSeq,
        jobId: context?.jobId,
        ...update,
      });
      writeSessionState(state.activeSession!.dir, {
        ...sessionState,
        nextStreamSeq: sessionState.nextStreamSeq + 1,
      });
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });
  };

  const finalizeJob = async (job: JobState, options: { exitCode?: number } = {}) => {
    if (!state.activeSession) return;
    if (job.finished) {
      job.resolveCompletion();
      return;
    }

    if (job.status === 'running') {
      job.status = 'failed';
    }

    if (typeof options.exitCode === 'number') {
      job.exitCode = options.exitCode;
    }

    job.proc = undefined;
    job.childPeer = undefined;
    job.childSessionId = undefined;
    job.childTransportClose = undefined;
    job.finished = true;

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_finished',
        data: {
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          outcome: job.status,
          ...(typeof options.exitCode === 'number' ? { exitCode: options.exitCode } : {}),
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    await emitSessionUpdate({
      type: 'job_finished',
      jobId: job.jobId,
      parentJobId: job.parentJobId,
      ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
      outcome: job.status,
    });

    job.resolveCompletion();
  };

  const requestPermissionFromClient = async (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    jobId?: string;
    toolCallId: string;
    tool: string;
    kind?: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
    input: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{ decision?: string; updatedInput?: Record<string, unknown> }> => {
    const requestedAt = new Date().toISOString();

    const record: PendingPermissionRecord = {
      toolCallId: request.toolCallId,
      turnId: request.turnId,
      turnSeq: request.turnSeq,
      jobId: request.jobId,
      tool: request.tool,
      kind: request.kind,
      resource: request.resource,
      options: request.options,
      requestedAt,
      input: request.input,
    };

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'permission_requested',
        turnId: request.turnId,
        data: {
          toolCallId: request.toolCallId,
          turnSeq: request.turnSeq,
          ...(request.jobId ? { jobId: request.jobId } : {}),
          tool: request.tool,
          ...(request.kind ? { kind: request.kind } : {}),
          resource: request.resource,
          options: request.options,
          requestedAt,
          input: request.input,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    const { requestId: rpcId, result } = peer.requestWithId('session/request_permission', {
      sessionId: request.sessionId,
      turnId: request.turnId,
      turnSeq: request.turnSeq,
      jobId: request.jobId,
      tool: request.tool,
      kind: request.kind,
      resource: request.resource,
      options: request.options,
      requestedAt,
      toolCallId: request.toolCallId,
    });

    state.pendingPermissionRequests.set(request.toolCallId, {
      requestId: String(rpcId),
      rpcId,
      record,
      result,
    });

    const abortPromise = request.signal
      ? new Promise<never>((_, reject) => {
          request.signal!.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          });
        })
      : null;

    let response: any;
    try {
      response = abortPromise ? await Promise.race([result, abortPromise]) : await result;
    } catch {
      peer.abandonRequest(rpcId);
      state.pendingPermissionRequests.delete(request.toolCallId);

      await runExclusive(() => {
        let sessionState = readSessionState(state.activeSession!.dir);
        const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
          type: 'permission_cancelled',
          turnId: request.turnId,
          data: { toolCallId: request.toolCallId, turnSeq: request.turnSeq, reason: 'cancelled' },
        });
        sessionState = nextState;
        writeSessionState(state.activeSession!.dir, sessionState);
        state.activeSession = loadSession(state.activeSession!.meta.sessionId);
      });

      throw new Error('cancelled');
    }

    const decision = toNonEmptyString(response?.decision) ?? undefined;
    const updatedInput =
      response?.updatedInput && typeof response.updatedInput === 'object'
        ? (response.updatedInput as Record<string, unknown>)
        : undefined;

    state.pendingPermissionRequests.delete(request.toolCallId);

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'permission_decided',
        turnId: request.turnId,
        data: {
          toolCallId: request.toolCallId,
          turnSeq: request.turnSeq,
          ...(decision ? { decision } : {}),
          ...(updatedInput ? { updatedInput } : {}),
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    return { ...(decision ? { decision } : {}), ...(updatedInput ? { updatedInput } : {}) };
  };

  const reissuePendingPermissionRequests = async (): Promise<void> => {
    if (!state.activeSession) return;

    const sessionId = state.activeSession.meta.sessionId;
    const pending = derivePendingPermissionsFromDurableEvents(state.activeSession.dir);
    for (const record of pending) {
      if (state.pendingPermissionRequests.has(record.toolCallId)) continue;

      const { requestId: rpcId, result } = peer.requestWithId('session/request_permission', {
        sessionId,
        turnId: record.turnId,
        turnSeq: record.turnSeq,
        ...(record.jobId ? { jobId: record.jobId } : {}),
        toolCallId: record.toolCallId,
        tool: record.tool,
        kind: record.kind,
        resource: record.resource,
        options: record.options,
        requestedAt: record.requestedAt,
      });

      state.pendingPermissionRequests.set(record.toolCallId, {
        requestId: String(rpcId),
        rpcId,
        record,
        result,
      });

      void (async () => {
        try {
          const response = (await result) as any;
          const decision = toNonEmptyString(response?.decision) ?? undefined;
          const updatedInput =
            response?.updatedInput && typeof response.updatedInput === 'object'
              ? (response.updatedInput as Record<string, unknown>)
              : undefined;

          state.pendingPermissionRequests.delete(record.toolCallId);

          await runExclusive(() => {
            let sessionState = readSessionState(state.activeSession!.dir);
            const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
              type: 'permission_decided',
              turnId: record.turnId,
              data: {
                toolCallId: record.toolCallId,
                turnSeq: record.turnSeq,
                ...(decision ? { decision } : {}),
                ...(updatedInput ? { updatedInput } : {}),
              },
            });
            sessionState = nextState;
            writeSessionState(state.activeSession!.dir, sessionState);
            state.activeSession = loadSession(state.activeSession!.meta.sessionId);
          });
        } catch {
          state.pendingPermissionRequests.delete(record.toolCallId);
        }
      })();
    }
  };

  const _startShellJob = async (options: {
    command: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
  }): Promise<{ jobId: string }> => {
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const jobId = `job_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    const job: JobState = {
      jobId,
      parentJobId: options.parentJobId,
      type: 'shell',
      status: 'running',
      description: options.description,
      command: options.command,
      startedAt,
      originTurnId: options.turnContext?.turnId,
      originTurnSeq: options.turnContext?.turnSeq,
      outputPath,
      finished: false,
      completion,
      resolveCompletion,
    };

    state.jobs.set(jobId, job);

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_started',
        turnId: options.turnContext?.turnId,
        turnSeq: options.turnContext?.turnSeq,
        data: {
          jobId,
          parentJobId: options.parentJobId,
          jobType: 'shell',
          description: options.description,
          command: options.command,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    await emitSessionUpdate(
      {
        type: 'job_started',
        jobId,
        parentJobId: options.parentJobId,
        jobType: 'shell',
        description: options.description,
      },
      options.turnContext
        ? { turnId: options.turnContext.turnId, turnSeq: options.turnContext.turnSeq }
        : undefined
    );

    void runShellJobProcess(job);
    return { jobId };
  };

  const startSubagentJob = async (options: {
    prompt: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
  }): Promise<{ jobId: string }> => {
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const jobId = `job_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    const job: JobState = {
      jobId,
      parentJobId: options.parentJobId,
      type: 'subagent',
      status: 'running',
      description: options.description ?? 'Subagent',
      command: options.prompt,
      subagentContent: [{ type: 'text', text: options.prompt }],
      startedAt,
      originTurnId: options.turnContext?.turnId,
      originTurnSeq: options.turnContext?.turnSeq,
      outputPath,
      finished: false,
      completion,
      resolveCompletion,
    };

    state.jobs.set(jobId, job);

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_started',
        turnId: options.turnContext?.turnId,
        turnSeq: options.turnContext?.turnSeq,
        data: {
          jobId,
          parentJobId: options.parentJobId,
          jobType: 'subagent',
          description: job.description,
          command: options.prompt,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    await emitSessionUpdate(
      {
        type: 'job_started',
        jobId,
        parentJobId: options.parentJobId,
        jobType: 'subagent',
        description: job.description,
      },
      options.turnContext
        ? { turnId: options.turnContext.turnId, turnSeq: options.turnContext.turnSeq }
        : undefined
    );

    void runSubagentJobProcess(job);
    return { jobId };
  };

  const runShellJobProcess = (job: JobState) => {
    void (async () => {
      if (!state.activeSession) return;
      if (job.proc || job.finished) return;

      const sessionState = readSessionState(state.activeSession.dir);
      const effectiveConfig = sessionState.config
        ? { ...state.config, ...sessionState.config }
        : state.config;

      const toolName = 'bash';
      const kind = toolKindFromName(toolName);
      const requiresPermission = shouldAskPermission(effectiveConfig.approvalMode, kind);

      if (effectiveConfig.approvalMode === 'deny') {
        job.status = 'cancelled';
        await finalizeJob(job);
        return;
      }

      if (requiresPermission) {
        const toolCallId = `tool_${randomUUID()}`;
        const toolInput = { command: job.command ?? '' } as Record<string, unknown>;
        const permissionTurnId = job.originTurnId ?? `turn_${randomUUID()}`;
        const permissionTurnSeq = job.originTurnSeq ?? 0;
        job.permissionAbortController = new AbortController();

        await emitSessionUpdate({
          type: 'job_update',
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          jobType: 'shell',
          channel: 'internal',
          update: {
            type: 'tool_use',
            toolCallId,
            name: toolName,
            kind,
            input: toolInput,
            status: 'awaiting_permission',
          },
        });

        let decision: { decision?: string; updatedInput?: Record<string, unknown> };
        try {
          decision = await requestPermissionFromClient({
            sessionId: state.activeSession.meta.sessionId,
            turnId: permissionTurnId,
            turnSeq: permissionTurnSeq,
            jobId: job.jobId,
            toolCallId,
            tool: toolName,
            kind,
            resource: String(job.command ?? ''),
            options: [
              { optionId: 'allow', label: 'Allow' },
              { optionId: 'deny', label: 'Deny' },
            ],
            input: toolInput,
            signal: job.permissionAbortController.signal,
          });
        } catch {
          job.permissionAbortController = undefined;
          job.status = 'cancelled';
          await finalizeJob(job);
          return;
        }
        job.permissionAbortController = undefined;

        if (job.finished || job.status === 'cancelled') {
          return;
        }

        if (decision?.decision !== 'allow') {
          const denied: ToolResult = {
            outcome: 'denied',
            content: [{ type: 'error', message: 'Denied by user' }],
          };

          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'shell',
            channel: 'internal',
            update: {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: toolInput,
              status: 'denied',
              result: denied,
            },
          });

          job.status = 'cancelled';
          await finalizeJob(job);
          return;
        }
      }

      const proc = spawn(job.command ?? '', {
        cwd: state.activeSession.meta.workDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      job.proc = proc;

      proc.stdout!.setEncoding('utf8');
      proc.stderr!.setEncoding('utf8');

      const appendOutput = async (chunk: string) => {
        if (!state.activeSession) return;
        await runExclusive(() => {
          appendFileSync(job.outputPath, chunk, { encoding: 'utf8' });
        });
      };

      const onStdout = async (chunk: string) => {
        await appendOutput(chunk);
        if (state.jobStreaming === 'none') return;
        await emitSessionUpdate({
          type: 'job_update',
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          jobType: 'shell',
          channel: 'stdout',
          update: { type: 'text_delta', text: chunk },
        });
      };

      const onStderr = async (chunk: string) => {
        await appendOutput(chunk);
        if (state.jobStreaming === 'none') return;
        await emitSessionUpdate({
          type: 'job_update',
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          jobType: 'shell',
          channel: 'stderr',
          update: { type: 'text_delta', text: chunk },
        });
      };

      proc.stdout!.on('data', (chunk) => void onStdout(chunk as string));
      proc.stderr!.on('data', (chunk) => void onStderr(chunk as string));

      proc.on('close', (code) => {
        void (async () => {
          if (job.finished) {
            job.resolveCompletion();
            return;
          }

          const exitCode = code ?? 0;
          if (job.status !== 'cancelled') {
            job.status = exitCode === 0 ? 'completed' : 'failed';
          }

          await finalizeJob(job, { exitCode });
        })();
      });
    })();
  };

  const runSubagentJobProcess = (job: JobState) => {
    void (async () => {
      if (!state.activeSession) return;
      if (job.proc || job.finished) return;
      if (!job.subagentContent || !Array.isArray(job.subagentContent)) {
        job.status = 'failed';
        await finalizeJob(job);
        return;
      }

      const childProc = spawn(process.execPath, [process.argv[1] ?? ''], {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      job.proc = childProc;

      const childTransport = createNdjsonStdioTransport({
        readable: childProc.stdout,
        writable: childProc.stdin,
      });
      job.childTransportClose = childTransport.close;

      const childPeer = new JsonRpcPeer(childTransport, { idPrefix: 'c_' });
      job.childPeer = childPeer;

      const appendJobOutput = async (text: string) => {
        if (!state.activeSession) return;
        await runExclusive(() => {
          appendFileSync(job.outputPath, text, { encoding: 'utf8' });
        });
      };

      const childJobIdMap = new Map<string, string>();

      const mapChildJobId = (childJobId: string): string => {
        const existing = childJobIdMap.get(childJobId);
        if (existing) return existing;
        const mapped = `${job.jobId}_${childJobId}`;
        childJobIdMap.set(childJobId, mapped);
        return mapped;
      };

      const ensureForwardedJobRecord = (options: {
        jobId: string;
        parentJobId?: string;
        type: JobType;
        description?: string;
      }): JobState => {
        const existing = state.jobs.get(options.jobId);
        if (existing) return existing;

        let resolveCompletion!: () => void;
        const completion = new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        });

        const record: JobState = {
          jobId: options.jobId,
          parentJobId: options.parentJobId,
          type: options.type,
          status: 'running',
          description: options.description,
          startedAt: new Date().toISOString(),
          outputPath: getJobOutputPath(state.activeSession!.dir, options.jobId),
          finished: false,
          completion,
          resolveCompletion,
        };

        state.jobs.set(options.jobId, record);
        return record;
      };

      childPeer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        const type = p.type;

        if (type === 'job_started' && typeof p.jobId === 'string') {
          const mappedJobId = mapChildJobId(p.jobId);
          const mappedParentJobId =
            typeof p.parentJobId === 'string' ? mapChildJobId(p.parentJobId) : job.jobId;
          const jobType = p.jobType === 'subagent' ? 'subagent' : 'shell';
          const description = typeof p.description === 'string' ? p.description : undefined;

          ensureForwardedJobRecord({
            jobId: mappedJobId,
            parentJobId: mappedParentJobId,
            type: jobType,
            description,
          });

          await runExclusive(() => {
            let sessionState = readSessionState(state.activeSession!.dir);
            const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
              type: 'job_started',
              data: {
                jobId: mappedJobId,
                parentJobId: mappedParentJobId,
                jobType,
                description,
              },
            });
            sessionState = nextState;
            writeSessionState(state.activeSession!.dir, sessionState);
            state.activeSession = loadSession(state.activeSession!.meta.sessionId);
          });

          await emitSessionUpdate({
            type: 'job_started',
            jobId: mappedJobId,
            parentJobId: mappedParentJobId,
            jobType,
            description,
          });

          return undefined;
        }

        if (type === 'job_finished' && typeof p.jobId === 'string') {
          const mappedJobId = mapChildJobId(p.jobId);
          const mappedParentJobId =
            typeof p.parentJobId === 'string' ? mapChildJobId(p.parentJobId) : job.jobId;
          const exitCode = typeof p.exitCode === 'number' ? p.exitCode : undefined;
          const outcome =
            p.outcome === 'completed' || p.outcome === 'failed' ? p.outcome : 'cancelled';

          const record = ensureForwardedJobRecord({
            jobId: mappedJobId,
            parentJobId: mappedParentJobId,
            type: p.jobType === 'subagent' ? 'subagent' : 'shell',
          });
          record.status = outcome;
          record.finished = true;
          record.proc = undefined;
          record.childPeer = undefined;
          record.childSessionId = undefined;
          record.childTransportClose = undefined;
          record.exitCode = exitCode;

          await runExclusive(() => {
            let sessionState = readSessionState(state.activeSession!.dir);
            const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
              type: 'job_finished',
              data: {
                jobId: mappedJobId,
                parentJobId: mappedParentJobId,
                outcome,
                ...(exitCode !== undefined ? { exitCode } : {}),
              },
            });
            sessionState = nextState;
            writeSessionState(state.activeSession!.dir, sessionState);
            state.activeSession = loadSession(state.activeSession!.meta.sessionId);
          });

          await emitSessionUpdate({
            type: 'job_finished',
            jobId: mappedJobId,
            parentJobId: mappedParentJobId,
            ...(exitCode !== undefined ? { exitCode } : {}),
            outcome,
          });

          record.resolveCompletion();
          return undefined;
        }

        if (
          type === 'job_update' &&
          typeof p.jobId === 'string' &&
          p.update &&
          typeof p.update === 'object'
        ) {
          const mappedJobId = mapChildJobId(p.jobId);
          const mappedParentJobId =
            typeof p.parentJobId === 'string' ? mapChildJobId(p.parentJobId) : job.jobId;

          const record = ensureForwardedJobRecord({
            jobId: mappedJobId,
            parentJobId: mappedParentJobId,
            type: p.jobType === 'subagent' ? 'subagent' : 'shell',
          });

          const channel = p.channel === 'stdout' || p.channel === 'stderr' ? p.channel : 'internal';
          const update = p.update as any;

          if (update.type === 'text_delta' && typeof update.text === 'string') {
            await runExclusive(() => {
              appendFileSync(record.outputPath, update.text, { encoding: 'utf8' });
            });
          }

          if (update.type === 'tool_use' && typeof update.toolCallId === 'string') {
            update.toolCallId = `${mappedJobId}:${update.toolCallId}`;
          }

          await emitSessionUpdate({
            type: 'job_update',
            jobId: mappedJobId,
            parentJobId: mappedParentJobId,
            jobType: record.type,
            channel,
            update,
          });

          return undefined;
        }

        if (type === 'text_delta' && typeof p.text === 'string') {
          await appendJobOutput(p.text);
          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'subagent',
            channel: 'internal',
            update: { type: 'text_delta', text: p.text },
          });
          return undefined;
        }

        if (type === 'tool_use' && typeof p.toolCallId === 'string' && typeof p.name === 'string') {
          const namespacedToolCallId = `${job.jobId}:${p.toolCallId}`;
          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'subagent',
            channel: 'internal',
            update: {
              type: 'tool_use',
              toolCallId: namespacedToolCallId,
              name: p.name,
              kind: typeof p.kind === 'string' ? (p.kind as any) : undefined,
              input: (typeof p.input === 'object' && p.input ? (p.input as any) : {}) as Record<
                string,
                unknown
              >,
              status: p.status as any,
              ...(p.result ? { result: p.result as any } : {}),
            },
          });
          return undefined;
        }

        if (type === 'context_injected') {
          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'subagent',
            channel: 'internal',
            update: p as any,
          });
          return undefined;
        }

        return undefined;
      });

      childPeer.onRequest('session/request_permission', async (params) => {
        const p = params as Record<string, unknown>;

        const childToolCallId =
          typeof p.toolCallId === 'string' ? p.toolCallId : `tool_${randomUUID()}`;

        const mappedJobId = typeof p.jobId === 'string' ? mapChildJobId(p.jobId) : job.jobId;
        const namespacedToolCallId = `${mappedJobId}:${childToolCallId}`;

        const turnId =
          typeof p.turnId === 'string' ? p.turnId : (job.originTurnId ?? `turn_${randomUUID()}`);
        const turnSeq = typeof p.turnSeq === 'number' ? p.turnSeq : (job.originTurnSeq ?? 0);

        const decision = await requestPermissionFromClient({
          sessionId: state.activeSession!.meta.sessionId,
          turnId,
          turnSeq,
          jobId: mappedJobId,
          toolCallId: namespacedToolCallId,
          tool: typeof p.tool === 'string' ? p.tool : 'unknown',
          kind: typeof p.kind === 'string' ? p.kind : undefined,
          resource: typeof p.resource === 'string' ? p.resource : '',
          options: Array.isArray(p.options)
            ? (p.options as any)
            : [
                { optionId: 'allow', label: 'Allow' },
                { optionId: 'deny', label: 'Deny' },
              ],
          input: (typeof p.input === 'object' && p.input ? (p.input as any) : {}) as Record<
            string,
            unknown
          >,
        });

        if (job.finished || job.status === 'cancelled') {
          return { decision: 'deny' };
        }

        return { decision: decision.decision ?? 'deny', updatedInput: decision.updatedInput };
      });

      try {
        await childPeer.request('initialize', {
          protocolVersion: '1.0',
          clientInfo: { name: 'lace-agent', version: '0.1.0' },
          capabilities: {
            streaming: true,
            permissions: true,
            'ent/jobStreaming': state.jobStreaming,
          },
          config: { approvalMode: 'ask' },
        });

        const created = (await childPeer.request('session/new', {
          workDir: state.activeSession.meta.workDir,
        })) as { sessionId: string };
        job.childSessionId = created.sessionId;

        await childPeer.request('session/prompt', { content: job.subagentContent });

        if (job.status !== 'cancelled') job.status = 'completed';
      } catch {
        if (job.status !== 'cancelled') job.status = 'failed';
      } finally {
        try {
          childPeer.close();
        } catch {
          // ignore
        }

        try {
          job.childTransportClose?.();
        } catch {
          // ignore
        }

        if (childProc.exitCode === null) {
          childProc.kill('SIGTERM');
          await new Promise<void>((resolve) => childProc.once('exit', () => resolve()));
        }

        await finalizeJob(job);
      }
    })();
  };

  peer.onRequest('initialize', async (params: unknown) => {
    if (state.initialized)
      throw {
        code: EntErrorCodes.AlreadyInitialized,
        message: 'AlreadyInitialized',
        data: { category: 'agent_internal' },
      };

    const parsed = params as Record<string, unknown> | undefined;
    if (!parsed || typeof parsed !== 'object')
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    if (parsed.protocolVersion !== '1.0')
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    const clientInfo = parsed.clientInfo as Record<string, unknown> | undefined;
    if (!clientInfo || typeof clientInfo !== 'object')
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
    if (typeof clientInfo.name !== 'string' || clientInfo.name.length === 0)
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
    if (typeof clientInfo.version !== 'string' || clientInfo.version.length === 0)
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    const capabilities = parsed.capabilities as Record<string, unknown> | undefined;
    if (!capabilities || typeof capabilities !== 'object')
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    const config = (parsed.config as Record<string, unknown> | undefined) ?? undefined;

    state.initialized = true;
    if (config?.executionMode === 'plan') state.config.executionMode = 'plan';
    if (config?.executionMode === 'execute') state.config.executionMode = 'execute';

    const approvalMode = config?.approvalMode;
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

    if (typeof config?.connectionId === 'string') state.config.connectionId = config.connectionId;
    if (typeof config?.modelId === 'string') state.config.modelId = config.modelId;
    if (typeof config?.maxBudgetUsd === 'number') state.config.maxBudgetUsd = config.maxBudgetUsd;
    if (typeof config?.maxThinkingTokens === 'number')
      state.config.maxThinkingTokens = config.maxThinkingTokens;

    const jobStreaming = capabilities['ent/jobStreaming'];
    if (jobStreaming === 'full' || jobStreaming === 'coalesced' || jobStreaming === 'none') {
      state.jobStreaming = jobStreaming;
    }

    const { toolsForProvider } = createToolExecutorForMode('execute', state.mcpServerManager);
    const toolInfos: ToolInfo[] = [];
    const seenToolNames = new Set<string>();
    for (const tool of toolsForProvider) {
      const info = protocolToolInfoForCoreTool(tool);
      if (seenToolNames.has(info.name)) continue;
      seenToolNames.add(info.name);
      toolInfos.push(info);
    }

    return {
      protocolVersion: '1.0',
      agentInfo: { name: 'lace-agent', version: '0.1.0' },
      capabilities: {
        streaming: true,
        multiTurn: true,
        tools: toolInfos,
        operations: { checkpoint: true, rewind: true, configure: true, compact: true },
        'ent/contextInjection': true,
        'ent/backgroundJobs': true,
        'ent/fileCheckpointing': true,
        'ent/structuredOutput': false,
        'ent/providers': { list: true, connections: true, models: true },
      },
    };
  });

  peer.onRequest('ent/agent/ping', async (_params: unknown) => {
    assertInitialized(state);
    return { ok: true, timestamp: new Date().toISOString() };
  });

  peer.onRequest('ent/agent/status', async (_params: unknown) => {
    assertInitialized(state);

    const effectiveConfig = state.activeSession?.state.config
      ? { ...state.config, ...state.activeSession.state.config }
      : state.config;

    const sessionSummary = state.activeSession
      ? summarizeDurableEvents(state.activeSession.dir)
      : { messageCount: 0, lastActive: null as string | null };

    const pendingPermissions: PermissionRequest[] = [];
    if (state.activeSession) {
      const sessionId = state.activeSession.meta.sessionId;
      const pendingRecords = derivePendingPermissionsFromDurableEvents(state.activeSession.dir);
      if (pendingRecords.some((p) => !state.pendingPermissionRequests.has(p.toolCallId))) {
        await reissuePendingPermissionRequests();
      }

      for (const record of pendingRecords) {
        const issued = state.pendingPermissionRequests.get(record.toolCallId);
        if (!issued) continue;
        pendingPermissions.push({
          requestId: issued.requestId,
          toolCallId: record.toolCallId,
          sessionId,
          turnId: record.turnId,
          turnSeq: record.turnSeq,
          jobId: record.jobId,
          tool: record.tool,
          kind: record.kind,
          resource: record.resource,
          options: record.options,
          requestedAt: record.requestedAt,
        });
      }
    }

    const mcpServers = state.mcpServerManager.getAllServers().map((server) => {
      const status =
        server.status === 'running'
          ? 'connected'
          : server.status === 'starting'
            ? 'connecting'
            : server.status === 'failed'
              ? 'error'
              : 'disconnected';

      return {
        name: server.id,
        status,
        ...(server.lastError ? { error: server.lastError } : {}),
        ...(server.connectedAt ? { lastConnected: server.connectedAt.toISOString() } : {}),
      };
    });

    return {
      models: [],
      mcpServers,
      currentSession: state.activeSession
        ? {
            sessionId: state.activeSession.meta.sessionId,
            messageCount: sessionSummary.messageCount,
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

  const deriveJobsForActiveSession = (): Array<{
    jobId: string;
    parentJobId?: string;
    type: JobType;
    status: JobStatus;
    description?: string;
    command?: string;
    startTime: string;
    exitCode?: number;
  }> => {
    if (!state.activeSession) return [];

    const sessionDir = state.activeSession.dir;
    const eventsPath = join(sessionDir, 'events.jsonl');
    let raw = '';
    try {
      raw = readFileSync(eventsPath, 'utf8');
    } catch {
      return [];
    }

    const byId = new Map<
      string,
      {
        jobId: string;
        parentJobId?: string;
        type: JobType;
        status: JobStatus;
        description?: string;
        command?: string;
        startTime: string;
        exitCode?: number;
      }
    >();

    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string; timestamp?: string; data?: any };
        if (parsed.type !== 'job_started' && parsed.type !== 'job_finished') continue;
        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined;
        const data = parsed.data ?? {};
        const jobId = toNonEmptyString(data.jobId);
        if (!jobId) continue;

        if (parsed.type === 'job_started') {
          const jobType = data.jobType === 'subagent' ? 'subagent' : 'shell';
          const startTime = timestamp ?? new Date().toISOString();
          byId.set(jobId, {
            jobId,
            parentJobId: toNonEmptyString(data.parentJobId) ?? undefined,
            type: jobType,
            status: 'running',
            description: toNonEmptyString(data.description) ?? undefined,
            command: toNonEmptyString(data.command) ?? undefined,
            startTime,
          });
        } else {
          const existing = byId.get(jobId);
          const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined;
          const outcome =
            data.outcome === 'completed' ||
            data.outcome === 'failed' ||
            data.outcome === 'cancelled'
              ? data.outcome
              : undefined;

          if (existing) {
            existing.status = outcome ?? existing.status;
            existing.exitCode = exitCode;
          } else {
            byId.set(jobId, {
              jobId,
              type: 'shell',
              status: outcome ?? 'failed',
              startTime: timestamp ?? new Date().toISOString(),
              exitCode,
            });
          }
        }
      } catch {
        // Ignore malformed lines.
      }
    }

    for (const job of byId.values()) {
      if (job.status === 'running' && !state.jobs.has(job.jobId)) {
        job.status = 'failed';
      }
    }

    return Array.from(byId.values());
  };

  peer.onRequest('ent/providers/list', async (_params: unknown) => {
    assertInitialized(state);

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
    assertInitialized(state);

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
    assertInitialized(state);

    const parsed = params as {
      providerId?: string;
      connection: { connectionId?: string; name: string; config: Record<string, unknown> };
    };

    const name = toNonEmptyString(parsed?.connection?.name);
    if (!name) throwInvalidParams('connection.name is required');

    const config = parsed?.connection?.config;
    if (!config || typeof config !== 'object') throwInvalidParams('connection.config is required');
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
        throwInvalidParams('connectionId is already paired to a different providerId');
      }

      const overrides = parseProviderInstanceOverridesFromConnectionConfig({
        displayName: name,
        catalogProviderId: existing.catalogProviderId,
        config,
      });

      await state.providerInstances.updateInstance(connectionId, {
        displayName: name,
        ...overrides,
      });

      return { connectionId, providerId: existing.catalogProviderId, created: false };
    }

    const providerId = toNonEmptyString(parsed?.providerId);
    if (!providerId) throwInvalidParams('providerId is required when creating a new connection');

    await ensureProviderCatalogLoaded();
    const catalogProvider = state.providerCatalog.getProvider(providerId);
    if (!catalogProvider) throwInvalidParams(`Unknown providerId: ${providerId}`);
    if (!SUPPORTED_PROVIDER_TYPES.has(catalogProvider.type.toLowerCase())) {
      throwInvalidParams(`Provider is not supported by this agent: ${providerId}`);
    }

    const overrides = parseProviderInstanceOverridesFromConnectionConfig({
      displayName: name,
      catalogProviderId: providerId,
      config,
    });

    await state.providerInstances.saveInstances({
      ...instances,
      instances: {
        ...instances.instances,
        [connectionId]: {
          displayName: name,
          catalogProviderId: providerId,
          ...overrides,
        },
      },
    });

    return { connectionId, providerId, created };
  });

  peer.onRequest('ent/connections/delete', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    await state.providerInstances.deleteInstance(connectionId);
    return { ok: true };
  });

  peer.onRequest('ent/connections/test', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string; modelId?: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

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
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId])
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    const credential = state.providerInstances.loadCredential(connectionId);
    return {
      connectionId,
      state: credential?.apiKey ? 'ready' : 'missing',
    };
  });

  peer.onRequest('ent/connections/credentials/start', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string; method?: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId])
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

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
    assertInitialized(state);

    const parsed = params as { connectionId: string; values: Record<string, string> };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId])
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

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
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId])
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    await state.providerInstances.clearCredential(connectionId);
    return { ok: true };
  });

  peer.onRequest('ent/models/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance)
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    await ensureProviderCatalogLoaded();
    const providerId = instance.catalogProviderId;
    const provider = state.providerCatalog.getProvider(providerId);
    if (!provider) throwInvalidParams(`Unknown providerId: ${providerId}`);

    const models = provider.models.map((m) => mapCatalogModelToModelInfo(m, providerId));
    return { providerId, connectionId, models };
  });

  peer.onRequest('ent/models/refresh', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance)
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    await ensureProviderCatalogLoaded();
    const providerId = instance.catalogProviderId;
    const provider = state.providerCatalog.getProvider(providerId);
    if (!provider)
      throw {
        code: EntErrorCodes.ProviderError,
        message: 'Provider not found',
        data: { category: 'provider' },
      };

    // Refresh the model catalog (currently a no-op for static catalogs)
    return {
      connectionId,
      refreshedAt: new Date().toISOString(),
      ok: true,
    };
  });

  peer.onRequest('ent/tools/list', async (_params: unknown) => {
    assertInitialized(state);

    const { toolsForProvider } = createToolExecutorForMode(
      state.config.executionMode,
      state.mcpServerManager
    );

    const seenToolNames = new Set<string>();
    const tools: ToolInfo[] = [];
    for (const tool of toolsForProvider) {
      const info = protocolToolInfoForCoreTool(tool);
      if (seenToolNames.has(info.name)) continue;
      seenToolNames.add(info.name);
      tools.push(info);
    }

    return { tools };
  });

  peer.onRequest('ent/personas/list', async (_params: unknown) => {
    const personas = personaRegistry.listAvailablePersonas();
    return { personas };
  });

  // MCP Server Management Handlers

  peer.onRequest('ent/mcp/servers/list', async (_params: unknown) => {
    assertInitialized(state);

    const servers = state.mcpServerManager.getAllServers().map((connection) => {
      // Get tool count from cached discovered tools in config
      let toolCount: number | undefined;
      if (connection.config.discoveredTools) {
        toolCount = connection.config.discoveredTools.length;
      }

      return {
        serverId: connection.id,
        name: connection.id,
        command: connection.config.command,
        args: connection.config.args,
        enabled: connection.config.enabled,
        status: connection.status,
        lastError: connection.lastError,
        connectedAt: connection.connectedAt?.toISOString(),
        toolCount,
      };
    });

    return { servers };
  });

  peer.onRequest('ent/mcp/servers/upsert', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as {
      serverId?: string;
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
      tools?: Record<string, string>;
    };

    const name = toNonEmptyString(parsed?.name);
    const command = toNonEmptyString(parsed?.command);
    if (!name) throwInvalidParams('name is required');
    if (!command) throwInvalidParams('command is required');

    const serverId = toNonEmptyString(parsed?.serverId) ?? name;
    const existing = state.mcpServerManager.getServer(serverId);
    const created = !existing;

    const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : true;
    const tools: Record<string, ToolPolicy> =
      parsed.tools && typeof parsed.tools === 'object'
        ? (parsed.tools as Record<string, ToolPolicy>)
        : {};

    const config: MCPServerConfig = {
      command,
      ...(Array.isArray(parsed.args) ? { args: parsed.args } : {}),
      ...(parsed.env && typeof parsed.env === 'object' ? { env: parsed.env } : {}),
      enabled,
      tools,
    };

    // Update session config to include this MCP server
    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      const existingMcpServers = Array.isArray(sessionState.config?.mcpServers)
        ? sessionState.config.mcpServers
        : [];

      // Find and replace or add the server config
      const updatedServers = existingMcpServers.filter((s: any) => s.name !== serverId);
      updatedServers.push({
        name: serverId,
        command: config.command,
        ...(config.args ? { args: config.args } : {}),
        ...(config.env ? { env: config.env } : {}),
        enabled: config.enabled,
        ...(Object.keys(config.tools).length > 0 ? { tools: config.tools } : {}),
      });

      writeSessionState(state.activeSession!.dir, {
        ...sessionState,
        config: {
          ...sessionState.config,
          mcpServers: updatedServers,
        },
      });
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    // Start the server if enabled
    if (enabled) {
      await state.mcpServerManager.startServer(serverId, {
        ...config,
        cwd: state.activeSession.meta.workDir,
      });
    }

    return { serverId, created };
  });

  peer.onRequest('ent/mcp/servers/delete', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as { serverId: string };
    const serverId = toNonEmptyString(parsed?.serverId);
    if (!serverId) throwInvalidParams('serverId is required');

    // Stop the server if running
    await state.mcpServerManager.stopServer(serverId);

    // Remove from session config
    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      const existingMcpServers = Array.isArray(sessionState.config?.mcpServers)
        ? sessionState.config.mcpServers
        : [];

      const updatedServers = existingMcpServers.filter((s: any) => s.name !== serverId);

      writeSessionState(state.activeSession!.dir, {
        ...sessionState,
        config: {
          ...sessionState.config,
          mcpServers: updatedServers,
        },
      });
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    return { ok: true as const };
  });

  peer.onRequest('ent/mcp/servers/test', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { serverId: string };
    const serverId = toNonEmptyString(parsed?.serverId);
    if (!serverId) throwInvalidParams('serverId is required');

    const server = state.mcpServerManager.getServer(serverId);
    if (!server)
      throw {
        code: EntErrorCodes.McpServerNotFound,
        message: 'McpServerNotFound',
        data: { category: 'mcp', serverId },
      };

    // If not running, try to start it
    if (server.status !== 'running') {
      const startTime = Date.now();
      try {
        await state.mcpServerManager.startServer(serverId, {
          ...server.config,
          cwd: state.activeSession?.meta.workDir,
        });

        // Get tool count from the client
        const client = state.mcpServerManager.getClient(serverId);
        let toolCount: number | undefined;
        if (client) {
          try {
            const toolsResult = await client.listTools();
            toolCount = toolsResult.tools.length;
          } catch {
            // Ignore tool listing errors
          }
        }

        const latencyMs = Date.now() - startTime;
        return { ok: true, latencyMs, toolCount };
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          latencyMs,
        };
      }
    }

    // Already running, just test connectivity by listing tools
    const client = state.mcpServerManager.getClient(serverId);
    if (!client) {
      return { ok: false, error: 'No client available' };
    }

    const startTime = Date.now();
    try {
      const toolsResult = await client.listTools();
      const latencyMs = Date.now() - startTime;
      return { ok: true, latencyMs, toolCount: toolsResult.tools.length };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs,
      };
    }
  });

  peer.onRequest('ent/mcp/tools/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { serverId: string };
    const serverId = toNonEmptyString(parsed?.serverId);
    if (!serverId) throwInvalidParams('serverId is required');

    const server = state.mcpServerManager.getServer(serverId);
    if (!server)
      throw {
        code: EntErrorCodes.McpServerNotFound,
        message: 'McpServerNotFound',
        data: { category: 'mcp', serverId },
      };

    const client = state.mcpServerManager.getClient(serverId);
    if (!client || server.status !== 'running') {
      throw {
        code: EntErrorCodes.McpServerNotFound,
        message: 'McpServerNotRunning',
        data: { category: 'mcp', serverId, status: server.status },
      };
    }

    try {
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
      }));

      return { serverId, tools };
    } catch (error) {
      throw {
        code: EntErrorCodes.ProviderError,
        message: 'McpToolListError',
        data: {
          category: 'mcp',
          serverId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  });

  peer.onRequest('ent/job/list', async (_params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const jobs = deriveJobsForActiveSession().map((j) => ({
      jobId: j.jobId,
      parentJobId: j.parentJobId,
      type: j.type,
      status: j.status,
      description: j.description,
      command: j.command,
      startTime: j.startTime,
    }));

    return { jobs };
  });

  peer.onRequest('ent/job/output', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as {
      jobId: string;
      block?: boolean;
      timeout?: number;
      tailBytes?: number;
      afterOffset?: number;
    };

    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) throwInvalidParams('jobId is required');

    const block = !!parsed.block;
    const timeout = typeof parsed.timeout === 'number' && parsed.timeout > 0 ? parsed.timeout : 0;

    const runningJob = state.jobs.get(jobId);
    if (block && runningJob?.status === 'running') {
      await Promise.race([
        runningJob.completion,
        timeout > 0
          ? new Promise<void>((resolve) => setTimeout(resolve, timeout))
          : new Promise<void>(() => {}),
      ]);
    }

    const jobs = deriveJobsForActiveSession();
    const record = jobs.find((j) => j.jobId === jobId);
    if (!record)
      throw {
        code: EntErrorCodes.JobNotFound,
        message: 'JobNotFound',
        data: { category: 'session' },
      };

    const sessionDir = state.activeSession.dir;
    const outputPath = getJobOutputPath(sessionDir, jobId);

    let totalBytes = 0;
    try {
      totalBytes = statSync(outputPath).size;
    } catch {
      totalBytes = 0;
    }

    const afterOffset =
      typeof parsed.afterOffset === 'number' && parsed.afterOffset >= 0 ? parsed.afterOffset : 0;
    const tailBytes =
      typeof parsed.tailBytes === 'number' && parsed.tailBytes > 0 ? parsed.tailBytes : 0;

    const clampedAfter = Math.min(afterOffset, totalBytes);
    const startOffset =
      tailBytes > 0 ? Math.max(clampedAfter, totalBytes - tailBytes) : clampedAfter;
    const bytesToRead = Math.max(0, totalBytes - startOffset);

    let output = '';
    if (bytesToRead > 0) {
      const fd = openSync(outputPath, 'r');
      try {
        const buf = Buffer.allocUnsafe(bytesToRead);
        const read = readSync(fd, buf, 0, bytesToRead, startOffset);
        output = buf.subarray(0, read).toString('utf8');
      } finally {
        closeSync(fd);
      }
    }

    return {
      status: record.status,
      output,
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      outputMeta: {
        totalBytes,
        returnedOffset: startOffset,
        returnedBytes: Buffer.byteLength(output, 'utf8'),
        truncated: startOffset > 0,
      },
      report: {
        summary:
          record.status === 'completed'
            ? 'Job completed'
            : record.status === 'cancelled'
              ? 'Job cancelled'
              : record.status === 'running'
                ? 'Job running'
                : 'Job failed',
        ...(record.status === 'failed' ? { error: 'Job failed' } : {}),
      },
    };
  });

  peer.onRequest('ent/job/kill', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as { jobId: string };
    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) throwInvalidParams('jobId is required');

    const job = state.jobs.get(jobId);
    if (!job || job.status !== 'running') return { success: false };

    job.status = 'cancelled';

    if (job.proc) {
      job.proc.kill('SIGTERM');
      return { success: true };
    }

    // Job is awaiting permission or otherwise not yet started; finalize immediately.
    if (job.permissionAbortController) {
      job.permissionAbortController.abort();
      job.permissionAbortController = undefined;
    }
    await finalizeJob(job);

    return { success: true };
  });

  peer.onRequest('ent/job/inject', async (params: unknown) => {
    const parsed = params as { jobId: string; content: unknown[]; priority: string };
    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) return undefined;

    const job = state.jobs.get(jobId);
    if (!job || job.type !== 'subagent' || job.finished) return undefined;
    if (!job.childPeer) return undefined;

    const priority =
      parsed?.priority === 'immediate' ||
      parsed?.priority === 'normal' ||
      parsed?.priority === 'deferred'
        ? parsed.priority
        : 'normal';

    job.childPeer.notify('ent/session/inject', {
      content: Array.isArray(parsed?.content) ? parsed.content : [],
      priority,
    });

    return undefined;
  });

  peer.onRequest('session/new', async (params: unknown) => {
    assertInitialized(state);
    if (state.activeSession)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const parsed = params as { workDir: string; persona?: string; systemPrompt?: unknown };
    if (!parsed?.workDir) throwInvalidParams('workDir is required');

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
    await reconcileMcpServersForActiveSession(state);

    return { sessionId, created };
  });

  peer.onRequest('session/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { workDir?: string } | undefined;
    const workDirFilter = parsed?.workDir;

    return { sessions: listSessions(workDirFilter) };
  });

  peer.onRequest('session/load', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { sessionId: string; fork?: boolean };
    if (!parsed?.sessionId) throwInvalidParams('sessionId is required');
    if (!isSessionId(parsed.sessionId)) {
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
    }
    if (parsed.fork) throwInvalidParams('fork not implemented');

    if (state.activeSession && state.activeSession.meta.sessionId !== parsed.sessionId) {
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };
    }

    let loaded: LoadedSession;
    try {
      loaded = loadSession(parsed.sessionId);
    } catch (error) {
      if (error instanceof Error && error.message === 'Session not found') {
        throw {
          code: AcpErrorCodes.SessionNotFound,
          message: 'SessionNotFound',
          data: { category: 'session' },
        };
      }
      throw error;
    }
    state.activeSession = loaded;
    await reconcileMcpServersForActiveSession(state);
    await reissuePendingPermissionRequests();
    const summary = summarizeDurableEvents(loaded.dir);
    return {
      sessionId: parsed.sessionId,
      messageCount: summary.messageCount,
      lastActive: summary.lastActive ?? loaded.meta.created,
    };
  });

  peer.onRequest('ent/session/configure', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as Partial<{
      connectionId: string;
      modelId: string;
      maxThinkingTokens: number;
      maxBudgetUsd: number;
      mcpServers: unknown;
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

    if (parsed.mcpServers !== undefined) {
      const mcpParsed = McpServerConfigSchema.array().safeParse(parsed.mcpServers);
      if (!mcpParsed.success) {
        throwInvalidParams('mcpServers is invalid');
      }

      for (const server of mcpParsed.data) {
        if (server.transport && server.transport !== 'stdio') {
          throwInvalidParams(`Unsupported MCP transport for ${server.name}: ${server.transport}`);
        }
      }

      const existing = Array.isArray((currentConfig as any).mcpServers)
        ? McpServerConfigSchema.array().safeParse((currentConfig as any).mcpServers)
        : { success: true as const, data: [] as Array<any> };
      const existingServers = existing.success ? existing.data : [];

      const incomingByName = new Map(mcpParsed.data.map((s) => [s.name, s]));
      const merged: any[] = [];
      const seen = new Set<string>();

      for (const oldServer of existingServers) {
        const incoming = incomingByName.get(oldServer.name);
        if (incoming) {
          merged.push({ ...oldServer, ...incoming });
          seen.add(oldServer.name);
        } else {
          merged.push(oldServer);
          seen.add(oldServer.name);
        }
      }

      for (const server of mcpParsed.data) {
        if (seen.has(server.name)) continue;
        merged.push(server);
      }

      (nextConfig as any).mcpServers = merged;
      applied.push('mcpServers');
    }

    const nextState = { ...currentState, config: nextConfig };
    writeSessionState(state.activeSession.dir, nextState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);

    const effectiveAfter = { ...state.config, ...(state.activeSession.state.config || {}) };
    await reconcileMcpServersForActiveSession(state);

    return {
      applied,
      config: {
        executionMode: effectiveAfter.executionMode,
        connectionId: effectiveAfter.connectionId,
        modelId: effectiveAfter.modelId,
        maxThinkingTokens: effectiveAfter.maxThinkingTokens,
        maxBudgetUsd: effectiveAfter.maxBudgetUsd,
        approvalMode: effectiveAfter.approvalMode,
        mcpServers: (state.activeSession.state.config as any)?.mcpServers,
      },
    };
  });

  peer.onRequest('ent/session/compact', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const parsed = params as
      | {
          strategy?: 'summarize' | 'truncate' | 'selective';
          targetTokens?: number;
          preserveRecent?: number;
        }
      | undefined;

    const strategy =
      parsed?.strategy === 'summarize' ||
      parsed?.strategy === 'truncate' ||
      parsed?.strategy === 'selective'
        ? parsed.strategy
        : 'truncate';

    const targetTokens =
      typeof parsed?.targetTokens === 'number' &&
      Number.isFinite(parsed.targetTokens) &&
      parsed.targetTokens > 0
        ? Math.trunc(parsed.targetTokens)
        : undefined;

    let preserveRecent =
      typeof parsed?.preserveRecent === 'number' &&
      Number.isFinite(parsed.preserveRecent) &&
      parsed.preserveRecent >= 0
        ? Math.trunc(parsed.preserveRecent)
        : 10;

    return await runExclusive(async () => {
      const beforeMessages = buildProviderMessagesFromDurableEvents(state.activeSession!.dir);
      const previousTokens = estimateProviderTokens(beforeMessages);

      const sessionStateForConfig = readSessionState(state.activeSession!.dir);
      const effectiveConfig = sessionStateForConfig.config
        ? { ...state.config, ...sessionStateForConfig.config }
        : state.config;

      if (targetTokens !== undefined) {
        while (
          preserveRecent > 0 &&
          estimateProviderTokens(beforeMessages.slice(-preserveRecent)) > targetTokens
        ) {
          preserveRecent -= 1;
        }
      }

      const preservedRecentMessages =
        preserveRecent > 0 ? beforeMessages.slice(-preserveRecent) : [];
      const dropped = beforeMessages.slice(
        0,
        beforeMessages.length - preservedRecentMessages.length
      );

      let compactedDroppedMessages: ProviderMessage[] = [];
      let summary: string | undefined;

      if (dropped.length > 0) {
        if (strategy === 'truncate') {
          const result = await compactDroppedMessagesWithCore({
            strategyId: 'trim-tool-results',
            dropped,
            threadId: state.activeSession!.meta.sessionId,
          });
          compactedDroppedMessages = result.messages;
        } else {
          const provider = await createProviderForTurn({
            connectionId: effectiveConfig.connectionId,
            modelId: effectiveConfig.modelId,
          });

          const result = await compactDroppedMessagesWithCore({
            strategyId: 'summarize',
            dropped,
            provider,
            modelId: effectiveConfig.modelId || 'unknown-model',
            threadId: state.activeSession!.meta.sessionId,
          });
          compactedDroppedMessages = result.messages;
          summary = result.summary;
        }
      }

      const nextProviderMessages: ProviderMessage[] = [
        ...compactedDroppedMessages,
        ...preservedRecentMessages,
      ];

      let _removedForBudget = 0;
      let currentTokens = estimateProviderTokens(nextProviderMessages);
      if (targetTokens !== undefined) {
        while (nextProviderMessages.length > 0 && currentTokens > targetTokens) {
          nextProviderMessages.shift();
          _removedForBudget += 1;
          currentTokens = estimateProviderTokens(nextProviderMessages);
        }
      }

      const messagesCompacted = dropped.length;

      const serializedPreserved = nextProviderMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        ...(Array.isArray((m as any).toolCalls) ? { toolCalls: (m as any).toolCalls } : {}),
        ...(Array.isArray((m as any).toolResults) ? { toolResults: (m as any).toolResults } : {}),
      }));

      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'context_compacted',
        data: {
          strategy,
          ...(targetTokens !== undefined ? { targetTokens } : {}),
          preserveRecent,
          messagesCompacted,
          preserved: serializedPreserved,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);

      return {
        previousTokens,
        currentTokens,
        messagesCompacted,
        ...(strategy === 'summarize' && typeof summary === 'string' && summary.trim().length > 0
          ? { summary }
          : {}),
      };
    });
  });

  peer.onRequest('ent/session/checkpoint', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const parsed = params as { label?: string } | undefined;
    const label = toNonEmptyString(parsed?.label) ?? undefined;

    return await runExclusive(() => {
      const checkpointId = `chk_${randomUUID()}`;

      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState, written } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'checkpoint_created',
        data: { checkpointId, ...(label ? { label } : {}) },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);

      const workDir = state.activeSession.meta.workDir;
      const files = deriveCheckpointFilesFromDurableEvents(state.activeSession.dir, workDir);
      const meta = writeCheckpoint(state.activeSession.dir, {
        workDir,
        checkpointId,
        eventSeq: written.eventSeq,
        label,
        files,
      });

      return { checkpointId: meta.checkpointId, eventSeq: meta.eventSeq, files: meta.files };
    });
  });

  peer.onRequest('ent/session/rewind', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const parsed = params as { toEventSeq: number };
    const toEventSeq =
      typeof parsed?.toEventSeq === 'number' && Number.isFinite(parsed.toEventSeq)
        ? Math.trunc(parsed.toEventSeq)
        : null;
    if (toEventSeq === null || toEventSeq < 0)
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    return await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      const currentEventSeq = sessionState.nextEventSeq - 1;
      if (toEventSeq > currentEventSeq)
        throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

      const checkpoint = findCheckpointByEventSeq(state.activeSession!.dir, toEventSeq);
      if (!checkpoint) {
        throw {
          code: EntErrorCodes.CheckpointNotFound,
          message: 'CheckpointNotFound',
          data: { category: 'session' },
        };
      }

      const workDir = state.activeSession!.meta.workDir;
      const { filesRestored } = restoreCheckpointFiles(state.activeSession!.dir, {
        workDir,
        checkpointId: checkpoint.checkpointId,
      });

      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'files_rewound',
        data: { checkpointId: checkpoint.checkpointId, toEventSeq, filesRestored },
      });
      writeSessionState(state.activeSession!.dir, nextState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);

      return { filesRestored, eventSeq: toEventSeq };
    });
  });

  peer.onRequest('ent/session/inject', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

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
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

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
    assertInitialized(state);
    if (!state.activeSession) return undefined;

    if (state.activeTurn) {
      state.activeTurn.abortController.abort();
      return undefined;
    }

    return undefined;
  });

  peer.onRequest('session/set_mode', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const parsed = params as { mode?: unknown } | undefined;
    const mode: 'plan' | 'execute' =
      parsed?.mode === 'plan'
        ? 'plan'
        : parsed?.mode === 'execute'
          ? 'execute'
          : throwInvalidParams('mode must be "plan" or "execute"');

    return await runExclusive(() => {
      if (!state.activeSession)
        throw {
          code: AcpErrorCodes.SessionNotFound,
          message: 'SessionNotFound',
          data: { category: 'session' },
        };

      const currentState = readSessionState(state.activeSession.dir);
      const currentConfig = currentState.config || {};
      const effectiveBefore = { ...state.config, ...currentConfig };
      const previousMode =
        effectiveBefore.executionMode === 'plan' ? ('plan' as const) : ('execute' as const);

      const nextState = { ...currentState, config: { ...currentConfig, executionMode: mode } };
      writeSessionState(state.activeSession.dir, nextState);
      state.activeSession = { ...state.activeSession, state: nextState };
      state.config.executionMode = mode;

      return { mode, previousMode };
    });
  });

  peer.onRequest('session/prompt', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const effectiveConfig = state.activeSession.state.config
      ? { ...state.config, ...state.activeSession.state.config }
      : state.config;

    const parsed = params as { content: unknown[] };
    const turnId = `turn_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    state.activeTurn = { turnId, startedAt, status: 'running', abortController };

    let durableTurnSeq = 0;
    const writeAndAdvance = async (event: { type: string; data: Record<string, unknown> }) => {
      await runExclusive(() => {
        if (!state.activeSession) return;
        let sessionState: SessionState = readSessionState(state.activeSession.dir);
        const { nextState } = appendDurableEvent(state.activeSession.dir, sessionState, {
          type: event.type,
          data: event.data,
          turnId,
          turnSeq: durableTurnSeq++,
        });
        sessionState = nextState;
        writeSessionState(state.activeSession.dir, sessionState);
        state.activeSession = { ...state.activeSession, state: sessionState };
      });
    };

    await writeAndAdvance({ type: 'prompt', data: { content: parsed.content } });
    await writeAndAdvance({ type: 'turn_start', data: {} });
    await emitSessionUpdate({ type: 'turn_start' }, { turnId, turnSeq: 0 });

    const emitUpdate = async (turnSeq: number, update: SessionUpdate) => {
      await emitSessionUpdate(update, { turnId, turnSeq });
    };

    if (abortController.signal.aborted) {
      await writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });
      const result = {
        turnId,
        stopReason: 'cancelled' as const,
        content: [] as { type: 'text'; text: string }[],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      await emitSessionUpdate(
        {
          type: 'turn_end',
          stopReason: result.stopReason,
          content: result.content,
          usage: result.usage,
        },
        { turnId, turnSeq: 1 }
      );
      state.activeSession = loadSession(state.activeSession.meta.sessionId);
      state.activeTurn = null;
      return result;
    }

    const promptText = (parsed.content as any[])
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');

    const runMatch = promptText.match(/^\s*run:\s*(.+)\s*$/m);
    const command = runMatch?.[1]?.trim();

    const jobMatch = promptText.match(/^\s*job:\s*(.+)\s*$/m);
    const jobCommand = jobMatch?.[1]?.trim();

    const subagentMatch = promptText.match(/^\s*subagent:\s*(.+)\s*$/m);
    const subagentText = subagentMatch?.[1]?.trim();

    const workDir = state.activeSession.meta.workDir;
    const filesRead = deriveFilesReadFromDurableEvents(state.activeSession.dir, workDir);

    if (!command && !jobCommand && !subagentText) {
      const maxTurns =
        typeof (params as any)?.maxTurns === 'number' && Number.isFinite((params as any).maxTurns)
          ? Math.max(1, Math.trunc((params as any).maxTurns))
          : 10;

      const { executor: toolExecutor, toolsForProvider } = createToolExecutorForMode(
        effectiveConfig.executionMode,
        state.mcpServerManager
      );

      const provider = await createProviderForTurn({
        connectionId: effectiveConfig.connectionId,
        modelId: effectiveConfig.modelId,
      });

      let providerMessages = buildProviderMessagesFromDurableEvents(state.activeSession.dir);
      let finalAssistantContent = '';
      let stopReason: 'end_turn' | 'max_tokens' | 'max_turns' | 'cancelled' | 'budget_exceeded' =
        'end_turn';

      let streamTurnSeq = 0;

      let completedTurns = 0;

      try {
        for (; completedTurns < maxTurns; completedTurns++) {
          const messageTurnSeq = streamTurnSeq++;
          let streamedAny = false;

          const onToken = (payload: { token?: string }) => {
            if (abortController.signal.aborted) return;
            if (!payload?.token) return;
            streamedAny = true;
            void emitUpdate(messageTurnSeq, { type: 'text_delta', text: payload.token });
          };

          provider.on('token', onToken);
          const response = await provider.createStreamingResponse(
            providerMessages,
            toolsForProvider,
            effectiveConfig.modelId || 'unknown-model',
            abortController.signal
          );
          provider.off('token', onToken);

          if (abortController.signal.aborted) {
            stopReason = 'cancelled';
            break;
          }

          const assistantText = typeof response.content === 'string' ? response.content : '';
          finalAssistantContent = assistantText;

          if (!streamedAny && assistantText.length > 0) {
            await emitUpdate(messageTurnSeq, { type: 'text_delta', text: assistantText });
          }

          await writeAndAdvance({ type: 'message', data: { content: assistantText } });

          const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
          if (toolCalls.length === 0) {
            stopReason = response.stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn';
            break;
          }

          providerMessages = [
            ...providerMessages,
            {
              role: 'assistant',
              content: assistantText,
              toolCalls: toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              })),
            },
          ];

          let shouldContinue = true;

          for (const toolCall of toolCalls) {
            const toolCallId = toNonEmptyString(toolCall.id) ?? `tool_${randomUUID()}`;
            const toolName = toNonEmptyString(toolCall.name) ?? '';
            const toolInput =
              typeof toolCall.arguments === 'object' && toolCall.arguments
                ? (toolCall.arguments as Record<string, unknown>)
                : {};

            const toolTurnSeq = streamTurnSeq++;
            const kind = toolKindFromName(toolName);

            await emitUpdate(toolTurnSeq, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: toolInput,
              status: 'pending',
            });

            if (effectiveConfig.approvalMode === 'deny') {
              const denied: ToolResult = {
                outcome: 'denied',
                content: [{ type: 'error', message: 'Denied by policy' }],
              };

              await emitUpdate(toolTurnSeq, {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'denied',
                result: denied,
              });

              await writeAndAdvance({
                type: 'tool_use',
                data: { toolCallId, name: toolName, kind, input: toolInput, result: denied },
              });

              shouldContinue = false;
              continue;
            }

            if (effectiveConfig.executionMode === 'plan' && kind !== 'read' && kind !== 'search') {
              const denied: ToolResult = {
                outcome: 'denied',
                content: [{ type: 'error', message: 'Tool denied in plan mode' }],
              };

              await emitUpdate(toolTurnSeq, {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'denied',
                result: denied,
              });

              await writeAndAdvance({
                type: 'tool_use',
                data: { toolCallId, name: toolName, kind, input: toolInput, result: denied },
              });

              shouldContinue = false;
              continue;
            }

            const tool = toolExecutor.getTool(toolName);
            if (!tool && toolName !== 'delegate') {
              const failed: ToolResult = {
                outcome: 'failed',
                content: [{ type: 'error', message: `Tool not found: ${toolName}` }],
              };

              await emitUpdate(toolTurnSeq, {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'failed',
                result: failed,
              });

              await writeAndAdvance({
                type: 'tool_use',
                data: { toolCallId, name: toolName, kind, input: toolInput, result: failed },
              });

              shouldContinue = false;
              continue;
            }

            let finalInput = toolInput;

            const needsPermission = shouldAskPermission(effectiveConfig.approvalMode, kind);
            if (needsPermission) {
              state.activeTurn = {
                turnId,
                startedAt,
                status: 'awaiting_permission',
                abortController,
              };

              const options = [
                { optionId: 'allow', label: 'Allow' },
                { optionId: 'deny', label: 'Deny' },
              ];

              await emitUpdate(toolTurnSeq, {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'awaiting_permission',
              });

              let permissionResponse:
                | { decision?: string; updatedInput?: Record<string, unknown> }
                | undefined;

              try {
                permissionResponse = await requestPermissionFromClient({
                  sessionId: state.activeSession.meta.sessionId,
                  turnId,
                  turnSeq: toolTurnSeq,
                  toolCallId,
                  tool: toolName,
                  kind,
                  resource: toolName,
                  options,
                  input: toolInput,
                  signal: abortController.signal,
                });
              } catch {
                const cancelled: ToolResult = {
                  outcome: 'cancelled',
                  content: [{ type: 'error', message: 'Cancelled' }],
                };

                await emitUpdate(toolTurnSeq, {
                  type: 'tool_use',
                  toolCallId,
                  name: toolName,
                  kind,
                  input: toolInput,
                  status: 'cancelled',
                  result: cancelled,
                });

                await writeAndAdvance({
                  type: 'tool_use',
                  data: { toolCallId, name: toolName, kind, input: toolInput, result: cancelled },
                });

                shouldContinue = false;
                continue;
              }

              state.activeTurn = { turnId, startedAt, status: 'running', abortController };

              const decision = toNonEmptyString(permissionResponse?.decision);
              if (permissionResponse?.updatedInput) {
                finalInput = permissionResponse.updatedInput;
              }

              if (decision === 'deny') {
                const denied: ToolResult = {
                  outcome: 'denied',
                  content: [{ type: 'error', message: 'Denied by user' }],
                };

                await emitUpdate(toolTurnSeq, {
                  type: 'tool_use',
                  toolCallId,
                  name: toolName,
                  kind,
                  input: toolInput,
                  status: 'denied',
                  result: denied,
                });

                await writeAndAdvance({
                  type: 'tool_use',
                  data: { toolCallId, name: toolName, kind, input: toolInput, result: denied },
                });

                shouldContinue = false;
                continue;
              }
            }

            await emitUpdate(toolTurnSeq, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: finalInput,
              status: 'running',
            });

            let coreResult: CoreToolResult;

            if (toolName === 'delegate') {
              const prompt = toNonEmptyString((finalInput as any).prompt);
              if (!prompt) {
                coreResult = {
                  status: 'failed',
                  content: [{ type: 'text', text: 'delegate.prompt is required' }],
                };
              } else {
                const { jobId } = await startSubagentJob({
                  prompt,
                  description: 'Delegate',
                  turnContext: { turnId, turnSeq: toolTurnSeq },
                });

                const job = state.jobs.get(jobId);
                if (job) {
                  const abortPromise = new Promise<never>((_, reject) => {
                    abortController.signal.addEventListener(
                      'abort',
                      () => reject(new Error('cancelled')),
                      {
                        once: true,
                      }
                    );
                  });

                  try {
                    await Promise.race([job.completion, abortPromise]);
                  } catch {
                    job.status = 'cancelled';
                    await finalizeJob(job);
                  }
                }

                let output = '';
                try {
                  output = readFileSync(getJobOutputPath(state.activeSession.dir, jobId), 'utf8');
                } catch {
                  output = '';
                }

                const tailLimit = 64 * 1024;
                const truncated = output.length > tailLimit;
                const reportText = truncated ? output.slice(-tailLimit) : output;

                const status = job?.status ?? 'failed';
                coreResult = {
                  status:
                    status === 'completed'
                      ? 'completed'
                      : status === 'cancelled'
                        ? 'aborted'
                        : 'failed',
                  content: [
                    {
                      type: 'text',
                      text:
                        `delegate jobId=${jobId}\n\n` +
                        (reportText.trim().length > 0 ? reportText.trim() : '(no output)') +
                        (truncated ? '\n\n(truncated)' : ''),
                    },
                  ],
                };
              }
            } else {
              coreResult = await toolExecutor.execute(
                { id: toolCallId, name: toolName, arguments: finalInput },
                {
                  signal: abortController.signal,
                  workingDirectory: workDir,
                  toolTempRoot: join(state.activeSession.dir, 'tool-temp'),
                  hasFileBeenRead: (p) =>
                    filesRead.has(isAbsolutePath(p) ? p : resolvePath(workDir, p)),
                }
              );

              if (toolName === 'file_read' && coreResult.status === 'completed') {
                const p = toNonEmptyString(finalInput.path);
                if (p) filesRead.add(isAbsolutePath(p) ? p : resolvePath(workDir, p));
              }
            }

            const protocolResult = protocolToolResultFromCore(coreResult);
            const terminalStatus =
              protocolResult.outcome === 'completed'
                ? 'completed'
                : protocolResult.outcome === 'denied'
                  ? 'denied'
                  : protocolResult.outcome === 'cancelled'
                    ? 'cancelled'
                    : 'failed';

            await emitUpdate(toolTurnSeq, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: finalInput,
              status: terminalStatus,
              result: protocolResult,
            });

            await writeAndAdvance({
              type: 'tool_use',
              data: { toolCallId, name: toolName, kind, input: finalInput, result: protocolResult },
            });

            providerMessages = [
              ...providerMessages,
              { role: 'user', content: '', toolResults: [coreResult] },
            ];

            if (coreResult.status !== 'completed') {
              shouldContinue = false;
            }
          }

          if (!shouldContinue) {
            break;
          }
        }

        if (abortController.signal.aborted) {
          stopReason = 'cancelled';
        }
      } finally {
        provider.cleanup();
      }

      if (stopReason === 'end_turn' && completedTurns >= maxTurns) {
        stopReason = 'max_turns';
      }

      await writeAndAdvance({ type: 'turn_end', data: { stopReason } });
      const result = {
        turnId,
        stopReason,
        content:
          finalAssistantContent.length > 0
            ? [{ type: 'text' as const, text: finalAssistantContent }]
            : ([] as { type: 'text'; text: string }[]),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      await emitSessionUpdate(
        {
          type: 'turn_end',
          stopReason: result.stopReason,
          content: result.content,
          usage: result.usage,
        },
        { turnId, turnSeq: streamTurnSeq }
      );
      state.activeSession = loadSession(state.activeSession.meta.sessionId);
      state.activeTurn = null;
      return result;
    }

    const deferredJobs: JobState[] = [];
    let nextJobTurnSeq = 1;

    if (jobCommand && effectiveConfig.executionMode === 'execute') {
      const jobId = `job_${randomUUID()}`;
      const startedAt = new Date().toISOString();
      const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });

      const job: JobState = {
        jobId,
        type: 'shell',
        status: 'running',
        description: 'Background shell job',
        command: jobCommand,
        startedAt,
        originTurnId: turnId,
        originTurnSeq: nextJobTurnSeq,
        outputPath,
        finished: false,
        completion,
        resolveCompletion,
      };

      state.jobs.set(jobId, job);

      await writeAndAdvance({
        type: 'job_started',
        data: { jobId, jobType: 'shell', description: job.description, command: jobCommand },
      });

      await emitUpdate(nextJobTurnSeq++, {
        type: 'job_started',
        jobId,
        jobType: 'shell',
        description: job.description,
      });

      deferredJobs.push(job);
    }

    if (subagentText && effectiveConfig.executionMode === 'execute') {
      const jobId = `job_${randomUUID()}`;
      const startedAt = new Date().toISOString();
      const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });

      const job: JobState = {
        jobId,
        type: 'subagent',
        status: 'running',
        description: 'Subagent',
        command: subagentText,
        subagentContent: [{ type: 'text', text: subagentText }],
        startedAt,
        originTurnId: turnId,
        originTurnSeq: nextJobTurnSeq,
        outputPath,
        finished: false,
        completion,
        resolveCompletion,
      };

      state.jobs.set(jobId, job);

      await writeAndAdvance({
        type: 'job_started',
        data: {
          jobId,
          jobType: 'subagent',
          description: job.description,
          command: subagentText,
        },
      });

      await emitUpdate(nextJobTurnSeq++, {
        type: 'job_started',
        jobId,
        jobType: 'subagent',
        description: job.description,
      });

      deferredJobs.push(job);
    }

    if (command && effectiveConfig.executionMode === 'execute') {
      const toolCallId = `tool_${randomUUID()}`;
      const toolName = 'bash';
      const kind = toolKindFromName(toolName);
      const toolInput = { command } as Record<string, unknown>;
      let shouldExecuteTool = true;

      await emitUpdate(1, {
        type: 'tool_use',
        toolCallId,
        name: toolName,
        kind,
        input: toolInput,
        status: 'pending',
      });

      const requiresPermission = shouldAskPermission(effectiveConfig.approvalMode, kind);

      if (effectiveConfig.approvalMode === 'deny') {
        const denied: ToolResult = {
          outcome: 'denied',
          content: [{ type: 'error', message: 'Denied by policy' }],
        };

        shouldExecuteTool = false;
        await emitUpdate(1, {
          type: 'tool_use',
          toolCallId,
          name: toolName,
          kind,
          input: toolInput,
          status: 'denied',
          result: denied,
        });

        await writeAndAdvance({
          type: 'tool_use',
          data: {
            toolCallId,
            name: toolName,
            kind,
            input: toolInput,
            result: denied,
          },
        });
      } else {
        const { executor: toolExecutor } = createToolExecutorForMode(
          'execute',
          state.mcpServerManager
        );
        let finalInput = toolInput;

        if (requiresPermission) {
          state.activeTurn = { turnId, startedAt, status: 'awaiting_permission', abortController };

          const options = [
            { optionId: 'allow', label: 'Allow' },
            { optionId: 'deny', label: 'Deny' },
          ];

          await emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: toolName,
            kind,
            input: toolInput,
            status: 'awaiting_permission',
          });

          let permissionResponse:
            | { decision?: string; updatedInput?: Record<string, unknown> }
            | undefined;
          try {
            permissionResponse = await requestPermissionFromClient({
              sessionId: state.activeSession.meta.sessionId,
              turnId,
              turnSeq: 1,
              toolCallId,
              tool: toolName,
              kind,
              resource: command,
              options,
              input: toolInput,
              signal: abortController.signal,
            });
          } catch {
            const cancelled: ToolResult = {
              outcome: 'cancelled',
              content: [{ type: 'error', message: 'Cancelled' }],
            };

            await emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: toolInput,
              status: 'cancelled',
              result: cancelled,
            });

            await writeAndAdvance({
              type: 'tool_use',
              data: {
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                result: cancelled,
              },
            });
            await writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });
            const result = {
              turnId,
              stopReason: 'cancelled' as const,
              content: [] as { type: 'text'; text: string }[],
              usage: { inputTokens: 0, outputTokens: 0 },
            };
            await emitSessionUpdate(
              {
                type: 'turn_end',
                stopReason: result.stopReason,
                content: result.content,
                usage: result.usage,
              },
              { turnId, turnSeq: nextJobTurnSeq }
            );
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
            state.activeTurn = null;
            return result;
          }

          state.activeTurn = { turnId, startedAt, status: 'running', abortController };

          const decision = permissionResponse?.decision;
          if (decision === 'deny') {
            const denied: ToolResult = {
              outcome: 'denied',
              content: [{ type: 'error', message: 'Denied' }],
            };

            shouldExecuteTool = false;
            await emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: toolInput,
              status: 'denied',
              result: denied,
            });

            await writeAndAdvance({
              type: 'tool_use',
              data: {
                toolCallId,
                name: toolName,
                kind,
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

            await emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: finalInput,
              status: 'running',
            });
          }
        } else {
          await emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: toolName,
            kind,
            input: finalInput,
            status: 'running',
          });
        }

        if (shouldExecuteTool && !abortController.signal.aborted) {
          const coreResult = await toolExecutor.execute(
            { id: toolCallId, name: toolName, arguments: finalInput },
            {
              signal: abortController.signal,
              workingDirectory: workDir,
              toolTempRoot: join(state.activeSession.dir, 'tool-temp'),
              hasFileBeenRead: (p) =>
                filesRead.has(isAbsolutePath(p) ? p : resolvePath(workDir, p)),
            }
          );

          const result = protocolToolResultFromCore(coreResult);
          const terminalStatus =
            result.outcome === 'completed'
              ? 'completed'
              : result.outcome === 'denied'
                ? 'denied'
                : result.outcome === 'cancelled'
                  ? 'cancelled'
                  : 'failed';

          await emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: toolName,
            kind,
            input: finalInput,
            status: terminalStatus,
            result,
          });

          await writeAndAdvance({
            type: 'tool_use',
            data: {
              toolCallId,
              name: toolName,
              kind,
              input: finalInput,
              result,
            },
          });

          if (terminalStatus === 'cancelled') {
            await writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });
            const result = {
              turnId,
              stopReason: 'cancelled' as const,
              content: [] as { type: 'text'; text: string }[],
              usage: { inputTokens: 0, outputTokens: 0 },
            };
            await emitSessionUpdate(
              {
                type: 'turn_end',
                stopReason: result.stopReason,
                content: result.content,
                usage: result.usage,
              },
              { turnId, turnSeq: nextJobTurnSeq }
            );
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
            state.activeTurn = null;
            return result;
          }
        }
      }
    }

    await writeAndAdvance({
      type: 'message',
      data: { content: [{ type: 'text', text: 'hello' }] },
    });
    await writeAndAdvance({ type: 'turn_end', data: { stopReason: 'end_turn' } });
    const result = {
      turnId,
      stopReason: 'end_turn' as const,
      content: [{ type: 'text' as const, text: 'hello' }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    await emitSessionUpdate(
      {
        type: 'turn_end',
        stopReason: result.stopReason,
        content: result.content,
        usage: result.usage,
      },
      { turnId, turnSeq: nextJobTurnSeq }
    );
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    state.activeTurn = null;

    for (const job of deferredJobs) {
      if (job.type === 'shell') runShellJobProcess(job);
      if (job.type === 'subagent') runSubagentJobProcess(job);
    }

    return result;
  });

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
