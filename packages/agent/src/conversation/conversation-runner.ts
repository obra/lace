// ABOUTME: ConversationRunner - core agentic loop for LLM-tool execution cycles

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve as resolvePath, isAbsolute as isAbsolutePath } from 'node:path';
import type { ToolResult } from '@lace/ent-protocol';
import type { ProviderMessage } from '@lace/agent/providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolCall } from '@lace/agent/tools/types';
import { loadSession, readSessionState, writeSessionState, type SessionState } from '@lace/agent/storage/session-store';
import { deriveFilesReadFromDurableEvents } from '@lace/agent/storage/files-from-events';
import type { ToolResult as CoreToolResult } from '@lace/agent/tools/types';
import { getJobOutputPath } from '@lace/agent/jobs/job-manager';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { type SessionUpdate, type AgentServerState } from '@lace/agent/server-types';
import {
  toNonEmptyString,
  toolKindFromName,
  protocolToolResultFromCore,
  shouldAskPermission,
} from '@lace/agent/rpc/utils';
import { createProviderForTurn, getModelPricing } from './provider-factory';

/**
 * Result from running a conversation turn.
 */
export type ConversationResult = {
  turnId: string;
  stopReason: 'end_turn' | 'max_tokens' | 'max_turns' | 'cancelled' | 'budget_exceeded';
  content: { type: 'text'; text: string }[];
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * Context for the conversation runner - dependencies and callbacks.
 */
export type ConversationRunnerContext = {
  state: AgentServerState;
  turnId: string;
  startedAt: string;
  abortController: AbortController;
  runExclusive: <T>(fn: () => T | Promise<T>) => Promise<T>;
  writeAndAdvance: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  emitUpdate: (turnSeq: number, update: SessionUpdate) => Promise<void>;
  requestPermissionFromClient: (request: {
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
  }) => Promise<{ decision?: string; updatedInput?: Record<string, unknown> } | undefined>;
  createToolExecutorForMode: (
    executionMode: 'plan' | 'execute',
    mcpServerManager?: unknown
  ) => { executor: { getTool: (name: string) => unknown; execute: (...args: unknown[]) => Promise<CoreToolResult> }; toolsForProvider: CoreTool[] };
  startShellJob: (options: {
    command: string;
    description?: string;
    turnContext: { turnId: string; turnSeq: number };
  }) => Promise<{ jobId: string }>;
  startSubagentJob: (options: {
    prompt: string;
    description?: string;
    turnContext: { turnId: string; turnSeq: number };
    resumeSessionId?: string;
    connectionId?: string;
    modelId?: string;
  }) => Promise<{ jobId: string }>;
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
  }>;
  finalizeJob: (job: unknown) => Promise<void>;
};

/**
 * Options for running a conversation turn.
 */
export type ApprovalMode = 'ask' | 'approveReads' | 'approveEdits' | 'approve' | 'deny' | 'dangerouslySkipPermissions';

export type ConversationRunnerOptions = {
  maxTurns: number;
  effectiveConfig: {
    connectionId?: string;
    modelId?: string;
    executionMode: 'plan' | 'execute';
    approvalMode: ApprovalMode;
    environment?: Record<string, string>;
    maxBudgetUsd?: number;
  };
};

/**
 * Run the agentic conversation loop.
 *
 * This is the core loop that:
 * 1. Calls the LLM provider
 * 2. Processes tool calls
 * 3. Handles permissions
 * 4. Tracks tokens and costs
 * 5. Continues until the turn completes
 */
