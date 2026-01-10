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
  type ToolInfo,
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
  protocolToolInfoForCoreTool,
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
    throwInvalidParams(
      'connectionId and modelId are required before prompting; call ent/session/configure'
    );
  }

  const registry = ProviderRegistry.getInstance();
  return await registry.createProviderFromInstanceAndModel(connectionId, modelId);
}

/**
 * Get model pricing from the catalog.
 * Returns pricing per million tokens (input and output) or null if unavailable.
 * For test provider, returns mock pricing for testing budget enforcement.
 */
async function getModelPricing(
  state: AgentServerState,
  connectionId?: string,
  modelId?: string
): Promise<{ costPer1mIn: number; costPer1mOut: number } | null> {
  // Test provider: get pricing from the provider itself
  if (isTestProviderEnabled()) {
    return TestAgentProvider.getPricing();
  }

  if (!connectionId || !modelId) return null;

  try {
    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) return null;

    const catalogProvider = state.providerCatalog.getProvider(instance.catalogProviderId);
    if (!catalogProvider) return null;

    const model = catalogProvider.models.find((m) => m.id === modelId);
    if (!model) return null;

    // Model pricing is optional - some models may not have pricing data
    if (model.cost_per_1m_in === undefined || model.cost_per_1m_out === undefined) {
      return null;
    }

    return {
      costPer1mIn: model.cost_per_1m_in,
      costPer1mOut: model.cost_per_1m_out,
    };
  } catch {
    return null;
  }
}

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

/**
 * Handle built-in slash commands (e.g., /compact, /mode, /help).
 * Returns a turn result if the command was handled, or null if not recognized.
 */
