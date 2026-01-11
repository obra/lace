// ABOUTME: ConversationRunner - the agentic loop for executing prompts
// This is the core conversation engine. It handles message building, provider
// calls, tool execution, permission handling, and event persistence.

import { randomUUID } from 'node:crypto';
import { join, resolve as resolvePath, isAbsolute as isAbsolutePath } from 'node:path';
import type { ToolResult } from '@lace/ent-protocol';
import type { ToolResult as CoreToolResult } from '@lace/agent/tools/types';
import {
  readSessionState,
  writeSessionState,
  type SessionState,
} from '@lace/agent/storage/session-store';
import { appendDurableEvent } from '@lace/agent/storage/event-log';
import { deriveFilesReadFromDurableEvents } from '@lace/agent/storage/files-from-events';
import { getJobOutputPath, readJobOutputTail } from '@lace/agent/jobs';
import {
  executeJobOutput,
  executeJobsList,
  executeJobKill,
} from '@lace/agent/core/tools/special/job-tools';
import type { SpecialToolContext } from '@lace/agent/core/tools/special/types';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import {
  toNonEmptyString,
  toolKindFromName,
  protocolToolResultFromCore,
  shouldAskPermission,
} from '@lace/agent/rpc/utils';
import type { RunnerConfig, RunnerDependencies, RunParams, RunResult, ApprovalMode } from './types';

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
    const { content, maxTurns = 10, abortController, turnId, startedAt } = params;
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
      this.deps.mcpServerManager
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
        const response = await provider.createStreamingResponse(
          providerMessages,
          toolsForProvider,
          modelId || 'unknown-model',
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
      getTool: (name: string) => unknown;
      execute: (...args: unknown[]) => Promise<CoreToolResult>;
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
      startedAt,
      sessionId,
      writeAndAdvance,
    } = params;
    let { streamTurnSeq, toolExecutor } = params;

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
        coreResult: { status: 'denied', content: [{ type: 'text', text: 'Denied by policy' }] },
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
          status: 'completed',
          content: [{ type: 'text', text: JSON.stringify({ jobId, status: 'started' }) }],
        },
        shouldContinue: true,
      };
    }

    let finalInput = toolInput;

    // Handle permission request
    const needsPermission = shouldAskPermission(approvalMode, kind);
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
          coreResult: { status: 'aborted', content: [{ type: 'text', text: 'Cancelled' }] },
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
          coreResult: { status: 'denied', content: [{ type: 'text', text: 'Denied by user' }] },
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
   * Create a SpecialToolContext for job tool handlers.
   * Adapts the runner's dependencies to the context interface expected by job-tools.ts.
   */
  private createJobToolContext(params: {
    turnId: string;
    turnSeq: number;
    abortSignal: AbortSignal;
  }): SpecialToolContext {
    const jobs = new Map<string, import('@lace/agent/server-types').JobState>();
    // Build a Map from individual job lookups for the context interface
    // The deriveJobs returns all jobs, but getJobs needs a Map
    for (const record of this.deps.deriveJobs()) {
      const job = this.deps.getJob(record.jobId);
      if (job) {
        jobs.set(record.jobId, job);
      }
    }

    return {
      sessionDir: this.config.sessionDir,
      turnId: params.turnId,
      turnSeq: params.turnSeq,
      abortSignal: params.abortSignal,
      getJobs: () => jobs,
      deriveJobs: () => this.deps.deriveJobs(),
      startShellJob: this.deps.startShellJob,
      startSubagentJob: this.deps.startSubagentJob,
      finalizeJob: this.deps.finalizeJob,
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
    toolExecutor: { execute: (...args: unknown[]) => Promise<CoreToolResult> };
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

    // Handle delegate tool
    if (toolName === 'delegate') {
      return await this.executeDelegateTool({ finalInput, toolTurnSeq, abortController, turnId });
    }

    // Handle job tools via shared job-tools.ts handlers
    if (toolName === 'job_output' || toolName === 'jobs_list' || toolName === 'job_kill') {
      const context = this.createJobToolContext({
        turnId,
        turnSeq: toolTurnSeq,
        abortSignal: abortController.signal,
      });

      if (toolName === 'job_output') {
        return await executeJobOutput(
          finalInput as {
            jobId?: string;
            block?: boolean;
            timeoutMs?: number;
            byteOffset?: number;
          },
          context
        );
      }
      if (toolName === 'jobs_list') {
        return await executeJobsList(
          finalInput as { status?: string[]; type?: string[]; limit?: number },
          context
        );
      }
      // job_kill
      return await executeJobKill(finalInput as { jobId?: string }, context);
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
      }
    );
  }

  /**
   * Execute the delegate tool.
   */
  private async executeDelegateTool(params: {
    finalInput: Record<string, unknown>;
    toolTurnSeq: number;
    abortController: AbortController;
    turnId: string;
  }): Promise<CoreToolResult> {
    const { finalInput, toolTurnSeq, abortController, turnId } = params;

    const prompt = toNonEmptyString(finalInput.prompt);
    const background = finalInput.background === true;
    const description = toNonEmptyString(finalInput.description);
    const resumeJobId = toNonEmptyString(finalInput.resume);
    const connectionId = toNonEmptyString(finalInput.connectionId) ?? undefined;
    const modelId = toNonEmptyString(finalInput.modelId) ?? undefined;

    // If resuming, look up the previous job's subagentSessionId
    let resumeSessionId: string | undefined;
    let resumeError: string | undefined;
    if (resumeJobId) {
      const previousJob = this.deps.getJob(resumeJobId);
      if (!previousJob?.subagentSessionId) {
        resumeError = `Cannot resume job ${resumeJobId}: no subagentSessionId found`;
      } else {
        resumeSessionId = previousJob.subagentSessionId;
      }
    }

    if (!prompt) {
      return { status: 'failed', content: [{ type: 'text', text: 'delegate.prompt is required' }] };
    }

    if (resumeError) {
      return { status: 'failed', content: [{ type: 'text', text: resumeError }] };
    }

    const { jobId } = await this.deps.startSubagentJob({
      prompt,
      description: description || 'Delegate',
      turnContext: { turnId, turnSeq: toolTurnSeq },
      resumeSessionId,
      connectionId,
      modelId,
    });

    if (background) {
      return {
        status: 'completed',
        content: [{ type: 'text', text: JSON.stringify({ jobId, status: 'started' }) }],
      };
    }

    // Wait for job completion
    const job = this.deps.getJob(jobId);
    if (job) {
      const abortPromise = new Promise<never>((_, reject) => {
        abortController.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        });
      });

      try {
        await Promise.race([job.completion, abortPromise]);
      } catch {
        job.status = 'cancelled';
        await this.deps.finalizeJob(job);
      }
    }

    // Read output with tail-based truncation
    const { output: reportText, truncated } = readJobOutputTail(
      getJobOutputPath(this.config.sessionDir, jobId)
    );

    const status = job?.status ?? 'failed';
    return {
      status: status === 'completed' ? 'completed' : status === 'cancelled' ? 'aborted' : 'failed',
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

  /**
   * Cancel any in-progress operation.
   */
  cancel(): void {
    // The abort controller is passed in via RunParams
    // The caller is responsible for aborting it
  }
}
