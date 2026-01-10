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
import { join, dirname, resolve as resolvePath, isAbsolute as isAbsolutePath } from 'node:path';
import {
  createNdjsonStdioTransport,
  AcpErrorCodes,
  EntErrorCodes,
  McpServerConfigSchema,
  isSessionId,
  JsonRpcPeer,
  SessionUpdateNotificationSchema,
  SessionForkParamsSchema,
  type PermissionRequest,
  type ToolResult,
  type ContextBreakdown,
  type ThreadTokenUsage,
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
import { derivePendingPermissionsFromDurableEvents } from './storage/permissions-from-events';
import { ProviderCatalogManager } from './providers/catalog/manager';
import { ProviderInstanceManager } from './providers/instance/manager';
import {
  ProviderInstanceSchema,
  type CatalogModel,
  type ProviderInstance,
} from './providers/catalog/types';
import { ProviderRegistry } from './providers/registry';
import { AIProvider, type ProviderMessage, type ContentBlock } from './providers/base-provider';
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
import { loadPromptConfig } from './config/prompts';
import { logger } from './utils/logger';
import { getUserSlashCommands, findUserCommand } from './user-commands';
import { ensureJobLogDir, getJobOutputPath } from './jobs/job-manager';
import { createRunShellJobProcess } from './jobs/shell-job';
import { runSubagentJobProcess as runSubagentJobProcessImpl } from './jobs/subagent-job';
import {
  createQueueJobNotification,
  createSetupProgressTimer,
  createFinalizeJob,
} from './jobs/job-notifications';
import {
  SUPPORTED_PROVIDER_TYPES,
  JOB_LOG_DIR,
  MAX_CONCURRENT_JOBS,
  MAX_JOB_OUTPUT_BYTES,
  DEFAULT_PROGRESS_INTERVAL_MS,
  type SessionUpdateParams,
  type SessionUpdate,
  type JobInnerUpdate,
  type JobType,
  type JobStatus,
  type JobNotificationType,
  type JobState,
  type PendingJobNotification,
  type AgentServerState,
} from './server-types';
import {
  throwInvalidParams,
  toNonEmptyString,
  toPositiveInt,
  getEndpointFromConfig,
  assertConfigHasNoCredentials,
  parseProviderInstanceOverridesFromConnectionConfig,
  mapCatalogModelToModelInfo,
  toolKindFromName,
  protocolToolResultFromCore,
  coreToolResultFromProtocol,
  shouldAskPermission,
  isTestProviderEnabled,
  assertInitialized,
  arraysShallowEqual,
  recordsShallowEqual,
  mcpServerConfigEquivalent,
} from './rpc/utils';
import { requestPermissionFromClient, reissuePendingPermissionRequests } from './rpc/permissions';
import { registerInitializeHandler } from './rpc/handlers/initialize';
import { registerAgentStatusHandlers } from './rpc/handlers/agent-status';
import { registerProviderHandlers } from './rpc/handlers/providers';
import { registerConnectionHandlers } from './rpc/handlers/connections';
import { registerModelHandlers } from './rpc/handlers/models';
import { registerToolHandlers } from './rpc/handlers/tools';
import { registerJobHandlers } from './rpc/handlers/jobs';
import { registerSessionHandlers } from './rpc/handlers/session';
import { registerSessionOperationHandlers } from './rpc/handlers/session-operations';
import {
  registerMcpHandlers,
  reconcileMcpServersForActiveSession,
} from './rpc/handlers/mcp-servers';
import { registerPromptHandler } from './rpc/handlers/prompt';

async function getContextLimitForModel(
  state: AgentServerState,
  connectionId?: string,
  modelId?: string
): Promise<number | null> {
  // Keep behavior deterministic for tests and avoid network flakiness.
  if (isTestProviderEnabled()) return null;

  if (!connectionId || !modelId) return null;

  try {
    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) return null;

    const catalogProvider = state.providerCatalog.getProvider(instance.catalogProviderId);
    if (!catalogProvider) return null;

    const model = catalogProvider.models.find((m) => m.id === modelId);
    if (!model) return null;

    return typeof model.context_window === 'number' ? model.context_window : null;
  } catch {
    return null;
  }
}