async function handleSlashCommand(
  state: AgentServerState,
  command: string,
  args: string,
  turnId: string,
  writeAndAdvance: (event: { type: string; data: Record<string, unknown> }) => Promise<void>,
  emitUpdate: (turnSeq: number, update: SessionUpdate) => Promise<void>
): Promise<{
  turnId: string;
  stopReason: 'end_turn';
  content: { type: 'text'; text: string }[];
  usage: { inputTokens: number; outputTokens: number };
} | null> {
  const finishTurn = async (text: string) => {
    // Write the message event for durability
    await writeAndAdvance({
      type: 'message',
      data: { content: text },
    });
    await writeAndAdvance({ type: 'turn_end', data: { stopReason: 'end_turn' } });
    // Emit streaming updates
    await emitUpdate(1, { type: 'text_delta', text });
    await emitUpdate(2, {
      type: 'turn_end',
      stopReason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    return {
      turnId,
      stopReason: 'end_turn' as const,
      content: [{ type: 'text' as const, text }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  };

  switch (command.toLowerCase()) {
    case 'compact': {
      // Trigger context compaction
      if (!state.activeSession) {
        return finishTurn('Error: No active session.');
      }

      try {
        // Use the summarize strategy for compaction
        const sessionDir = state.activeSession.dir;
        const sessionId = state.activeSession.meta.sessionId;
        const providerMessages = buildProviderMessagesFromDurableEvents(sessionDir);

        if (providerMessages.length < 2) {
          return finishTurn('Context is already minimal. Nothing to compact.');
        }

        // Get effective config for provider creation
        const effectiveConfig = state.activeSession.state.config
          ? { ...state.config, ...state.activeSession.state.config }
          : state.config;

        const provider = await createProviderForTurn({
          connectionId: effectiveConfig.connectionId,
          modelId: effectiveConfig.modelId,
        });

        const result = await compactDroppedMessagesWithCore({
          strategyId: 'summarize',
          dropped: providerMessages.slice(0, -1),
          provider,
          modelId: effectiveConfig.modelId,
          threadId: sessionId,
        });

        if (result.summary) {
          // Write compaction event
          await writeAndAdvance({
            type: 'compaction',
            data: {
              summary: result.summary,
              droppedCount: providerMessages.length - 1,
            },
          });
          return finishTurn(`Context compacted. Summary:\n\n${result.summary}`);
        } else {
          return finishTurn('Compaction completed but no summary was generated.');
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return finishTurn(`Error during compaction: ${msg}`);
      }
    }

    case 'clear': {
      // Clear the conversation - create a new session with the same workdir
      if (!state.activeSession) {
        return finishTurn('Error: No active session.');
      }

      try {
        const workDir = state.activeSession.meta.workDir;
        const sessionConfig = state.activeSession.state.config;

        // Create a new session
        const newSessionId = `sess_${randomUUID()}`;
        const created = new Date().toISOString();
        const newSessionDir = getSessionDir(newSessionId);

        writeSessionMeta(newSessionDir, { sessionId: newSessionId, workDir, created });
        writeSessionState(newSessionDir, {
          nextEventSeq: 0,
          nextStreamSeq: 0,
          config: sessionConfig,
        });
        ensureSessionFiles(newSessionDir);

        // Switch to the new session
        state.activeSession = loadSession(newSessionId);

        // Notify the client that the session has changed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await emitUpdate(0, {
          type: 'session_changed',
          newSessionId,
          reason: 'clear',
        } as any);

        return finishTurn(`Conversation cleared. New session: ${newSessionId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return finishTurn(`Error clearing conversation: ${msg}`);
      }
    }

    case 'mode': {
      // Change approval mode
      if (!args) {
        const currentMode =
          state.activeSession?.state.config?.approvalMode ?? state.config.approvalMode ?? 'ask';
        return finishTurn(
          `Current approval mode: ${currentMode}\n\nAvailable modes:\n- ask: Ask permission for each tool use\n- approveReads: Auto-approve read/search operations\n- approveEdits: Auto-approve reads + file edits\n- approve: Auto-approve everything\n- deny: Deny all tool use (read-only)`
        );
      }

      const validModes = new Set([
        'ask',
        'approveReads',
        'approveEdits',
        'approve',
        'deny',
        'dangerouslySkipPermissions',
      ]);

      if (!validModes.has(args)) {
        return finishTurn(
          `Invalid mode: ${args}\n\nValid modes: ask, approveReads, approveEdits, approve, deny`
        );
      }

      if (!state.activeSession) {
        return finishTurn('Error: No active session.');
      }

      try {
        const currentState = readSessionState(state.activeSession.dir);
        const nextConfig = {
          ...currentState.config,
          approvalMode: args as typeof state.config.approvalMode,
        };
        const nextState = { ...currentState, config: nextConfig };
        writeSessionState(state.activeSession.dir, nextState);
        state.activeSession = loadSession(state.activeSession.meta.sessionId);

        return finishTurn(`Approval mode changed to: ${args}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return finishTurn(`Error changing mode: ${msg}`);
      }
    }

    case 'help': {
      // Show available commands
      const helpText = args
        ? getCommandHelp(args)
        : `Available slash commands:

/compact - Summarize and compress context to reduce token usage
/clear - Clear conversation and start fresh (creates new session)
/mode [mode] - Show or change approval mode
/help [command] - Show this help or details for a specific command

Type /help <command> for more details on a specific command.`;

      return finishTurn(helpText);
    }

    case 'abort': {
      // Abort doesn't make sense in session/prompt since we're starting a new turn
      return finishTurn(
        'The /abort command is used to cancel an in-progress operation. Since this is a new prompt, there is nothing to abort.'
      );
    }

    default:
      // Command not recognized - return null to fall through to normal processing
      return null;
  }
}

function getCommandHelp(command: string): string {
  switch (command.toLowerCase()) {
    case 'compact':
      return `/compact - Summarize and compress context

Reduces token usage by summarizing earlier conversation history. Useful when approaching context limits.

Usage: /compact`;

    case 'clear':
      return `/clear - Clear conversation and start fresh

Creates a new session with the same working directory and configuration, giving you a clean slate.

Usage: /clear`;

    case 'mode':
      return `/mode - Show or change approval mode

Controls how the agent handles tool permissions.

Usage:
  /mode         - Show current mode
  /mode <mode>  - Change to specified mode

Available modes:
  ask           - Ask permission for each tool use (default)
  approveReads  - Auto-approve read/search operations
  approveEdits  - Auto-approve reads + file edits
  approve       - Auto-approve everything (yolo mode)
  deny          - Deny all tool use (read-only mode)`;

    case 'help':
      return `/help - Show available commands

Usage:
  /help           - List all commands
  /help <command> - Show details for a specific command`;

    case 'abort':
      return `/abort - Abort current operation

Cancels any running operation. Only useful when an operation is in progress.

Usage: /abort`;

    default:
      return `Unknown command: ${command}\n\nType /help to see available commands.`;
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
            .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
            .map((b) => b.text)
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

// Re-export public API from message-builder
export { buildProviderMessagesFromDurableEvents } from './events/message-builder';

function estimateProviderTokens(messages: ProviderMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += estimateTokens(message.content);
    } else {
      // Count tokens for text blocks only (images don't count as text tokens)
      const textContent = message.content
        .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      total += estimateTokens(textContent);
    }
    if ((message as any).toolCalls)
      total += estimateTokens(JSON.stringify((message as any).toolCalls));
    if ((message as any).toolResults)
      total += estimateTokens(JSON.stringify((message as any).toolResults));
  }
  return total;
}

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
  let runPromptInternal: ((content: unknown[]) => Promise<void>) | null = null;

  /**
   * Queue a job notification for delivery to the agent.
   * If the agent is idle (no active turn) and runPromptInternal is available,
   * triggers an internal turn to process the notification immediately.
   */
  const queueJobNotification = (
    job: JobState,
    type: JobNotificationType,
    options?: { reason?: string; deltaBytes?: number }
  ) => {
    const outputBytes = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
    const durationMs = Date.now() - new Date(job.startedAt).getTime();
    // For completed jobs show just the last line, for others show last 3
    const lastLines = getLastLines(job.outputPath, type === 'completed' ? 1 : 3);

    const content = formatJobNotification({
      jobId: job.jobId,
      type,
      exitCode: job.exitCode,
      durationMs,
      outputBytes,
      deltaBytes: options?.deltaBytes,
      lastLines,
      reason: options?.reason,
    });

    state.jobNotificationQueue.push({
      jobId: job.jobId,
      type,
      content,
      createdAt: Date.now(),
    });

    // If agent is idle (no active turn), trigger an internal turn to process notifications
    if (!state.activeTurn && state.activeSession && runPromptInternal) {
      // Use setImmediate to avoid blocking the current execution and allow any
      // in-flight state updates to complete before starting the turn
      setImmediate(() => {
        // Re-check conditions since state may have changed
        if (!state.activeTurn && state.activeSession && state.jobNotificationQueue.length > 0) {
          void runPromptInternal!([]);
        }
      });
    }
  };

  /**
   * Set up a progress timer for a background job.
   * If progressIntervalMs is specified on the job, or if using the default for background jobs,
   * create a timer that queues progress notifications at the specified interval.
   */
  const setupProgressTimer = (job: JobState) => {
    // Use provided interval or default for background jobs
    const progressInterval = job.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;

    job.lastProgressAt = Date.now();
    job.lastProgressBytes = 0;

    job.progressTimer = setInterval(() => {
      // Stop timer if job is no longer running
      if (job.status !== 'running') {
        if (job.progressTimer) {
          clearInterval(job.progressTimer);
          job.progressTimer = undefined;
        }
        return;
      }

      const currentBytes = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
      const deltaBytes = currentBytes - (job.lastProgressBytes ?? 0);

      queueJobNotification(job, 'progress', { deltaBytes });

      job.lastProgressAt = Date.now();
      job.lastProgressBytes = currentBytes;
    }, progressInterval);
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
    job.subagentSessionId = undefined;
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

    // Clear progress timer if running
    if (job.progressTimer) {
      clearInterval(job.progressTimer);
      job.progressTimer = undefined;
    }

    // Queue completion notification for the agent
    const notificationType: JobNotificationType =
      job.status === 'completed'
        ? 'completed'
        : job.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    queueJobNotification(job, notificationType);

    job.resolveCompletion();
  };

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
    // Helper to write error output directly to the job output file.
    // This is used for error reporting and doesn't depend on state.activeSession.
    const writeErrorToJobOutput = (errorText: string) => {
      try {
        // Ensure the job-logs directory exists
        const logDir = join(dirname(job.outputPath), '.');
        if (!existsSync(dirname(job.outputPath))) {
          mkdirSync(dirname(job.outputPath), { recursive: true, mode: 0o700 });
        }
        appendFileSync(job.outputPath, errorText, { encoding: 'utf8' });
      } catch (writeErr) {
        logger.error('job.subagent.write_error_failed', {
          jobId: job.jobId,
          error: writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
      }
    };

    void (async () => {
      if (!state.activeSession) {
        job.status = 'failed';
        writeErrorToJobOutput('[SUBAGENT ERROR]\nMessage: No active session\n');
        await finalizeJob(job);
        return;
      }
      if (job.proc || job.finished) return;
      if (!job.subagentContent || !Array.isArray(job.subagentContent)) {
        job.status = 'failed';
        writeErrorToJobOutput('[SUBAGENT ERROR]\nMessage: Missing subagentContent\n');
        await finalizeJob(job);
        return;
      }

      // Buffer for collecting stderr output
      let stderrBuffer = '';
      let childProc: ReturnType<typeof spawn> | undefined;
      let childTransport: ReturnType<typeof createNdjsonStdioTransport> | undefined;
      let childPeer: JsonRpcPeer | undefined;

      try {
        childProc = spawn(process.execPath, [process.argv[1] ?? ''], {
          cwd: process.cwd(),
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        job.proc = childProc;

        // Handle spawn errors (e.g., executable not found)
        childProc.on('error', (err) => {
          stderrBuffer += `[SPAWN ERROR] ${err.message}\n`;
        });

        // Capture stderr from child process for debugging
        childProc.stderr?.on('data', (chunk: Buffer) => {
          stderrBuffer += chunk.toString('utf8');
        });

        // Log if child process exits with error
        childProc.on('exit', (code, signal) => {
          if (code !== 0 && code !== null) {
            logger.debug('job.subagent.child_exit', {
              jobId: job.jobId,
              exitCode: code,
              signal,
              stderrLength: stderrBuffer.length,
            });
          }
        });

        // With stdio: ['pipe', 'pipe', 'pipe'], stdout and stdin are guaranteed non-null
        if (!childProc.stdout || !childProc.stdin) {
          throw new Error('Failed to create stdio pipes for child process');
        }

        childTransport = createNdjsonStdioTransport({
          readable: childProc.stdout,
          writable: childProc.stdin,
        });
        job.childTransportClose = childTransport.close;

        childPeer = new JsonRpcPeer(childTransport, { idPrefix: 'c_' });
        job.childPeer = childPeer;
      } catch (setupError) {
        // Error during spawn/transport/peer setup
        job.status = 'failed';
        const errorMessage = setupError instanceof Error ? setupError.message : String(setupError);
        const errorStack = setupError instanceof Error ? setupError.stack : undefined;
        const errorDetails = [
          '[SUBAGENT ERROR]',
          `Message: Setup failed - ${errorMessage}`,
          ...(stderrBuffer.trim() ? [`Stderr: ${stderrBuffer.trim()}`] : []),
          ...(errorStack ? [`Stack: ${errorStack}`] : []),
        ].join('\n');
        writeErrorToJobOutput(errorDetails);
        logger.error('job.subagent.setup_failed', {
          jobId: job.jobId,
          error: errorMessage,
          stderr: stderrBuffer.trim() || undefined,
        });
        await finalizeJob(job);
        return;
      }

      const appendJobOutput = async (text: string) => {
        if (!state.activeSession) return;
        await runExclusive(() => {
          // Check output size limit
          const currentSize = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
          if (currentSize >= MAX_JOB_OUTPUT_BYTES) return; // Already at limit
          const remaining = MAX_JOB_OUTPUT_BYTES - currentSize;
          const toWrite = text.length <= remaining ? text : text.slice(0, remaining);
          appendFileSync(job.outputPath, toWrite, { encoding: 'utf8' });
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
          const jobType = p.jobType === 'delegate' ? 'delegate' : 'bash';
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
            type: p.jobType === 'delegate' ? 'delegate' : 'bash',
          });
          record.status = outcome;
          record.finished = true;
          record.proc = undefined;
          record.childPeer = undefined;
          record.subagentSessionId = undefined;
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
            type: p.jobType === 'delegate' ? 'delegate' : 'bash',
          });

          const channel = p.channel === 'stdout' || p.channel === 'stderr' ? p.channel : 'internal';
          // Child job update - forwarded as-is with namespaced IDs
          // Runtime checks ensure shape is valid before forwarding
          const update = p.update as Record<string, unknown>;

          if (update.type === 'text_delta' && typeof update.text === 'string') {
            const text = update.text;
            await runExclusive(() => {
              // Check output size limit
              const currentSize = existsSync(record.outputPath)
                ? statSync(record.outputPath).size
                : 0;
              if (currentSize >= MAX_JOB_OUTPUT_BYTES) return; // Already at limit
              const remaining = MAX_JOB_OUTPUT_BYTES - currentSize;
              const toWrite = text.length <= remaining ? text : text.slice(0, remaining);
              appendFileSync(record.outputPath, toWrite, { encoding: 'utf8' });
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
            // Forwarded update from child job - trusted after runtime checks above
            update: update as JobInnerUpdate,
          });

          return undefined;
        }

        if (type === 'text_delta' && typeof p.text === 'string') {
          await appendJobOutput(p.text);
          await emitSessionUpdate({
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'delegate',
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
            jobType: 'delegate',
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
            jobType: 'delegate',
            channel: 'internal',
            // Forwarded context_injected from child job
            update: p as JobInnerUpdate,
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

        const decision = await _requestPermissionFromClient({
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

        // Resume existing session or create a new one
        if (job.subagentSessionId) {
          // Resume: load the existing session
          await childPeer.request('session/load', {
            sessionId: job.subagentSessionId,
          });
        } else {
          // New session
          const created = (await childPeer.request('session/new', {
            workDir: state.activeSession.meta.workDir,
          })) as { sessionId: string };
          job.subagentSessionId = created.sessionId;

          // Persist subagentSessionId for resume functionality
          await runExclusive(() => {
            let sessionState = readSessionState(state.activeSession!.dir);
            const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
              type: 'job_session_assigned',
              data: {
                jobId: job.jobId,
                subagentSessionId: created.sessionId,
              },
            });
            sessionState = nextState;
            writeSessionState(state.activeSession!.dir, sessionState);
            state.activeSession = loadSession(state.activeSession!.meta.sessionId);
          });
        }

        // Configure subagent session with provider/model if specified
        if (job.connectionId || job.modelId) {
          await childPeer.request('ent/session/configure', {
            ...(job.connectionId ? { connectionId: job.connectionId } : {}),
            ...(job.modelId ? { modelId: job.modelId } : {}),
          });
        }

        await childPeer.request('session/prompt', { content: job.subagentContent });

        if (job.status !== 'cancelled') job.status = 'completed';
      } catch (error) {
        if (job.status !== 'cancelled') job.status = 'failed';

        // Extract detailed error information
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode =
          error && typeof error === 'object' && 'code' in error ? (error as any).code : undefined;
        const errorData =
          error && typeof error === 'object' && 'data' in error ? (error as any).data : undefined;

        // Build detailed error output
        const errorDetails = [
          `\n[SUBAGENT ERROR]`,
          `Message: ${errorMessage}`,
          ...(errorCode !== undefined ? [`Code: ${errorCode}`] : []),
          ...(errorData ? [`Data: ${JSON.stringify(errorData)}`] : []),
          ...(stderrBuffer.trim() ? [`Stderr: ${stderrBuffer.trim()}`] : []),
          ...(error instanceof Error && error.stack ? [`Stack: ${error.stack}`] : []),
        ].join('\n');

        // Write error details to job output file so they're visible via ent/job/output
        // Use writeErrorToJobOutput as fallback if appendJobOutput fails (e.g., no active session)
        try {
          await appendJobOutput(errorDetails);
        } catch {
          writeErrorToJobOutput(errorDetails);
        }
        // Always also write via direct method in case appendJobOutput silently returned
        if (!state.activeSession) {
          writeErrorToJobOutput(errorDetails);
        }

        logger.error('job.subagent.failed', {
          jobId: job.jobId,
          error: errorMessage,
          code: errorCode,
          data: errorData,
          stderr: stderrBuffer.trim() || undefined,
        });
      } finally {
        try {
          childPeer?.close();
        } catch (error) {
          logger.debug('job.subagent.close_peer.failed', {
            jobId: job.jobId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        try {
          job.childTransportClose?.();
        } catch (error) {
          logger.debug('job.subagent.close_transport.failed', {
            jobId: job.jobId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (childProc && childProc.exitCode === null) {
          childProc.kill('SIGTERM');

          // Wait up to 2 seconds for graceful exit
          const exitPromise = new Promise<void>((resolve) =>
            childProc!.once('exit', () => resolve())
          );
          const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 2_000));

          await Promise.race([exitPromise, timeoutPromise]);

          // Force kill if still running
          if (childProc.exitCode === null) {
            try {
              childProc.kill('SIGKILL');
            } catch (error) {
              // Process may have exited between check and kill
              logger.debug('job.subagent.sigkill.failed', {
                jobId: job.jobId,
                error: error instanceof Error ? error.message : String(error),
              });
            }

            // Final wait with shorter timeout
            await Promise.race([
              new Promise<void>((resolve) => childProc!.once('exit', () => resolve())),
              new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
            ]);
          }
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
    if (config?.environment && typeof config.environment === 'object') {
      const envObj: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.environment)) {
        if (typeof v === 'string') envObj[k] = v;
      }
      state.config.environment = Object.keys(envObj).length > 0 ? envObj : undefined;
    }

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
        session: { fork: {}, resume: {} },
        tools: toolInfos,
        operations: { checkpoint: true, rewind: true, configure: true, compact: true },
        'ent/contextInjection': true,
        'ent/backgroundJobs': true,
        'ent/fileCheckpointing': true,
        'ent/structuredOutput': false,
        'ent/providers': {
          list: true,
          connections: true,
          models: true,
          catalogRefresh: true,
          modelGating: true,
        },
        slashCommands: [
          { name: 'compact', description: 'Summarize and compress context', source: 'builtin' },
          { name: 'clear', description: 'Clear conversation, start fresh', source: 'builtin' },
          {
            name: 'mode',
            description: 'Switch approval mode (ask|approveReads|approveEdits|approve|deny)',
            source: 'builtin',
          },
          { name: 'abort', description: 'Abort current operation', source: 'builtin' },
          { name: 'help', description: 'Show available commands', source: 'builtin' },
          // Include user commands from ~/.lace/commands/ (global only at init time)
          ...getUserSlashCommands(),
        ],
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
      : { messageCount: 0, turnCount: 0, lastActive: undefined };

    // Get session cost and token usage from persisted state
    const sessionCostUsd = state.activeSession?.state.sessionCostUsd ?? 0;
    const tokenUsage = state.activeSession?.state.tokenUsage ?? {
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
    const tokensUsed = tokenUsage.totalInputTokens + tokenUsage.totalOutputTokens;

    const pendingPermissions: PermissionRequest[] = [];
    if (state.activeSession) {
      const sessionId = state.activeSession.meta.sessionId;
      const pendingRecords = derivePendingPermissionsFromDurableEvents(state.activeSession.dir);
      if (pendingRecords.some((p) => !state.pendingPermissionRequests.has(p.toolCallId))) {
        await _reissuePendingPermissionRequests();
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
            turnCount: sessionSummary.turnCount,
            tokensUsed,
            costUsd: sessionCostUsd,
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
        budgetUsedUsd: sessionCostUsd,
      },
    };
  });

  const ensureProviderCatalogLoaded = async () => {
    if (state.providerCatalogLoaded) return;
    try {
      await state.providerCatalog.loadCatalogs();
      if (state.providerCatalog.getAvailableProviders().length === 0) {
        throw new Error('provider catalog empty after load');
      }
      state.providerCatalogLoaded = true;
    } catch (error) {
      logger.error('catalog.load.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      state.providerCatalogLoaded = false;
      throw {
        code: EntErrorCodes.ProviderError,
        message: 'Provider catalog unavailable',
        data: { category: 'provider', reason: 'CatalogLoadFailed' },
      };
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
        supportsCatalogRefresh: true,
      }));

    return { providers };
  });

  peer.onRequest('ent/providers/catalog', async (_params: unknown) => {
    assertInitialized(state);

    const registry = ProviderRegistry.getInstance();
    const providers = await registry.getCatalogProviders();
    return { providers };
  });

  peer.onRequest('ent/providers/refresh', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { providerId?: string } | undefined;
    const providerId = parsed?.providerId;

    await state.providerCatalog.loadCatalogs();
    state.providerCatalogLoaded = true;

    if (providerId) {
      const provider = state.providerCatalog.getProvider(providerId);
      if (!provider) {
        return {
          ok: false,
          refreshedAt: new Date().toISOString(),
          error: `Unknown providerId: ${providerId}`,
        };
      }
    }

    return { ok: true, refreshedAt: new Date().toISOString() };
  });

  peer.onRequest('ent/connections/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { providerId?: string } | undefined;
    const providerIdFilter = typeof parsed?.providerId === 'string' ? parsed.providerId : undefined;

    const instances = await state.providerInstances.loadInstances();
    await ensureProviderCatalogLoaded();
    const knownProviders = new Set(state.providerCatalog.getAvailableProviders().map((p) => p.id));

    const connections = Object.entries(instances.instances)
      .filter(([_id, inst]) =>
        providerIdFilter ? inst.catalogProviderId === providerIdFilter : true
      )
      .filter(([_id, inst]) => {
        const ok = knownProviders.has(inst.catalogProviderId);
        if (!ok) {
          logger.warn('connections.list.skipping_unknown_provider', {
            connectionId: _id,
            providerId: inst.catalogProviderId,
          });
        }
        return ok;
      })
      .map(([connectionId, inst]) => {
        const credential = state.providerInstances.loadCredential(connectionId);
        const credentialState = credential?.apiKey ? 'ready' : 'missing';
        return {
          connectionId,
          providerId: inst.catalogProviderId,
          name: inst.displayName,
          ...(inst.endpoint ? { endpoint: inst.endpoint } : {}),
          ...(inst.timeout !== undefined ? { timeout: inst.timeout } : {}),
          ...(inst.retryPolicy ? { retryPolicy: inst.retryPolicy } : {}),
          ...(inst.modelConfig ? { modelConfig: inst.modelConfig } : {}),
          hasCredentials: !!credential?.apiKey,
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
    let provider = state.providerCatalog.getProvider(providerId);
    if (!provider) throwInvalidParams(`Unknown providerId: ${providerId}`);

    // Prefer per-connection dynamic catalogs when available (e.g. OpenAI, OpenRouter).
    const registry = ProviderRegistry.getInstance();
    const instanceCatalog = await registry.getCatalogForInstance(connectionId);
    if (instanceCatalog) provider = instanceCatalog;

    const gating = state.providerCatalog.getModelGating(providerId);
    const enabledSet =
      gating.enabled && gating.enabled.length > 0 ? new Set(gating.enabled) : undefined;
    const disabledSet = new Set(gating.disabled ?? []);

    const models = provider.models.map((m) => {
      const info = mapCatalogModelToModelInfo(m, providerId) as any;
      const isDisabled =
        (enabledSet && !enabledSet.has(m.id)) || (disabledSet.size > 0 && disabledSet.has(m.id));
      info.disabled = isDisabled;
      info.disabledState = isDisabled ? 'disabled' : 'enabled';
      return info;
    });

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

    // Prefer per-connection dynamic refresh when available.
    const registry = ProviderRegistry.getInstance();
    const refreshed = await registry.getCatalogForInstance(connectionId, true);
    if (refreshed) {
      return {
        connectionId,
        refreshedAt: new Date().toISOString(),
        ok: true,
      };
    }

    // Refresh the model catalog (currently a no-op for static catalogs)
    return {
      connectionId,
      refreshedAt: new Date().toISOString(),
      ok: true,
    };
  });

  const updateModelGating = async (
    providerId: string,
    modelIds: string[],
    action: 'enable' | 'disable'
  ) => {
    await ensureProviderCatalogLoaded();
    const provider = state.providerCatalog.getProvider(providerId);
    if (!provider) throwInvalidParams(`Unknown providerId: ${providerId}`);

    const providerModels = new Set(provider.models.map((m) => m.id));
    for (const id of modelIds) {
      if (!providerModels.has(id)) throwInvalidParams(`Unknown modelId for provider: ${id}`);
    }

    const gating = state.providerCatalog.getModelGating(providerId);
    const enabled = new Set(gating.enabled ?? []);
    const disabled = new Set(gating.disabled ?? []);

    if (action === 'enable') {
      for (const id of modelIds) {
        enabled.add(id);
        disabled.delete(id);
      }
    } else {
      for (const id of modelIds) {
        disabled.add(id);
        enabled.delete(id);
      }
    }

    const enabledArr = Array.from(enabled).sort();
    const disabledArr = Array.from(disabled).sort();
    await state.providerCatalog.setModelGating(providerId, {
      enabled: enabledArr,
      disabled: disabledArr,
    });

    return { providerId, enabled: enabledArr, disabled: disabledArr };
  };

  peer.onRequest('ent/models/enable', async (params: unknown) => {
    assertInitialized(state);
    const parsed = params as { providerId?: string; modelIds?: unknown };
    const providerId = toNonEmptyString(parsed.providerId);
    if (!providerId) throwInvalidParams('providerId is required');
    if (!Array.isArray(parsed.modelIds) || parsed.modelIds.length === 0)
      throwInvalidParams('modelIds must be a non-empty array of strings');
    const modelIds: string[] = [];
    for (const id of parsed.modelIds) {
      const v = toNonEmptyString(id);
      if (!v) throwInvalidParams('modelIds must be strings');
      modelIds.push(v);
    }

    return await updateModelGating(providerId, modelIds, 'enable');
  });

  peer.onRequest('ent/models/disable', async (params: unknown) => {
    assertInitialized(state);
    const parsed = params as { providerId?: string; modelIds?: unknown };
    const providerId = toNonEmptyString(parsed.providerId);
    if (!providerId) throwInvalidParams('providerId is required');
    if (!Array.isArray(parsed.modelIds) || parsed.modelIds.length === 0)
      throwInvalidParams('modelIds must be a non-empty array of strings');
    const modelIds: string[] = [];
    for (const id of parsed.modelIds) {
      const v = toNonEmptyString(id);
      if (!v) throwInvalidParams('modelIds must be strings');
      modelIds.push(v);
    }

    return await updateModelGating(providerId, modelIds, 'disable');
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
          } catch (error) {
            logger.debug('mcp.listTools.failed', {
              serverId,
              error: error instanceof Error ? error.message : String(error),
            });
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
      ...(j.subagentSessionId ? { subagentSessionId: j.subagentSessionId } : {}),
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
      const proc = job.proc;
      try {
        // Kill the entire process group on POSIX so we don't leak child processes (e.g. `sleep`)
        // that can keep the shell alive and prevent job completion/finalization.
        if (process.platform !== 'win32' && typeof proc.pid === 'number') {
          process.kill(-proc.pid, 'SIGTERM');
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        return { success: false };
      }

      // Best-effort: wait briefly for graceful shutdown; if still running, escalate.
      await Promise.race([
        job.completion,
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
      if (!job.finished) {
        try {
          if (process.platform !== 'win32' && typeof proc.pid === 'number') {
            process.kill(-proc.pid, 'SIGKILL');
          } else {
            proc.kill('SIGKILL');
          }
        } catch (error) {
          // SIGTERM was already sent; process may have exited
          logger.debug('job.kill.sigkill.failed', {
            jobId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        await Promise.race([
          job.completion,
          new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
        ]);
      }

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
    if (!job || job.type !== 'delegate' || job.finished) return undefined;
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
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    // Kill all running jobs before switching sessions
    for (const job of state.jobs.values()) {
      if (job.status === 'running') {
        job.status = 'cancelled';
        if (job.proc) {
          try {
            if (process.platform !== 'win32' && typeof job.proc.pid === 'number') {
              process.kill(-job.proc.pid, 'SIGTERM');
            } else {
              job.proc.kill('SIGTERM');
            }
          } catch (error) {
            logger.debug('session.new.job_kill.failed', {
              jobId: job.jobId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        job.permissionAbortController?.abort();
      }
    }

    // Wait briefly for processes to terminate
    await Promise.all(
      [...state.jobs.values()]
        .filter((job) => job.proc && job.proc.exitCode === null)
        .map((job) =>
          Promise.race([job.completion, new Promise<void>((resolve) => setTimeout(resolve, 500))])
        )
    );

    state.pendingPermissionRequests.clear();
    state.jobs.clear();

    const parsed = params as { workDir: string; persona?: string; systemPrompt?: unknown };
    if (!parsed?.workDir) throwInvalidParams('workDir is required');

    const sessionId = `sess_${randomUUID()}`;
    const created = new Date().toISOString();

    let sessionDir: string;
    try {
      sessionDir = getSessionDir(sessionId);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('session.new.storage_unavailable', {
        error: message,
        ...((err as any)?.path ? { path: (err as any).path } : {}),
      });
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionStorageUnavailable',
        data: { category: 'session', reason: 'SessionStorageUnavailable', detail: message },
      };
    }

    state.activeSession = loadSession(sessionId);
    await reconcileMcpServersForActiveSession(state);

    // Inject system prompt as context_injected event
    const persona = toNonEmptyString(parsed.persona) ?? 'lace';

    // Get available tools for system prompt context
    const { toolsForProvider } = createToolExecutorForMode(
      state.config.executionMode,
      state.mcpServerManager
    );
    const tools = toolsForProvider.map((t) => ({ name: t.name, description: t.description }));

    // Create session context for working directory
    const sessionContext = { getWorkingDirectory: () => parsed.workDir };

    const promptConfig = await loadPromptConfig({ persona, tools, session: sessionContext });
    let sessionState: SessionState = readSessionState(sessionDir);
    const { nextState } = appendDurableEvent(sessionDir, sessionState, {
      type: 'context_injected',
      data: { content: [{ type: 'text', text: promptConfig.systemPrompt }], priority: 'normal' },
    });
    sessionState = nextState;
    writeSessionState(sessionDir, sessionState);

    // Also inject user instructions if present
    if (promptConfig.userInstructions.trim()) {
      const { nextState: userInstrState } = appendDurableEvent(sessionDir, sessionState, {
        type: 'context_injected',
        data: {
          content: [{ type: 'text', text: promptConfig.userInstructions }],
          priority: 'normal',
        },
      });
      sessionState = userInstrState;
      writeSessionState(sessionDir, sessionState);
    }

    state.activeSession = { ...state.activeSession, state: sessionState };

    return { sessionId, created };
  });

  // ACP-aligned: cwd instead of workDir
  peer.onRequest('session/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { cwd?: string; cursor?: string } | undefined;
    const cwdFilter = parsed?.cwd;
    // Note: cursor/pagination not yet implemented

    return { sessions: listSessions(cwdFilter) };
  });

  peer.onRequest('session/load', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { sessionId: string };
    if (!parsed?.sessionId) throwInvalidParams('sessionId is required');
    if (!isSessionId(parsed.sessionId)) {
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
    }

    if (state.activeTurn) {
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };
    }

    const switchingSessions =
      state.activeSession && state.activeSession.meta.sessionId !== parsed.sessionId;
    if (switchingSessions) {
      // Kill all running jobs before switching sessions
      for (const job of state.jobs.values()) {
        if (job.status === 'running') {
          job.status = 'cancelled';
          if (job.proc) {
            try {
              if (process.platform !== 'win32' && typeof job.proc.pid === 'number') {
                process.kill(-job.proc.pid, 'SIGTERM');
              } else {
                job.proc.kill('SIGTERM');
              }
            } catch (error) {
              logger.debug('session.load.job_kill.failed', {
                jobId: job.jobId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          job.permissionAbortController?.abort();
        }
      }

      // Wait briefly for processes to terminate
      await Promise.all(
        [...state.jobs.values()]
          .filter((job) => job.proc && job.proc.exitCode === null)
          .map((job) =>
            Promise.race([job.completion, new Promise<void>((resolve) => setTimeout(resolve, 500))])
          )
      );

      state.pendingPermissionRequests.clear();
      state.jobs.clear();
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
    await _reissuePendingPermissionRequests();
    const summary = summarizeDurableEvents(loaded.dir);
    // ACP-aligned: lastActive renamed to updatedAt
    return {
      sessionId: parsed.sessionId,
      messageCount: summary.messageCount,
      updatedAt: summary.lastActive ?? loaded.meta.created,
    };
  });

  peer.onRequest('session/fork', async (params: unknown) => {
    assertInitialized(state);

    const parsed = SessionForkParamsSchema.parse(params);

    // Load the source session
    let sourceSession: LoadedSession;
    try {
      sourceSession = loadSession(parsed.sessionId);
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

    // Create new forked session
    const forkedSessionId = `sess_${randomUUID()}`;
    const created = new Date().toISOString();
    const forkedCwd = parsed.cwd ?? sourceSession.meta.workDir;

    const forkedSessionDir = getSessionDir(forkedSessionId);
    writeSessionMeta(forkedSessionDir, { sessionId: forkedSessionId, workDir: forkedCwd, created });

    // Copy state from source session with optional MCP server overrides
    const forkedState: SessionState = {
      nextEventSeq: sourceSession.state.nextEventSeq,
      nextStreamSeq: sourceSession.state.nextStreamSeq,
      config: {
        ...sourceSession.state.config,
      },
    };

    // Apply MCP server overrides if provided
    if (parsed.mcpServers) {
      forkedState.config = forkedState.config ?? {};
      forkedState.config.mcpServers = parsed.mcpServers;
    }

    writeSessionState(forkedSessionDir, forkedState);
    ensureSessionFiles(forkedSessionDir);

    // Copy all events from source session to forked session
    const { events: sourceEvents } = readDurableEvents(sourceSession.dir, {});
    const forkedEventsPath = join(forkedSessionDir, 'events.jsonl');
    for (const event of sourceEvents) {
      appendFileSync(forkedEventsPath, JSON.stringify(event) + '\n', { encoding: 'utf8' });
    }

    // Return fork result with forkedFrom field
    const summary = summarizeDurableEvents(forkedSessionDir);
    return {
      sessionId: forkedSessionId,
      forkedFrom: parsed.sessionId,
      messageCount: summary.messageCount,
      updatedAt: summary.lastActive ?? created,
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
      environment: Record<string, string>;
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

    if (parsed.approvalMode !== undefined) {
      const allowed = new Set([
        'ask',
        'approveReads',
        'approveEdits',
        'approve',
        'deny',
        'dangerouslySkipPermissions',
      ]);
      if (!allowed.has(parsed.approvalMode)) {
        throwInvalidParams(
          'approvalMode must be one of ask|approveReads|approveEdits|approve|deny|dangerouslySkipPermissions'
        );
      }
      if (parsed.approvalMode !== effectiveBefore.approvalMode) {
        nextConfig.approvalMode = parsed.approvalMode;
        applied.push('approvalMode');
      }
    }

    if (parsed.environment !== undefined) {
      if (
        !parsed.environment ||
        typeof parsed.environment !== 'object' ||
        Array.isArray(parsed.environment)
      ) {
        throwInvalidParams('environment must be an object of string:string');
      }
      const envObj: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.environment as Record<string, unknown>)) {
        if (typeof v !== 'string') throwInvalidParams('environment values must be strings');
        envObj[k] = v;
      }

      const currentEnv =
        (currentConfig as { environment?: Record<string, string> })?.environment || undefined;
      if (!recordsShallowEqual(envObj, currentEnv)) {
        nextConfig.environment = envObj;
        applied.push('environment');
      }
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
        environment: (state.activeSession.state.config as any)?.environment,
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

    if (
      parsed?.strategy &&
      parsed.strategy !== 'summarize' &&
      parsed.strategy !== 'truncate' &&
      parsed.strategy !== 'selective'
    ) {
      throwInvalidParams('strategy must be summarize|truncate|selective');
    }

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

  peer.onRequest('ent/session/token_usage', async (_params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const { tokenUsage } = await computeContextBreakdownForActiveSession(state);
    return tokenUsage;
  });

  peer.onRequest('ent/session/context_breakdown', async (_params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const { breakdown } = await computeContextBreakdownForActiveSession(state);
    return breakdown;
  });

  peer.onRequest('$/cancel_request', async (params: unknown) => {
    assertInitialized(state);

    // Auto-cascade: send $/cancel_request for all pending permission requests
    for (const [, permission] of state.pendingPermissionRequests) {
      peer.notify('$/cancel_request', { requestId: permission.rpcId });
    }

    // Abort the active turn if one is running
    if (state.activeTurn) {
      state.activeTurn.abortController.abort();
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

  // Core prompt handling logic, extracted to allow internal triggering of turns
  // for notification processing when the agent is idle.
  const handlePrompt = async (params: { content: unknown[]; outputFormat?: unknown }) => {
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

    const parsed = params;
    const turnId = `turn_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    state.activeTurn = { turnId, startedAt, status: 'running', abortController };

    try {
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

      // Inject any pending job notifications before the user's prompt
      let promptContent = parsed.content as unknown[];
      if (state.jobNotificationQueue.length > 0) {
        const notifications = state.jobNotificationQueue.splice(0);
        const notificationBlocks = notifications.map((n) => ({
          type: 'text' as const,
          text: n.content,
        }));
        promptContent = [...notificationBlocks, ...promptContent];
      }

      await writeAndAdvance({ type: 'prompt', data: { content: promptContent } });
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

      // Handle slash commands (e.g., /compact, /mode approve, /help)
      let effectivePromptText = promptText;
      const slashMatch = promptText.match(/^\/(\w+)(?:\s+(.*))?$/);
      if (slashMatch) {
        const slashCmd = slashMatch[1];
        const slashArgs = slashMatch[2]?.trim() ?? '';
        const workDir = state.activeSession.meta.workDir;

        // First check built-in commands
        const slashResult = await handleSlashCommand(
          state,
          slashCmd,
          slashArgs,
          turnId,
          writeAndAdvance,
          emitUpdate
        );
        if (slashResult) {
          // Slash command was handled, return result
          state.activeTurn = null;
          return slashResult;
        }

        // Check for user-defined command
        const userCmd = findUserCommand(slashCmd, workDir);
        if (userCmd) {
          // Expand user command: body + args
          effectivePromptText = slashArgs ? `${userCmd.body}\n\n${slashArgs}` : userCmd.body;

          // If the user command specifies a mode, apply it for this turn
          if (userCmd.mode) {
            const currentState = readSessionState(state.activeSession.dir);
            const nextConfig = {
              ...currentState.config,
              approvalMode: userCmd.mode,
            };
            const nextState = { ...currentState, config: nextConfig };
            writeSessionState(state.activeSession.dir, nextState);
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
          }

          // Update the parsed content for the rest of the flow
          (parsed.content as any[]) = [{ type: 'text', text: effectivePromptText }];
        }
        // If neither built-in nor user command, fall through to normal processing with original prompt
      }

      const runMatch = effectivePromptText.match(/^\s*run:\s*(.+)\s*$/m);
      const command = runMatch?.[1]?.trim();

      const jobMatch = effectivePromptText.match(/^\s*job:\s*(.+)\s*$/m);
      const jobCommand = jobMatch?.[1]?.trim();

      // Supports: "subagent: prompt" or "subagent config=connId,modelId: prompt"
      const subagentMatch = effectivePromptText.match(
        /^\s*subagent(?:\s+config=([^,\s]+)?,([^\s:]+)?)?\s*:\s*(.+)\s*$/m
      );
      const subagentConnectionId = subagentMatch?.[1]?.trim() || undefined;
      const subagentModelId = subagentMatch?.[2]?.trim() || undefined;
      const subagentText = subagentMatch?.[3]?.trim();

      const workDir = state.activeSession.meta.workDir;
      const filesRead = deriveFilesReadFromDurableEvents(state.activeSession.dir, workDir);

      if (parsed.outputFormat !== undefined) {
        const of = parsed.outputFormat as any;
        if (
          !of ||
          typeof of !== 'object' ||
          of.type !== 'json_schema' ||
          typeof of.schema !== 'object' ||
          of.schema === null
        ) {
          throwInvalidParams('outputFormat must be { type: "json_schema", schema: object }');
        }
      }

      if (!command && !jobCommand && !subagentText) {
        const maxTurns =
          typeof (params as any)?.maxTurns === 'number' && Number.isFinite((params as any).maxTurns)
            ? Math.max(1, Math.trunc((params as any).maxTurns))
            : 10;

        const envOverlay =
          effectiveConfig.environment && typeof effectiveConfig.environment === 'object'
            ? (effectiveConfig.environment as Record<string, string>)
            : undefined;

        const { executor: toolExecutor, toolsForProvider } = createToolExecutorForMode(
          effectiveConfig.executionMode,
          state.mcpServerManager
        );

        const provider = await createProviderForTurn({
          connectionId: effectiveConfig.connectionId,
          modelId: effectiveConfig.modelId,
        });

        // Get model pricing for cost calculation
        const modelPricing = await getModelPricing(
          state,
          effectiveConfig.connectionId,
          effectiveConfig.modelId
        );

        // Track token usage across the turn
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        // Load existing session cost (for accumulation)
        const currentSessionState = readSessionState(state.activeSession.dir);
        let sessionCostUsd = currentSessionState.sessionCostUsd ?? 0;

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
            let tokenQueue: Promise<void> = Promise.resolve();

            const onToken = (payload: { token?: string }) => {
              if (abortController.signal.aborted) return;
              if (!payload?.token) return;
              streamedAny = true;
              const token = payload.token;
              tokenQueue = tokenQueue
                .then(async () => {
                  if (abortController.signal.aborted) return;
                  await emitUpdate(messageTurnSeq, { type: 'text_delta', text: token });
                })
                .catch(() => undefined);
            };

            provider.on('token', onToken);
            const response = await provider.createStreamingResponse(
              providerMessages,
              toolsForProvider,
              effectiveConfig.modelId || 'unknown-model',
              abortController.signal
            );
            provider.off('token', onToken);
            await tokenQueue;

            if (abortController.signal.aborted) {
              stopReason = 'cancelled';
              break;
            }

            // Track token usage from this response
            if (response.usage) {
              totalInputTokens += response.usage.promptTokens ?? 0;
              totalOutputTokens += response.usage.completionTokens ?? 0;

              // Calculate cost for this response if pricing is available
              if (modelPricing) {
                const inputCost =
                  ((response.usage.promptTokens ?? 0) / 1_000_000) * modelPricing.costPer1mIn;
                const outputCost =
                  ((response.usage.completionTokens ?? 0) / 1_000_000) * modelPricing.costPer1mOut;
                sessionCostUsd += inputCost + outputCost;
              }
            }

            // Check budget before continuing (complete current turn, don't start new one)
            // Budget enforcement only applies if maxBudgetUsd is set and > 0
            if (
              effectiveConfig.maxBudgetUsd &&
              effectiveConfig.maxBudgetUsd > 0 &&
              sessionCostUsd > effectiveConfig.maxBudgetUsd
            ) {
              stopReason = 'budget_exceeded';
              // Don't break immediately - let this turn complete, but don't start more
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

              if (
                effectiveConfig.executionMode === 'plan' &&
                kind !== 'read' &&
                kind !== 'search'
              ) {
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
                  permissionResponse = await _requestPermissionFromClient({
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

              // Handle bash with background=true - spawn background job instead of sync execution
              if (
                toolName === 'bash' &&
                (finalInput as Record<string, unknown>).background === true
              ) {
                const command = toNonEmptyString((finalInput as Record<string, unknown>).command);
                const description = toNonEmptyString(
                  (finalInput as Record<string, unknown>).description
                );
                if (!command) {
                  coreResult = {
                    status: 'failed',
                    content: [{ type: 'text', text: 'bash.command is required' }],
                  };
                } else {
                  const { jobId } = await _startShellJob({
                    command,
                    description: description || command.substring(0, 50),
                    turnContext: { turnId, turnSeq: toolTurnSeq },
                  });

                  coreResult = {
                    status: 'completed',
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({ jobId, status: 'started' }),
                      },
                    ],
                  };
                }
              } else if (toolName === 'delegate') {
                const prompt = toNonEmptyString((finalInput as Record<string, unknown>).prompt);
                const background = (finalInput as Record<string, unknown>).background === true;
                const description = toNonEmptyString(
                  (finalInput as Record<string, unknown>).description
                );
                const resumeJobId = toNonEmptyString(
                  (finalInput as Record<string, unknown>).resume
                );
                const connectionId =
                  toNonEmptyString((finalInput as Record<string, unknown>).connectionId) ??
                  undefined;
                const modelId =
                  toNonEmptyString((finalInput as Record<string, unknown>).modelId) ?? undefined;

                // If resuming, look up the previous job's subagentSessionId
                let resumeSessionId: string | undefined;
                let resumeError: string | undefined;
                if (resumeJobId) {
                  const previousJob = state.jobs.get(resumeJobId);
                  if (!previousJob?.subagentSessionId) {
                    resumeError = `Cannot resume job ${resumeJobId}: no subagentSessionId found`;
                  } else {
                    resumeSessionId = previousJob.subagentSessionId;
                  }
                }

                if (!prompt) {
                  coreResult = {
                    status: 'failed',
                    content: [{ type: 'text', text: 'delegate.prompt is required' }],
                  };
                } else if (resumeError) {
                  coreResult = {
                    status: 'failed',
                    content: [{ type: 'text', text: resumeError }],
                  };
                } else {
                  const { jobId } = await startSubagentJob({
                    prompt,
                    description: description || 'Delegate',
                    turnContext: { turnId, turnSeq: toolTurnSeq },
                    resumeSessionId,
                    connectionId,
                    modelId,
                  });

                  if (background) {
                    // Return immediately without waiting for completion
                    coreResult = {
                      status: 'completed',
                      content: [
                        {
                          type: 'text',
                          text: JSON.stringify({ jobId, status: 'started' }),
                        },
                      ],
                    };
                  } else {
                    // Wait for job completion (existing behavior)
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
                      output = readFileSync(
                        getJobOutputPath(state.activeSession.dir, jobId),
                        'utf8'
                      );
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
                }
              } else if (toolName === 'job_output') {
                // Runtime handling for job_output tool - reuses ent/job/output logic
                const jobId = toNonEmptyString((finalInput as Record<string, unknown>).jobId);
                if (!jobId) {
                  coreResult = {
                    status: 'failed',
                    content: [{ type: 'text', text: 'job_output.jobId is required' }],
                  };
                } else {
                  const block = (finalInput as Record<string, unknown>).block !== false;
                  const timeoutMs =
                    typeof (finalInput as Record<string, unknown>).timeoutMs === 'number'
                      ? ((finalInput as Record<string, unknown>).timeoutMs as number)
                      : 30_000;
                  const byteOffset =
                    typeof (finalInput as Record<string, unknown>).byteOffset === 'number'
                      ? ((finalInput as Record<string, unknown>).byteOffset as number)
                      : 0;

                  // Block until job completion if requested
                  const runningJob = state.jobs.get(jobId);
                  if (block && runningJob?.status === 'running') {
                    await Promise.race([
                      runningJob.completion,
                      timeoutMs > 0
                        ? new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
                        : new Promise<void>(() => {}),
                    ]);
                  }

                  // Look up job from derived list (includes persisted jobs)
                  const jobs = deriveJobsForActiveSession();
                  const record = jobs.find((j) => j.jobId === jobId);

                  if (!record) {
                    coreResult = {
                      status: 'failed',
                      content: [{ type: 'text', text: `Job not found: ${jobId}` }],
                    };
                  } else {
                    const sessionDir = state.activeSession.dir;
                    const outputPath = getJobOutputPath(sessionDir, jobId);

                    let totalBytes = 0;
                    try {
                      totalBytes = statSync(outputPath).size;
                    } catch {
                      totalBytes = 0;
                    }

                    const clampedOffset = Math.min(byteOffset, totalBytes);
                    const bytesToRead = Math.max(0, totalBytes - clampedOffset);

                    let output = '';
                    if (bytesToRead > 0) {
                      const fd = openSync(outputPath, 'r');
                      try {
                        const buf = Buffer.allocUnsafe(bytesToRead);
                        const read = readSync(fd, buf, 0, bytesToRead, clampedOffset);
                        output = buf.subarray(0, read).toString('utf8');
                      } finally {
                        closeSync(fd);
                      }
                    }

                    const result = {
                      jobId,
                      status: record.status,
                      output,
                      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
                      byteOffset: totalBytes,
                    };

                    coreResult = {
                      status: 'completed',
                      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    };
                  }
                }
              } else if (toolName === 'jobs_list') {
                // Runtime handling for jobs_list tool - reuses ent/job/list logic
                const statusFilter = Array.isArray((finalInput as Record<string, unknown>).status)
                  ? ((finalInput as Record<string, unknown>).status as string[])
                  : undefined;
                const typeFilter = Array.isArray((finalInput as Record<string, unknown>).type)
                  ? ((finalInput as Record<string, unknown>).type as string[])
                  : undefined;
                const limit =
                  typeof (finalInput as Record<string, unknown>).limit === 'number'
                    ? ((finalInput as Record<string, unknown>).limit as number)
                    : 50;

                let jobs = deriveJobsForActiveSession().map((j) => ({
                  jobId: j.jobId,
                  parentJobId: j.parentJobId,
                  type: j.type,
                  status: j.status,
                  description: j.description,
                  command: j.command,
                  startTime: j.startTime,
                  ...(j.subagentSessionId ? { subagentSessionId: j.subagentSessionId } : {}),
                }));

                // Apply filters
                if (statusFilter && statusFilter.length > 0) {
                  jobs = jobs.filter((j) => statusFilter.includes(j.status));
                }
                if (typeFilter && typeFilter.length > 0) {
                  jobs = jobs.filter((j) => typeFilter.includes(j.type));
                }

                // Apply limit
                jobs = jobs.slice(0, limit);

                coreResult = {
                  status: 'completed',
                  content: [{ type: 'text', text: JSON.stringify({ jobs }, null, 2) }],
                };
              } else if (toolName === 'job_kill') {
                // Runtime handling for job_kill tool - reuses ent/job/kill logic
                const jobId = toNonEmptyString((finalInput as Record<string, unknown>).jobId);
                if (!jobId) {
                  coreResult = {
                    status: 'failed',
                    content: [{ type: 'text', text: 'job_kill.jobId is required' }],
                  };
                } else {
                  const job = state.jobs.get(jobId);
                  if (!job || job.status !== 'running') {
                    coreResult = {
                      status: 'completed',
                      content: [
                        {
                          type: 'text',
                          text: JSON.stringify({ success: false, reason: 'Job not running' }),
                        },
                      ],
                    };
                  } else {
                    job.status = 'cancelled';

                    let killed = false;
                    if (job.proc) {
                      const proc = job.proc;
                      try {
                        // Kill the entire process group on POSIX so we don't leak child processes
                        if (process.platform !== 'win32' && typeof proc.pid === 'number') {
                          process.kill(-proc.pid, 'SIGTERM');
                        } else {
                          proc.kill('SIGTERM');
                        }
                        killed = true;
                      } catch {
                        killed = false;
                      }
                    } else {
                      // Subagent job - just mark as cancelled (completion promise will resolve)
                      killed = true;
                    }

                    coreResult = {
                      status: 'completed',
                      content: [{ type: 'text', text: JSON.stringify({ success: killed }) }],
                    };
                  }
                }
              } else {
                coreResult = await toolExecutor.execute(
                  { id: toolCallId, name: toolName, arguments: finalInput },
                  {
                    signal: abortController.signal,
                    workingDirectory: workDir,
                    toolTempRoot: join(state.activeSession.dir, 'tool-temp'),
                    processEnv: envOverlay,
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
                data: {
                  toolCallId,
                  name: toolName,
                  kind,
                  input: finalInput,
                  result: protocolResult,
                },
              });

              providerMessages = [
                ...providerMessages,
                { role: 'user', content: '', toolResults: [coreResult] },
              ];

              // Determine if the turn should continue based on tool result status:
              // - 'completed': success, continue turn
              // - 'failed': recoverable error, pass error back to model, continue turn
              // - 'denied'/'aborted': fatal error, stop turn immediately
              // - 'pending': waiting for permission, stop turn
              if (
                coreResult.status === 'denied' ||
                coreResult.status === 'aborted' ||
                coreResult.status === 'pending'
              ) {
                shouldContinue = false;
              }
              // Note: 'failed' status is recoverable - error is passed to model via toolResults above
            }

            if (!shouldContinue) {
              break;
            }

            // Stop the agentic loop if budget exceeded (after completing current turn)
            if (stopReason === 'budget_exceeded') {
              break;
            }
          }

          if (abortController.signal.aborted) {
            stopReason = 'cancelled';
          }
        } finally {
          provider.cleanup();
        }

        // Save accumulated cost and token usage to session state
        await runExclusive(() => {
          if (!state.activeSession) return;
          const sessionState = readSessionState(state.activeSession.dir);
          const updatedState: SessionState = {
            ...sessionState,
            sessionCostUsd,
            tokenUsage: {
              totalInputTokens: (sessionState.tokenUsage?.totalInputTokens ?? 0) + totalInputTokens,
              totalOutputTokens:
                (sessionState.tokenUsage?.totalOutputTokens ?? 0) + totalOutputTokens,
            },
          };
          writeSessionState(state.activeSession.dir, updatedState);
          state.activeSession = { ...state.activeSession, state: updatedState };
        });

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
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
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
          type: 'bash',
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
          data: { jobId, jobType: 'bash', description: job.description, command: jobCommand },
        });

        await emitUpdate(nextJobTurnSeq++, {
          type: 'job_started',
          jobId,
          jobType: 'bash',
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
          type: 'delegate',
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
          connectionId: subagentConnectionId,
          modelId: subagentModelId,
        };

        state.jobs.set(jobId, job);

        await writeAndAdvance({
          type: 'job_started',
          data: {
            jobId,
            jobType: 'delegate',
            description: job.description,
            command: subagentText,
          },
        });

        await emitUpdate(nextJobTurnSeq++, {
          type: 'job_started',
          jobId,
          jobType: 'delegate',
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
              permissionResponse = await _requestPermissionFromClient({
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
            const envOverlay =
              effectiveConfig.environment && typeof effectiveConfig.environment === 'object'
                ? (effectiveConfig.environment as Record<string, string>)
                : undefined;

            const coreResult = await toolExecutor.execute(
              { id: toolCallId, name: toolName, arguments: finalInput },
              {
                signal: abortController.signal,
                workingDirectory: workDir,
                toolTempRoot: join(state.activeSession.dir, 'tool-temp'),
                processEnv: envOverlay,
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
        if (job.type === 'bash') runShellJobProcess(job);
        if (job.type === 'delegate') runSubagentJobProcess(job);
      }

      return result;
    } finally {
      // Ensure activeTurn is cleared even if an exception is thrown
      state.activeTurn = null;
    }
  };

  // Assign the internal prompt runner for use by queueJobNotification
  runPromptInternal = async (content: unknown[]) => {
    try {
      await handlePrompt({ content });
    } catch {
      // Silently ignore errors from internally-triggered turns
      // (e.g., SessionBusy if a turn started between check and execution)
    }
  };

  // Register the RPC handler
  peer.onRequest('session/prompt', async (params: unknown) => {
    return handlePrompt(params as { content: unknown[]; outputFormat?: unknown });
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
