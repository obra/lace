// ABOUTME: Prompt handler - core conversation processing for user messages and agent responses

import { randomUUID } from 'node:crypto';
import {
  readFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { join, resolve as resolvePath, isAbsolute as isAbsolutePath } from 'node:path';
import {
  AcpErrorCodes,
  type JsonRpcPeer,
  type ToolResult,
} from '@lace/ent-protocol';
import {
  ensureSessionFiles,
  getSessionDir,
  loadSession,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
  type SessionState,
} from '@lace/agent/storage/session-store';
import { appendDurableEvent } from '@lace/agent/storage/event-log';
import {
  deriveCheckpointFilesFromDurableEvents,
  deriveFilesReadFromDurableEvents,
} from '@lace/agent/storage/files-from-events';
import { ProviderRegistry } from '@lace/agent/providers/registry';
import { AIProvider } from '@lace/agent/providers/base-provider';
import type {
  ToolResult as CoreToolResult,
} from '@lace/agent/tools/types';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import { compactDroppedMessagesWithCore } from '@lace/agent/compaction/compact-dropped-messages';
import { findUserCommand } from '@lace/agent/user-commands';
import { getJobOutputPath } from '@lace/agent/jobs/job-manager';
import {
  buildProviderMessagesFromDurableEvents,
} from '@lace/agent/events/message-builder';
import {
  type SessionUpdate,
  type AgentServerState,
} from '@lace/agent/server-types';
import {
  throwInvalidParams,
  toNonEmptyString,
  toolKindFromName,
  protocolToolResultFromCore,
  shouldAskPermission,
  isTestProviderEnabled,
  assertInitialized,
} from '@lace/agent/rpc/utils';

/**
 * Create an AI provider for a turn.
 */
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
      return `Unknown command: ${command}

Type /help for a list of available commands.`;
  }
}

/**
 * Register the session/prompt RPC handler.
 */
export function registerPromptHandler(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(fn: () => T | Promise<T>) => Promise<T>,
  emitSessionUpdate: (
    update: SessionUpdate,
    context: { turnId?: string; turnSeq?: number }
  ) => Promise<void>,
  _requestPermissionFromClient: (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    toolCallId: string;
    tool: string;
    kind: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
    input: Record<string, unknown>;
    signal: AbortSignal;
  }) => Promise<{ decision?: string; updatedInput?: Record<string, unknown> } | undefined>,
  createToolExecutorForMode: (
    executionMode: 'plan' | 'execute',
    mcpServerManager?: any
  ) => { executor: any; toolsForProvider: any[] },
  _startShellJob: (options: {
    command: string;
    description?: string;
    turnContext: { turnId: string; turnSeq: number };
  }) => Promise<{ jobId: string }>,
  startSubagentJob: (options: {
    prompt: string;
    description?: string;
    turnContext: { turnId: string; turnSeq: number };
    resumeSessionId?: string;
    connectionId?: string;
    modelId?: string;
  }) => Promise<{ jobId: string }>,
  deriveJobsForActiveSession: () => Array<{
    jobId: string;
    parentJobId?: string;
    type: string;
    status: string;
    description?: string;
    command?: string;
    startTime?: string;
    subagentSessionId?: string;
    exitCode?: number;
  }>,
  runShellJobProcess: (job: any) => void,
  runSubagentJobProcess: (job: any) => void,
  finalizeJob: (job: any) => Promise<void>,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null }
) {
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
                    hasFileBeenRead: (p: string) =>
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

      const deferredJobs: any[] = [];
      let nextJobTurnSeq = 1;

      if (jobCommand && effectiveConfig.executionMode === 'execute') {
        const jobId = `job_${randomUUID()}`;
        const startedAt = new Date().toISOString();
        const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

        let resolveCompletion!: () => void;
        const completion = new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        });

        const job: any = {
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

        const job: any = {
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
                hasFileBeenRead: (p: string) =>
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
  runPromptInternalRef.current = async (content: unknown[]) => {
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
}