async function computeContextBreakdownForActiveSession(state: AgentServerState): Promise<{
  breakdown: ContextBreakdown;
  tokenUsage: ThreadTokenUsage;
}> {
  const DEFAULT_CONTEXT_LIMIT = 200_000;
  const RESERVED_FOR_RESPONSE_TOKENS = 4096;

  const effectiveConfig = state.activeSession?.state.config
    ? { ...state.config, ...state.activeSession.state.config }
    : state.config;

  const connectionId = effectiveConfig.connectionId;
  const modelId = effectiveConfig.modelId ?? 'unknown-model';

  const providerMessages = buildProviderMessagesFromDurableEvents(state.activeSession!.dir);

  let systemPromptTokens = 0;
  let userTokens = 0;
  let assistantTokens = 0;
  let toolCallTokens = 0;
  let toolResultTokens = 0;

  for (const message of providerMessages) {
    const contentText =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((b: unknown): b is ContentBlock & { type: 'text' } => {
              return (b as ContentBlock).type === 'text';
            })
            .map((b: ContentBlock & { type: 'text' }) => b.text)
            .join('\n');
    if (message.role === 'system') systemPromptTokens += estimateTokens(contentText);
    if (message.role === 'user') userTokens += estimateTokens(contentText);
    if (message.role === 'assistant') assistantTokens += estimateTokens(contentText);

    if ((message as any).toolCalls) {
      toolCallTokens += estimateTokens(JSON.stringify((message as any).toolCalls));
    }
    if ((message as any).toolResults) {
      toolResultTokens += estimateTokens(JSON.stringify((message as any).toolResults));
    }
  }

  const { executor: coreExecutor } = createToolExecutorForMode(effectiveConfig.executionMode);
  const { executor: allExecutor } = createToolExecutorForMode(
    effectiveConfig.executionMode,
    state.mcpServerManager
  );

  const coreTools = coreExecutor.getAllTools();
  const coreToolNames = new Set(coreTools.map((t) => t.name));
  const allTools = allExecutor.getAllTools();

  const coreToolItems: Array<{ name: string; tokens: number }> = [];
  const mcpToolItems: Array<{ name: string; tokens: number }> = [];
  let coreToolsTokens = 0;
  let mcpToolsTokens = 0;

  for (const tool of coreTools) {
    const schema = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    };
    const tokens = estimateTokens(JSON.stringify(schema));
    coreToolItems.push({ name: tool.name, tokens });
    coreToolsTokens += tokens;
  }

  for (const tool of allTools) {
    if (coreToolNames.has(tool.name)) continue;
    const schema = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    };
    const tokens = estimateTokens(JSON.stringify(schema));
    mcpToolItems.push({ name: tool.name, tokens });
    mcpToolsTokens += tokens;
  }

  const messagesTokens = userTokens + assistantTokens + toolCallTokens + toolResultTokens;
  const totalUsedTokens = systemPromptTokens + coreToolsTokens + mcpToolsTokens + messagesTokens;

  const contextLimit =
    (await getContextLimitForModel(state, connectionId, effectiveConfig.modelId)) ??
    DEFAULT_CONTEXT_LIMIT;

  const percentUsed = contextLimit > 0 ? totalUsedTokens / contextLimit : 0;
  const freeTokens = contextLimit - totalUsedTokens - RESERVED_FOR_RESPONSE_TOKENS;

  const breakdown: ContextBreakdown = {
    timestamp: new Date().toISOString(),
    modelId,
    contextLimit,
    totalUsedTokens,
    percentUsed,
    categories: {
      systemPrompt: { tokens: systemPromptTokens },
      coreTools: {
        tokens: coreToolsTokens,
        ...(coreToolItems.length > 0 ? { items: coreToolItems } : {}),
      },
      mcpTools: {
        tokens: mcpToolsTokens,
        ...(mcpToolItems.length > 0 ? { items: mcpToolItems } : {}),
      },
      messages: {
        tokens: messagesTokens,
        subcategories: {
          userMessages: { tokens: userTokens },
          agentMessages: { tokens: assistantTokens },
          toolCalls: { tokens: toolCallTokens },
          toolResults: { tokens: toolResultTokens },
        },
      },
      reservedForResponse: { tokens: RESERVED_FOR_RESPONSE_TOKENS },
      freeSpace: { tokens: Math.max(0, freeTokens) },
    },
  };

  const tokenUsage: ThreadTokenUsage = {
    totalPromptTokens:
      systemPromptTokens +
      coreToolsTokens +
      mcpToolsTokens +
      userTokens +
      toolCallTokens +
      toolResultTokens,
    totalCompletionTokens: assistantTokens,
    totalTokens: totalUsedTokens,
    contextLimit,
    percentUsed,
    nearLimit: percentUsed >= 0.8,
  };

  return { breakdown, tokenUsage };
}

