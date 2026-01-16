// ABOUTME: ConversationRunner - the agentic loop for executing prompts
// This is the core conversation engine. It handles message building, provider
// calls, tool execution, permission handling, and event persistence.

import { randomUUID } from 'node:crypto';
import { join, resolve as resolvePath, isAbsolute as isAbsolutePath } from 'node:path';
import type { ToolResult } from '@lace/ent-protocol';
import type {
  ToolResult as CoreToolResult,
  ToolCall,
  ToolContext,
} from '@lace/agent/tools/types';
import type { Tool } from '@lace/agent/tools/tool';
import {
  readSessionState,
  writeSessionState,
  type SessionState,
} from '@lace/agent/storage/session-store';
import { appendDurableEvent } from '@lace/agent/storage/event-log';
import { deriveFilesReadFromDurableEvents } from '@lace/agent/storage/files-from-events';
import { executeTodoRead, executeTodoWrite } from '@lace/agent/todo/todo-tools';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import {
  toNonEmptyString,
  toolKindFromName,
  protocolToolResultFromCore,
  shouldAskPermission,
} from '@lace/agent/rpc/utils';
import type { RunnerConfig, RunnerDependencies, RunParams, RunResult, ApprovalMode } from './types';
import { EntErrorCodes } from '@lace/ent-protocol';

/**
 * ConversationRunner executes prompts through the agentic loop.
 *
 * It handles:
 * - Building provider messages from durable events
 * - Making streaming provider calls
 * - Executing tool calls with approval workflow
 * - Writing durable events for persistence
 * - Emitting session updates for UI streaming
 *
 * This class is the core of the agent's conversation engine, extracted
 * from the RPC handler to enable direct library usage without JSON-RPC.
 */
export class ConversationRunner {
  private readonly config: RunnerConfig;
  private readonly deps: RunnerDependencies;

  constructor(config: RunnerConfig, deps: RunnerDependencies) {
    this.config = config;
    this.deps = deps;
  }

  /**
   * The session directory where events are persisted.
   */
  get sessionDir(): string {
    return this.config.sessionDir;
  }