export async function runConversation(
  ctx: ConversationRunnerContext,
  options: ConversationRunnerOptions
): Promise<ConversationResult> {
  const { state, turnId, startedAt, abortController, runExclusive, writeAndAdvance, emitUpdate } = ctx;
  const { maxTurns, effectiveConfig } = options;

  if (!state.activeSession) {
    throw new Error('No active session');
  }

  const workDir = state.activeSession.meta.workDir;
  const filesRead = deriveFilesReadFromDurableEvents(state.activeSession.dir, workDir);

  const envOverlay =
    effectiveConfig.environment && typeof effectiveConfig.environment === 'object'
      ? effectiveConfig.environment
      : undefined;

  const { executor: toolExecutor, toolsForProvider } = ctx.createToolExecutorForMode(
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
  let stopReason: 'end_turn' | 'max_tokens' | 'max_turns' | 'cancelled' | 'budget_exceeded' = 'end_turn';

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
          const inputCost = ((response.usage.promptTokens ?? 0) / 1_000_000) * modelPricing.costPer1mIn;
          const outputCost = ((response.usage.completionTokens ?? 0) / 1_000_000) * modelPricing.costPer1mOut;
          sessionCostUsd += inputCost + outputCost;
        }
      }

      // Check budget before continuing (complete current turn, don't start new one)
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

      const mappedToolCalls: ToolCall[] = toolCalls.map((tc: { id: string; name: string; arguments: unknown }) => ({
        id: tc.id,
        name: tc.name,
        arguments: (tc.arguments ?? {}) as Record<string, unknown>,
      }));

      providerMessages = [
        ...providerMessages,
        {
          role: 'assistant' as const,
          content: assistantText,
          toolCalls: mappedToolCalls,
        },
      ];

      let shouldContinue = true;

      for (const toolCall of toolCalls) {
        const result = await executeToolCall(ctx, {
          toolCall,
          streamTurnSeq,
          toolExecutor,
          effectiveConfig,
          workDir,
          filesRead,
          envOverlay,
        });

        streamTurnSeq = result.streamTurnSeq;
        providerMessages = [...providerMessages, { role: 'user', content: '', toolResults: [result.coreResult] }];

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

  // Save accumulated cost and token usage to session state
  await runExclusive(() => {
    if (!state.activeSession) return;
    const sessionState = readSessionState(state.activeSession.dir);
    const updatedState: SessionState = {
      ...sessionState,
      sessionCostUsd,
      tokenUsage: {
        totalInputTokens: (sessionState.tokenUsage?.totalInputTokens ?? 0) + totalInputTokens,
        totalOutputTokens: (sessionState.tokenUsage?.totalOutputTokens ?? 0) + totalOutputTokens,
      },
    };
    writeSessionState(state.activeSession.dir, updatedState);
    state.activeSession = { ...state.activeSession, state: updatedState };
  });

  if (stopReason === 'end_turn' && completedTurns >= maxTurns) {
    stopReason = 'max_turns';
  }

  await writeAndAdvance({ type: 'turn_end', data: { stopReason } });

  return {
    turnId,
    stopReason,
    content: finalAssistantContent.length > 0
      ? [{ type: 'text' as const, text: finalAssistantContent }]
      : [],
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  };
}

/**
 * Execute a single tool call.
 */