export function createToolExecutorForMode(
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

// Import and re-export public API from message-builder
import { buildProviderMessagesFromDurableEvents, estimateProviderTokens } from './events/message-builder';
export { buildProviderMessagesFromDurableEvents, estimateProviderTokens } from './events/message-builder';

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
    jobNotificationQueue: [],
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

  // Cache for deriveJobsForActiveSession - avoids re-reading events.jsonl on every call
  let jobsCache: {
    sessionId: string;
    fileSize: number;
    fileMtime: number;
    result: Array<{
      jobId: string;
      parentJobId?: string;
      type: JobType;
      status: JobStatus;
      description?: string;
      command?: string;
      startTime: string;
      exitCode?: number;
      subagentSessionId?: string;
    }>;
  } | null = null;

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

  // Reference to the prompt handler logic, assigned when session/prompt is registered.
  // This allows queueJobNotification to trigger turns internally when notifications
  // are pending and the agent is idle.
  const runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null } = {
    current: null,
  };

  // Create job notification functions using factories
  const queueJobNotification = createQueueJobNotification(state, runPromptInternalRef);
  const setupProgressTimer = createSetupProgressTimer(state, runPromptInternalRef, queueJobNotification);
  const finalizeJob = createFinalizeJob(state, runExclusive, emitSessionUpdate, queueJobNotification);

  const _requestPermissionFromClient = async (request: {
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
  }): Promise<{ decision?: string; updatedInput?: Record<string, unknown> }> =>
    requestPermissionFromClient(peer, state, runExclusive, request);

  const _reissuePendingPermissionRequests = async (): Promise<void> =>
    reissuePendingPermissionRequests(peer, state, runExclusive);

  const _startShellJob = async (options: {
    command: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
    progressIntervalMs?: number;
  }): Promise<{ jobId: string }> => {
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    // Check concurrent job limit
    const runningJobCount = [...state.jobs.values()].filter((j) => j.status === 'running').length;
    if (runningJobCount >= MAX_CONCURRENT_JOBS) {
      throw {
        code: -32003, // ResourceLimitExceeded
        message: `Maximum concurrent jobs (${MAX_CONCURRENT_JOBS}) exceeded`,
        data: { category: 'session' },
      };
    }

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
      type: 'bash',
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
      progressIntervalMs: options.progressIntervalMs,
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
          jobType: 'bash',
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
        jobType: 'bash',
        description: options.description,
      },
      options.turnContext
        ? { turnId: options.turnContext.turnId, turnSeq: options.turnContext.turnSeq }
        : undefined
    );

    // Set up progress timer for background job
    setupProgressTimer(job);

    void runShellJobProcess(job);
    return { jobId };
  };

  const startSubagentJob = async (options: {
    prompt: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
    resumeSessionId?: string;
    progressIntervalMs?: number;
    connectionId?: string;
    modelId?: string;
  }): Promise<{ jobId: string }> => {
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    // Check concurrent job limit
    const runningJobCount = [...state.jobs.values()].filter((j) => j.status === 'running').length;
    if (runningJobCount >= MAX_CONCURRENT_JOBS) {
      throw {
        code: -32003, // ResourceLimitExceeded
        message: `Maximum concurrent jobs (${MAX_CONCURRENT_JOBS}) exceeded`,
        data: { category: 'session' },
      };
    }

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
      type: 'delegate',
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
      progressIntervalMs: options.progressIntervalMs,
      connectionId: options.connectionId,
      modelId: options.modelId,
      // For resume: pre-set the subagentSessionId if resuming a previous session
      ...(options.resumeSessionId ? { subagentSessionId: options.resumeSessionId } : {}),
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
          jobType: 'delegate',
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
        jobType: 'delegate',
        description: job.description,
      },
      options.turnContext
        ? { turnId: options.turnContext.turnId, turnSeq: options.turnContext.turnSeq }
        : undefined
    );

    // Set up progress timer for background job
    setupProgressTimer(job);

    void runSubagentJobProcess(job);
    return { jobId };
  };

  const runShellJobProcess = createRunShellJobProcess({
    state: {
      activeSession: state.activeSession,
      config: state.config,
      jobStreaming: state.jobStreaming,
    },
    runExclusive,
    emitSessionUpdate,
    requestPermissionFromClient: _requestPermissionFromClient,
    finalizeJob,
  });

  const runSubagentJobProcess = (job: JobState) => {
    runSubagentJobProcessImpl(job, {
      getState: () => state,
      runExclusive,
      emitSessionUpdate,
      requestPermissionFromClient: _requestPermissionFromClient,
      finalizeJob,
    });
  };

  registerInitializeHandler(peer, state, createToolExecutorForMode);
  registerAgentStatusHandlers(peer, state, () => _reissuePendingPermissionRequests());
  registerProviderHandlers(peer, state);
  registerConnectionHandlers(peer, state);
  registerModelHandlers(peer, state);
  registerToolHandlers(peer, state, createToolExecutorForMode);
  registerSessionHandlers(peer, state, createToolExecutorForMode, runExclusive, _reissuePendingPermissionRequests);
  registerSessionOperationHandlers(peer, state, runExclusive, createToolExecutorForMode);
  registerMcpHandlers(peer, state, runExclusive);

  const deriveJobsForActiveSession = (): Array<{
    jobId: string;
    parentJobId?: string;
    type: JobType;
    status: JobStatus;
    description?: string;
    command?: string;
    startTime: string;
    exitCode?: number;
    subagentSessionId?: string;
  }> => {
    if (!state.activeSession) return [];

    const sessionId = state.activeSession.meta.sessionId;
    const sessionDir = state.activeSession.dir;
    const eventsPath = join(sessionDir, 'events.jsonl');

    // Check cache validity
    let fileSize = 0;
    let fileMtime = 0;
    try {
      const stats = statSync(eventsPath);
      fileSize = stats.size;
      fileMtime = stats.mtimeMs;
    } catch {
      return [];
    }

    if (
      jobsCache &&
      jobsCache.sessionId === sessionId &&
      jobsCache.fileSize === fileSize &&
      jobsCache.fileMtime === fileMtime
    ) {
      // Cache hit - but still need to update running job status from in-memory state
      const result = jobsCache.result.map((job) => {
        if (job.status === 'running' && !state.jobs.has(job.jobId)) {
          return { ...job, status: 'failed' as JobStatus };
        }
        return job;
      });
      return result;
    }

    // Cache miss - read and parse the file
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
        subagentSessionId?: string;
      }
    >();

    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string; timestamp?: string; data?: unknown };
        if (
          parsed.type !== 'job_started' &&
          parsed.type !== 'job_finished' &&
          parsed.type !== 'job_session_assigned'
        )
          continue;
        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined;
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        const jobId = toNonEmptyString(data.jobId);
        if (!jobId) continue;

        if (parsed.type === 'job_started') {
          const jobType = data.jobType === 'delegate' ? 'delegate' : 'bash';
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
        } else if (parsed.type === 'job_session_assigned') {
          const existing = byId.get(jobId);
          const subagentSessionId = toNonEmptyString(data.subagentSessionId);
          if (existing && subagentSessionId) {
            existing.subagentSessionId = subagentSessionId;
          }
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
              type: 'bash',
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

    // Update cache with parsed results (before applying running status updates)
    const parsedResult = Array.from(byId.values());
    jobsCache = {
      sessionId,
      fileSize,
      fileMtime,
      result: parsedResult,
    };

    // Apply running job status updates from in-memory state
    for (const job of parsedResult) {
      if (job.status === 'running' && !state.jobs.has(job.jobId)) {
        job.status = 'failed';
      }
    }

    return parsedResult;
  };

  peer.onRequest('ent/personas/list', async (_params: unknown) => {
    const personas = personaRegistry.listAvailablePersonas();
    return { personas };
  });

  registerJobHandlers(peer, state, deriveJobsForActiveSession, finalizeJob);

  registerPromptHandler(
    peer,
    state,
    runExclusive,
    emitSessionUpdate,
    _requestPermissionFromClient,
    createToolExecutorForMode,
    _startShellJob,
    startSubagentJob,
    deriveJobsForActiveSession,
    runShellJobProcess,
    runSubagentJobProcess,
    finalizeJob,
    runPromptInternalRef
  );

  peer.onRequest('ent/personas/list', async (_params: unknown) => {
    const personas = personaRegistry.listAvailablePersonas();
    return { personas };
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