  /**
   * Run a prompt through the agentic loop.
   *
   * This will:
   * 1. Write the prompt as a durable event
   * 2. Build provider messages from event history
   * 3. Make provider call(s) with tool execution loop
   * 4. Write results as durable events
   * 5. Emit session updates throughout
   */
  async run(params: RunParams): Promise<RunResult> {
    const { content: _content, maxTurns = 10, abortController, turnId, startedAt } = params;
    const {
      sessionDir,
      cwd,
      executionMode,
      approvalMode,
      modelId,
      environment,
      maxBudgetUsd,
      sessionId,
    } = this.config;

    const filesRead = deriveFilesReadFromDurableEvents(sessionDir, cwd);

    const envOverlay = environment && typeof environment === 'object' ? environment : undefined;

    const { executor: toolExecutor, toolsForProvider } = this.deps.createToolExecutor(
      executionMode,
      this.deps.mcpServerManager,
      this.deps.jobManager
    );

    const provider = await this.deps.createProvider();
    const modelPricing = await this.deps.getModelPricing();

    // Track token usage across the turn
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let sessionCostUsd = this.deps.getSessionCostUsd();

    // Helper to write durable events
    let durableTurnSeq = 0;
    const writeAndAdvance = async (event: { type: string; data: Record<string, unknown> }) => {
      await this.deps.runExclusive(() => {
        let sessionState: SessionState = readSessionState(sessionDir);
        const { nextState } = appendDurableEvent(sessionDir, sessionState, {
          type: event.type,
          data: event.data,
          turnId,
          turnSeq: durableTurnSeq++,
        });
        sessionState = nextState;
        writeSessionState(sessionDir, sessionState);
      });
    };

    let providerMessages = buildProviderMessagesFromDurableEvents(sessionDir);
    let finalAssistantContent = '';
    let stopReason: RunResult['stopReason'] = 'end_turn';

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
              await this.deps.onUpdate(messageTurnSeq, { type: 'text_delta', text: token });
            })
            .catch(() => undefined);
        };

        provider.on('token', onToken);
        let response;
        try {
          response = await provider.createStreamingResponse(
            providerMessages,
            toolsForProvider,
            modelId || 'unknown-model',
            abortController.signal
          );
        } catch (providerError) {
          provider.off('token', onToken);
          // Wrap provider errors with proper error code for RPC layer
          const errorMessage =
            providerError instanceof Error
              ? providerError.message
              : typeof providerError === 'object' &&
                  providerError !== null &&
                  'message' in providerError
                ? String((providerError as { message: unknown }).message)
                : 'Provider request failed';
          throw {
            code: EntErrorCodes.ProviderError,
            message: errorMessage,
            data: { category: 'provider' },
          };
        }
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

        // Check budget before continuing
        if (maxBudgetUsd && maxBudgetUsd > 0 && sessionCostUsd > maxBudgetUsd) {
          stopReason = 'budget_exceeded';
        }

        const assistantText = typeof response.content === 'string' ? response.content : '';
        finalAssistantContent = assistantText;

        if (!streamedAny && assistantText.length > 0) {
          await this.deps.onUpdate(messageTurnSeq, { type: 'text_delta', text: assistantText });
        }

        // Store content in array format (standard content block format)
        const contentBlocks = assistantText ? [{ type: 'text', text: assistantText }] : [];
        await writeAndAdvance({ type: 'message', data: { content: contentBlocks } });

        const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
        if (toolCalls.length === 0) {
          stopReason = response.stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn';
          break;
        }

        providerMessages = [
          ...providerMessages,
          {
            role: 'assistant' as const,
            content: assistantText,
            toolCalls: toolCalls.map((tc: { id: string; name: string; arguments: unknown }) => ({
              id: tc.id,
              name: tc.name,
              arguments: (tc.arguments ?? {}) as Record<string, unknown>,
            })),
          },
        ];

        let shouldContinue = true;

        for (const toolCall of toolCalls) {
          const result = await this.executeToolCall({
            toolCall,
            streamTurnSeq,
            toolExecutor,
            executionMode,
            approvalMode,
            cwd,
            filesRead,
            envOverlay,
            abortController,
            turnId,
            startedAt,
            sessionId,
            writeAndAdvance,
          });

          streamTurnSeq = result.streamTurnSeq;
          providerMessages = [
            ...providerMessages,
            { role: 'user', content: '', toolResults: [result.coreResult] },
          ];

          if (!result.shouldContinue) {
            shouldContinue = false;
          }
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

    // Update session usage
    this.deps.updateSessionUsage({
      costDelta: sessionCostUsd - this.deps.getSessionCostUsd(),
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    });

    if (stopReason === 'end_turn' && completedTurns >= maxTurns) {
      stopReason = 'max_turns';
    }

    await writeAndAdvance({ type: 'turn_end', data: { stopReason } });

    return {
      turnId,
      stopReason,
      content:
        finalAssistantContent.length > 0
          ? [{ type: 'text' as const, text: finalAssistantContent }]
          : [],
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }

  /**
   * Execute a single tool call.
   */
  private async executeToolCall(params: {
    toolCall: { id?: string; name?: string; arguments?: unknown };
    streamTurnSeq: number;
    toolExecutor: {
      getTool: (name: string) => Tool | undefined;
      execute: (toolCall: ToolCall, context: ToolContext) => Promise<CoreToolResult>;
    };
    executionMode: 'plan' | 'execute';
    approvalMode: ApprovalMode;
    cwd: string;
    filesRead: Set<string>;
    envOverlay?: Record<string, string>;
    abortController: AbortController;
    turnId: string;
    startedAt: string;
    sessionId: string;
    writeAndAdvance: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  }): Promise<{
    streamTurnSeq: number;
    coreResult: CoreToolResult;
    shouldContinue: boolean;
  }> {
    const {
      toolCall,
      executionMode,
      approvalMode,
      cwd,
      filesRead,
      envOverlay,
      abortController,
      turnId,
      startedAt: _startedAt,
      sessionId,
      writeAndAdvance,
    } = params;
    const { toolExecutor } = params;
    let { streamTurnSeq } = params;

    const toolCallId = toNonEmptyString(toolCall.id) ?? `tool_${randomUUID()}`;
    const toolName = toNonEmptyString(toolCall.name) ?? '';
    const toolInput =
      typeof toolCall.arguments === 'object' && toolCall.arguments
        ? (toolCall.arguments as Record<string, unknown>)
        : {};

    const toolTurnSeq = streamTurnSeq++;
    const kind = toolKindFromName(toolName);

    await this.deps.onUpdate(toolTurnSeq, {
      type: 'tool_use',
      toolCallId,
      name: toolName,
      kind,
      input: toolInput,
      status: 'pending',
    });

    // Handle deny mode
    if (approvalMode === 'deny') {
      const denied: ToolResult = {
        outcome: 'denied',
        content: [{ type: 'error', message: 'Denied by policy' }],
      };

      await this.deps.onUpdate(toolTurnSeq, {
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

      return {
        streamTurnSeq,
        coreResult: {
          id: toolCallId,
          status: 'denied',
          content: [{ type: 'text', text: 'Denied by policy' }],
        },
        shouldContinue: false,
      };
    }

    // Handle plan mode restrictions
    if (executionMode === 'plan' && kind !== 'read' && kind !== 'search') {
      const denied: ToolResult = {
        outcome: 'denied',
        content: [{ type: 'error', message: 'Tool denied in plan mode' }],
      };

      await this.deps.onUpdate(toolTurnSeq, {
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

      return {
        streamTurnSeq,
        coreResult: {
          id: toolCallId,
          status: 'denied',
          content: [{ type: 'text', text: 'Tool denied in plan mode' }],
        },
        shouldContinue: false,
      };
    }

    // Check if tool exists
    const tool = toolExecutor.getTool(toolName);
    if (!tool && toolName !== 'delegate') {
      const failed: ToolResult = {
        outcome: 'failed',
        content: [{ type: 'error', message: `Tool not found: ${toolName}` }],
      };

      await this.deps.onUpdate(toolTurnSeq, {
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

      return {
        streamTurnSeq,
        coreResult: {
          id: toolCallId,
          status: 'failed',
          content: [{ type: 'text', text: `Tool not found: ${toolName}` }],
        },
        shouldContinue: false,
      };
    }

    // Handle bash with background=true BEFORE permission check.
    // Background jobs handle their own permission flow via shell-job.ts.
    if (toolName === 'bash' && toolInput.background === true) {
      const command = toNonEmptyString(toolInput.command);
      const description = toNonEmptyString(toolInput.description);
      if (!command) {
        const failed: ToolResult = {
          outcome: 'failed',
          content: [{ type: 'error', message: 'bash.command is required' }],
        };
        await this.deps.onUpdate(toolTurnSeq, {
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
        return {
          streamTurnSeq,
          coreResult: {
            id: toolCallId,
            status: 'failed',
            content: [{ type: 'text', text: 'bash.command is required' }],
          },
          shouldContinue: false,
        };
      }

      const { jobId } = await this.deps.startShellJob({
        command,
        description: description || command.substring(0, 50),
        turnContext: { turnId, turnSeq: toolTurnSeq },
      });

      const completed: ToolResult = {
        outcome: 'completed',
        content: [{ type: 'text', text: JSON.stringify({ jobId, status: 'started' }) }],
      };
      await this.deps.onUpdate(toolTurnSeq, {
        type: 'tool_use',
        toolCallId,
        name: toolName,
        kind,
        input: toolInput,
        status: 'completed',
        result: completed,
      });
      await writeAndAdvance({
        type: 'tool_use',
        data: { toolCallId, name: toolName, kind, input: toolInput, result: completed },
      });
      return {
        streamTurnSeq,
        coreResult: {
          id: toolCallId,
          status: 'completed',
          content: [{ type: 'text', text: JSON.stringify({ jobId, status: 'started' }) }],
        },
        shouldContinue: true,
      };
    }

    let finalInput = toolInput;

    // Handle permission request
    const needsPermission = shouldAskPermission(approvalMode, kind, tool?.annotations);
    if (needsPermission) {
      this.deps.setActiveTurnStatus('awaiting_permission', abortController);

      const options = [
        { optionId: 'allow', label: 'Allow' },
        { optionId: 'deny', label: 'Deny' },
      ];

      await this.deps.onUpdate(toolTurnSeq, {
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

      // Compute a meaningful resource for the permission request:
      // - For bash: use the command
      // - For file operations: use the path
      // - Otherwise: use the tool name
      let resource = toolName;
      if (toolName === 'bash' && toolInput.command) {
        resource = String(toolInput.command);
      } else if (toolInput.path) {
        resource = String(toolInput.path);
      }

      try {
        permissionResponse = await this.deps.requestPermission({
          sessionId,
          turnId,
          turnSeq: toolTurnSeq,
          toolCallId,
          tool: toolName,
          kind,
          resource,
          options,
          input: toolInput,
          signal: abortController.signal,
        });
      } catch {
        const cancelled: ToolResult = {
          outcome: 'cancelled',
          content: [{ type: 'error', message: 'Cancelled' }],
        };

        await this.deps.onUpdate(toolTurnSeq, {
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

        return {
          streamTurnSeq,
          coreResult: {
            id: toolCallId,
            status: 'aborted',
            content: [{ type: 'text', text: 'Cancelled' }],
          },
          shouldContinue: false,
        };
      }

      this.deps.setActiveTurnStatus('running', abortController);

      const decision = toNonEmptyString(permissionResponse?.decision);
      if (permissionResponse?.updatedInput) {
        finalInput = permissionResponse.updatedInput;
      }

      if (decision === 'deny') {
        const denied: ToolResult = {
          outcome: 'denied',
          content: [{ type: 'error', message: 'Denied by user' }],
        };

        await this.deps.onUpdate(toolTurnSeq, {
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

        return {
          streamTurnSeq,
          coreResult: {
            id: toolCallId,
            status: 'denied',
            content: [{ type: 'text', text: 'Denied by user' }],
          },
          shouldContinue: false,
        };
      }
    }

    await this.deps.onUpdate(toolTurnSeq, {
      type: 'tool_use',
      toolCallId,
      name: toolName,
      kind,
      input: finalInput,
      status: 'running',
    });

    // Execute the tool
    const coreResult = await this.executeToolByName({
      toolName,
      toolCallId,
      finalInput,
      toolTurnSeq,
      toolExecutor,
      cwd,
      filesRead,
      envOverlay,
      abortController,
      turnId,
    });

    const protocolResult = protocolToolResultFromCore(coreResult);
    type TerminalStatus = 'completed' | 'denied' | 'cancelled' | 'failed';
    function mapOutcomeToStatus(outcome: string): TerminalStatus {
      switch (outcome) {
        case 'completed':
          return 'completed';
        case 'denied':
          return 'denied';
        case 'cancelled':
          return 'cancelled';
        default:
          return 'failed';
      }
    }
    const terminalStatus = mapOutcomeToStatus(protocolResult.outcome);

    await this.deps.onUpdate(toolTurnSeq, {
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

    // Update files read tracking
    if (toolName === 'file_read' && coreResult.status === 'completed') {
      const p = toNonEmptyString(finalInput.path);
      if (p) filesRead.add(isAbsolutePath(p) ? p : resolvePath(cwd, p));
    }

    // Determine if the turn should continue based on tool result status
    const shouldContinue =
      coreResult.status !== 'denied' &&
      coreResult.status !== 'aborted' &&
      coreResult.status !== 'pending';

    return {
      streamTurnSeq,
      coreResult,
      shouldContinue,
    };
  }

  /**
   * Execute a tool by name, handling special built-in tools.
   */
  private async executeToolByName(params: {
    toolName: string;
    toolCallId: string;
    finalInput: Record<string, unknown>;
    toolTurnSeq: number;
    toolExecutor: { execute: (toolCall: ToolCall, context: ToolContext) => Promise<CoreToolResult> };
    cwd: string;
    filesRead: Set<string>;
    envOverlay?: Record<string, string>;
    abortController: AbortController;
    turnId: string;
  }): Promise<CoreToolResult> {
    const {
      toolName,
      toolCallId,
      finalInput,
      toolTurnSeq,
      toolExecutor,
      cwd,
      filesRead,
      envOverlay,
      abortController,
      turnId,
    } = params;

    // Note: bash with background=true is handled before permission check and never reaches here.

    // Handle todo tools (still use runtime handling - todo tools need sessionDir)
    if (toolName === 'todo_read' || toolName === 'todo_write') {
      const todoContext = { sessionDir: this.config.sessionDir };

      if (toolName === 'todo_read') {
        const result = await executeTodoRead(finalInput, todoContext);
        return { ...result, id: toolCallId };
      }
      // todo_write
      const result = await executeTodoWrite(
        finalInput as {
          id?: string;
          title?: string;
          description?: string;
          status?: 'pending' | 'done' | 'removed';
        },
        todoContext
      );
      return { ...result, id: toolCallId };
    }

    // Default: execute through tool executor
    return await toolExecutor.execute(
      { id: toolCallId, name: toolName, arguments: finalInput },
      {
        signal: abortController.signal,
        workingDirectory: cwd,
        toolTempRoot: join(this.config.sessionDir, 'tool-temp'),
        processEnv: envOverlay,
        hasFileBeenRead: (p: string) => filesRead.has(isAbsolutePath(p) ? p : resolvePath(cwd, p)),
        turnId,
        turnSeq: toolTurnSeq,
      }
    );
  }

  /**
   * Cancel any in-progress operation.
   */
  cancel(): void {
    // The abort controller is passed in via RunParams
    // The caller is responsible for aborting it
  }
}