async function executeToolCall(
  ctx: ConversationRunnerContext,
  params: {
    toolCall: { id?: string; name?: string; arguments?: unknown };
    streamTurnSeq: number;
    toolExecutor: { getTool: (name: string) => unknown; execute: (...args: unknown[]) => Promise<CoreToolResult> };
    effectiveConfig: {
      executionMode: 'plan' | 'execute';
      approvalMode: ApprovalMode;
    };
    workDir: string;
    filesRead: Set<string>;
    envOverlay?: Record<string, string>;
  }
): Promise<{
  streamTurnSeq: number;
  coreResult: CoreToolResult;
  shouldContinue: boolean;
}> {
  const { state, turnId, startedAt, abortController, writeAndAdvance, emitUpdate } = ctx;
  const { toolCall, effectiveConfig, workDir, filesRead, envOverlay } = params;
  let { streamTurnSeq, toolExecutor } = params;

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

  // Handle deny mode
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

    return {
      streamTurnSeq,
      coreResult: { status: 'denied', content: [{ type: 'text', text: 'Denied by policy' }] },
      shouldContinue: false,
    };
  }

  // Handle plan mode restrictions
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

    return {
      streamTurnSeq,
      coreResult: { status: 'denied', content: [{ type: 'text', text: 'Tool denied in plan mode' }] },
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

    return {
      streamTurnSeq,
      coreResult: { status: 'failed', content: [{ type: 'text', text: `Tool not found: ${toolName}` }] },
      shouldContinue: false,
    };
  }

  let finalInput = toolInput;

  // Handle permission request
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

    let permissionResponse: { decision?: string; updatedInput?: Record<string, unknown> } | undefined;

    try {
      permissionResponse = await ctx.requestPermissionFromClient({
        sessionId: state.activeSession!.meta.sessionId,
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

      return {
        streamTurnSeq,
        coreResult: { status: 'aborted', content: [{ type: 'text', text: 'Cancelled' }] },
        shouldContinue: false,
      };
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

      return {
        streamTurnSeq,
        coreResult: { status: 'denied', content: [{ type: 'text', text: 'Denied by user' }] },
        shouldContinue: false,
      };
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

  // Execute the tool
  const coreResult = await executeToolByName(ctx, {
    toolName,
    toolCallId,
    finalInput,
    toolTurnSeq,
    toolExecutor,
    workDir,
    filesRead,
    envOverlay,
  });

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

  // Update files read tracking
  if (toolName === 'file_read' && coreResult.status === 'completed') {
    const p = toNonEmptyString(finalInput.path);
    if (p) filesRead.add(isAbsolutePath(p) ? p : resolvePath(workDir, p));
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
async function executeToolByName(
  ctx: ConversationRunnerContext,
  params: {
    toolName: string;
    toolCallId: string;
    finalInput: Record<string, unknown>;
    toolTurnSeq: number;
    toolExecutor: { execute: (...args: unknown[]) => Promise<CoreToolResult> };
    workDir: string;
    filesRead: Set<string>;
    envOverlay?: Record<string, string>;
  }
): Promise<CoreToolResult> {
  const { state, turnId, abortController } = ctx;
  const { toolName, toolCallId, finalInput, toolTurnSeq, toolExecutor, workDir, filesRead, envOverlay } = params;

  if (!state.activeSession) {
    return { status: 'failed', content: [{ type: 'text', text: 'No active session' }] };
  }

  // Handle bash with background=true
  if (toolName === 'bash' && finalInput.background === true) {
    const command = toNonEmptyString(finalInput.command);
    const description = toNonEmptyString(finalInput.description);
    if (!command) {
      return { status: 'failed', content: [{ type: 'text', text: 'bash.command is required' }] };
    }

    const { jobId } = await ctx.startShellJob({
      command,
      description: description || command.substring(0, 50),
      turnContext: { turnId, turnSeq: toolTurnSeq },
    });

    return {
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify({ jobId, status: 'started' }) }],
    };
  }

  // Handle delegate tool
  if (toolName === 'delegate') {
    return await executeDelegateTool(ctx, { finalInput, toolTurnSeq });
  }

  // Handle job_output tool
  if (toolName === 'job_output') {
    return await executeJobOutputTool(ctx, { finalInput });
  }

  // Handle jobs_list tool
  if (toolName === 'jobs_list') {
    return executeJobsListTool(ctx, { finalInput });
  }

  // Handle job_kill tool
  if (toolName === 'job_kill') {
    return executeJobKillTool(ctx, { finalInput });
  }

  // Default: execute through tool executor
  return await toolExecutor.execute(
    { id: toolCallId, name: toolName, arguments: finalInput },
    {
      signal: abortController.signal,
      workingDirectory: workDir,
      toolTempRoot: join(state.activeSession.dir, 'tool-temp'),
      processEnv: envOverlay,
      hasFileBeenRead: (p: string) => filesRead.has(isAbsolutePath(p) ? p : resolvePath(workDir, p)),
    }
  );
}

/**
 * Execute the delegate tool.
 */
async function executeDelegateTool(
  ctx: ConversationRunnerContext,
  params: { finalInput: Record<string, unknown>; toolTurnSeq: number }
): Promise<CoreToolResult> {
  const { state, turnId, abortController } = ctx;
  const { finalInput, toolTurnSeq } = params;

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
    const previousJob = state.jobs.get(resumeJobId);
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

  const { jobId } = await ctx.startSubagentJob({
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
  const job = state.jobs.get(jobId);
  if (job) {
    const abortPromise = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });

    try {
      await Promise.race([job.completion, abortPromise]);
    } catch {
      job.status = 'cancelled';
      await ctx.finalizeJob(job);
    }
  }

  let output = '';
  try {
    output = readFileSync(getJobOutputPath(state.activeSession!.dir, jobId), 'utf8');
  } catch {
    output = '';
  }

  const tailLimit = 64 * 1024;
  const truncated = output.length > tailLimit;
  const reportText = truncated ? output.slice(-tailLimit) : output;

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
 * Execute the job_output tool.
 */
async function executeJobOutputTool(
  ctx: ConversationRunnerContext,
  params: { finalInput: Record<string, unknown> }
): Promise<CoreToolResult> {
  const { state } = ctx;
  const { finalInput } = params;

  const jobId = toNonEmptyString(finalInput.jobId);
  if (!jobId) {
    return { status: 'failed', content: [{ type: 'text', text: 'job_output.jobId is required' }] };
  }

  const block = finalInput.block !== false;
  const timeoutMs = typeof finalInput.timeoutMs === 'number' ? finalInput.timeoutMs : 30_000;
  const byteOffset = typeof finalInput.byteOffset === 'number' ? finalInput.byteOffset : 0;

  // Block until job completion if requested
  const runningJob = state.jobs.get(jobId);
  if (block && runningJob?.status === 'running') {
    await Promise.race([
      runningJob.completion,
      timeoutMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)) : new Promise<void>(() => {}),
    ]);
  }

  // Look up job from derived list (includes persisted jobs)
  const jobs = ctx.deriveJobsForActiveSession();
  const record = jobs.find((j) => j.jobId === jobId);

  if (!record) {
    return { status: 'failed', content: [{ type: 'text', text: `Job not found: ${jobId}` }] };
  }

  const sessionDir = state.activeSession!.dir;
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

  return { status: 'completed', content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/**
 * Execute the jobs_list tool.
 */
function executeJobsListTool(
  ctx: ConversationRunnerContext,
  params: { finalInput: Record<string, unknown> }
): CoreToolResult {
  const { finalInput } = params;

  const statusFilter = Array.isArray(finalInput.status) ? (finalInput.status as string[]) : undefined;
  const typeFilter = Array.isArray(finalInput.type) ? (finalInput.type as string[]) : undefined;
  const limit = typeof finalInput.limit === 'number' ? finalInput.limit : 50;

  let jobs = ctx.deriveJobsForActiveSession().map((j) => ({
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

  return { status: 'completed', content: [{ type: 'text', text: JSON.stringify({ jobs }, null, 2) }] };
}

/**
 * Execute the job_kill tool.
 */
function executeJobKillTool(
  ctx: ConversationRunnerContext,
  params: { finalInput: Record<string, unknown> }
): CoreToolResult {
  const { state } = ctx;
  const { finalInput } = params;

  const jobId = toNonEmptyString(finalInput.jobId);
  if (!jobId) {
    return { status: 'failed', content: [{ type: 'text', text: 'job_kill.jobId is required' }] };
  }

  const job = state.jobs.get(jobId);
  if (!job || job.status !== 'running') {
    return {
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify({ success: false, reason: 'Job not running' }) }],
    };
  }

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

  return { status: 'completed', content: [{ type: 'text', text: JSON.stringify({ success: killed }) }] };
}
