// ABOUTME: ConversationRunner - the agentic loop for executing prompts
// This is the core conversation engine. It handles message building, provider
// calls, tool execution, permission handling, and event persistence.

import { randomUUID } from 'node:crypto';
import { join, resolve as resolvePath, isAbsolute as isAbsolutePath } from 'node:path';
import type { ToolResult } from '@lace/ent-protocol';
import type { ToolResult as CoreToolResult, ToolCall, ToolContext } from '@lace/agent/tools/types';
import type { Tool } from '@lace/agent/tools/tool';
import { createToolRuntimeFromBinding } from '@lace/agent/tools/runtime/factory';
import { FileAccessTracker } from '@lace/agent/tools/runtime/file-access-tracker';
import { buildDefaultBoundedHostRuntimeBinding } from '@lace/agent/tools/runtime/validation';
import type {
  RuntimeExecutionBinding,
  RuntimePath,
  ToolRuntime,
} from '@lace/agent/tools/runtime/types';
import {
  readSessionState,
  writeSessionState,
  type SessionState,
} from '@lace/agent/storage/session-store';
import {
  appendDurableEvent,
  findLastTurnEndEventSeq,
  readDurableEvents,
  type DurableEvent,
} from '@lace/agent/storage/event-log';
import { deriveFilesReadFromDurableEvents } from '@lace/agent/storage/files-from-events';
import { executeTodoRead, executeTodoWrite } from '@lace/agent/todo/todo-tools';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { appendOrMergeUser } from '@lace/agent/message-building/append-or-merge';
import { bashSchema } from '@lace/agent/tools/implementations/bash';
import {
  toNonEmptyString,
  toolKindFromName,
  protocolToolResultFromCore,
  shouldAskPermission,
} from '@lace/agent/rpc/utils';
import type { RunnerConfig, RunnerDependencies, RunParams, RunResult, ApprovalMode } from './types';
import type { RequestOptions } from '@lace/agent/providers/base-provider';
import { EntErrorCodes } from '@lace/ent-protocol';
import { logger } from '@lace/agent/utils/logger';

/**
 * Sentinel marker the runner sets on errors thrown out of executeToolCall.
 * Lets mapErrorToStopReason distinguish a tool throw from a provider throw
 * without having to inspect the loop's lexical state. Set on a non-enumerable
 * field so it doesn't pollute JSON serialization of the error.
 */
const PHASE_TOOL = 'tool';
const PHASE_KEY = '__lacePhase';

function tagAsToolError(err: unknown): unknown {
  if (err && typeof err === 'object') {
    try {
      Object.defineProperty(err as object, PHASE_KEY, {
        value: PHASE_TOOL,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch {
      // Frozen errors are rare; fall through and let the generic classifier
      // pick a bucket (internal_error). Better to lose precision than to
      // crash the finally block trying to tag.
    }
  }
  return err;
}

function phaseOf(err: unknown): string | undefined {
  if (err && typeof err === 'object' && PHASE_KEY in err) {
    const v = (err as Record<string, unknown>)[PHASE_KEY];
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

/**
 * Pick a stopReason for an error caught out of runner.run()'s agentic loop.
 *
 * The runner classifies, in order:
 * 1. Tool-phase throws (tagged via tagAsToolError when executeToolCall threw)
 *    map to tool_error_* — timeout if the error looks like a timeout,
 *    otherwise tool_error_throw.
 * 2. Provider-phase throws (the ProviderError envelope thrown at runner.ts
 *    after createStreamingResponse fails, plus anything that escapes to
 *    runner.run() bearing provider-shaped fields) map to provider_error_*
 *    by inspecting the message and well-known err codes.
 * 3. Everything else is internal_error.
 *
 * The message-string matching is intentionally permissive: the production
 * samples in scratch/turn-aborts/classified.csv show Anthropic SDK errors
 * arrive as plain Error objects with the upstream JSON body baked into the
 * message, so substring tests catch the realistic shapes (overloaded_error,
 * invalid_request_error, "model: opus", "invalid proxy path", etc.).
 */
export function mapErrorToStopReason(err: unknown): RunResult['stopReason'] {
  if (phaseOf(err) === PHASE_TOOL) {
    if (looksLikeTimeout(err)) return 'tool_error_timeout';
    return 'tool_error_throw';
  }

  if (looksLikeProviderError(err)) {
    const msg = errorMessage(err).toLowerCase();
    if (msg.includes('overloaded_error') || msg.includes('overloaded') || hasStatus(err, 529)) {
      return 'provider_error_overloaded';
    }
    if (
      msg.includes('invalid_request_error') ||
      msg.includes('invalid proxy path') ||
      msg.includes('not_found_error') ||
      /\b(?:400|401|403|404|422)\b/.test(msg) ||
      hasStatus(err, 400) ||
      hasStatus(err, 401) ||
      hasStatus(err, 403) ||
      hasStatus(err, 404) ||
      hasStatus(err, 422)
    ) {
      return 'provider_error_invalid';
    }
    if (looksLikeNetworkError(err)) {
      return 'provider_error_network';
    }
    return 'provider_error_other';
  }

  // Plain network errors thrown from anywhere — treat as provider_error_network
  // since the only network call in the loop is the provider one.
  if (looksLikeNetworkError(err)) {
    return 'provider_error_network';
  }

  return 'internal_error';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : String(m);
  }
  return String(err);
}

function hasStatus(err: unknown, status: number): boolean {
  if (!err || typeof err !== 'object') return false;
  const v = (err as Record<string, unknown>).status;
  return typeof v === 'number' && v === status;
}

function looksLikeProviderError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e.code === EntErrorCodes.ProviderError) return true;
  const data = e.data as Record<string, unknown> | undefined;
  if (data && data.category === 'provider') return true;
  // The Anthropic/OpenAI SDKs throw subclasses whose constructor name ends in
  // "APIError" — recognise those even if no envelope wrap fired.
  const ctorName = (err as { constructor?: { name?: string } }).constructor?.name;
  if (typeof ctorName === 'string' && /APIError$/.test(ctorName)) return true;
  return false;
}

function looksLikeNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const code = e.code;
  if (typeof code === 'string') {
    if (
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'EAI_AGAIN' ||
      code === 'EPIPE'
    ) {
      return true;
    }
  }
  const name = (err as { name?: unknown }).name;
  if (name === 'FetchError') return true;
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  );
}

function looksLikeTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  if (name === 'TimeoutError') return true;
  const code = (err as { code?: unknown }).code;
  if (code === 'ETIMEDOUT') return true;
  return /timeout/i.test(errorMessage(err));
}

// First-person future-tense intent markers. When the model emits one of these
// on a text-only turn following a tool round-trip, it has declared work it has
// not actually performed (kata #31 round 2: production "I'll add a brief note"
// pattern). Past-tense completion summaries ("Done. Updated successfully.") and
// pure-answer text ("The answer is 42.") deliberately do NOT match.
const FUTURE_TENSE_INTENT_PATTERN =
  /\b(?:I'll|I will|I'm going to|I am going to|let me|let's|I shall|I'll just|I'll go ahead|going to add|going to write|going to update|going to create)\b/i;

function hasFutureTenseIntent(text: string): boolean {
  if (!text) return false;
  return FUTURE_TENSE_INTENT_PATTERN.test(text);
}

/**
 * Extract concatenated text from a context_injected event's content blocks.
 * Mirrors message-builder.ts's handling: only text blocks contribute.
 */
function extractInjectedText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n');
}

/**
 * Read durable events newer than `afterEventSeq` and return any
 * priority='immediate' context_injected events plus the highest eventSeq seen.
 *
 * Existed because of PRI-1691: a sessionPrompt can be in flight while a peer
 * calls ent/session/inject, which writes a context_injected event with
 * priority='immediate'. Without this re-read, the runner would only pick that
 * event up on the NEXT turn — functionally identical to queueing.
 */
function readImmediateInjectsSince(
  sessionDir: string,
  afterEventSeq: number
): { injections: string[]; newWatermark: number } {
  const { events } = readDurableEvents(sessionDir, {
    afterEventSeq,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const injections: string[] = [];
  let watermark = afterEventSeq;
  for (const e of events) {
    if (e.eventSeq > watermark) watermark = e.eventSeq;
    if (e.type !== 'context_injected') continue;
    const data = (e as DurableEvent).data as { content?: unknown; priority?: unknown };
    if (data.priority !== 'immediate') continue;
    const text = extractInjectedText(data.content);
    if (text.trim()) injections.push(text);
  }
  return { injections, newWatermark: watermark };
}

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

  // Interval at which to inject a reminder to check for stuck loops
  private static readonly LOOP_CHECK_INTERVAL = 50;

  // Default maximum turns - set very high since we use reminders instead of hard cutoffs
  static readonly DEFAULT_MAX_TURNS = 10000;

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
    const {
      content: _content,
      maxTurns = ConversationRunner.DEFAULT_MAX_TURNS,
      abortController,
      turnId,
      startedAt,
    } = params;
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

    const runtimeBinding = this.resolveActiveRuntimeBinding(cwd);
    const filesRead = deriveFilesReadFromDurableEvents(sessionDir, runtimeBinding.toolRuntime.cwd);
    const runtimeFileAccessTracker = await this.createFileAccessTracker(filesRead, runtimeBinding);

    const envOverlay = environment && typeof environment === 'object' ? environment : undefined;

    const { executor: toolExecutor, toolsForProvider } = await this.deps.createToolExecutor(
      executionMode,
      this.deps.mcpServerManager,
      this.deps.jobManager,
      this.deps.skillRegistry,
      this.deps.personaRegistry
    );

    // Build provider messages and validate the system-prompt invariant BEFORE
    // constructing the provider. If we threw after createProvider() but outside
    // the try/finally that calls provider.cleanup(), the provider would leak
    // EventEmitter listeners and open HTTP sockets.
    const { messages: rebuiltMessages, systemPrompt: frozenSystemPrompt } =
      buildProviderMessagesFromDurableEvents(sessionDir);
    let providerMessages = rebuiltMessages;

    // The system prompt is invariant for the session lifetime and is written
    // by session/new as a system_prompt_set event. An empty result means the
    // session is corrupt or was created without one — fail loudly rather
    // than letting the provider's fallback string silently mask the bug.
    if (!frozenSystemPrompt) {
      throw new Error(
        `Session ${sessionDir} has no system_prompt_set event; ` +
          `the session is corrupt or was created before the invariant was enforced.`
      );
    }

    const provider = await this.deps.createProvider();
    const modelPricing = await this.deps.getModelPricing();

    // Track token usage across the turn
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const previousSessionCostUsd = this.deps.getSessionCostUsd();
    let sessionCostUsd = previousSessionCostUsd;

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

    provider.setSystemPrompt(frozenSystemPrompt);
    // Watermark for mid-turn re-reads of durable events. Events with
    // eventSeq <= this value are already reflected in providerMessages (either
    // from the initial build above or appended on a previous iteration).
    //
    // We start from the last turn_end rather than the very latest event so that
    // any context_injected events written between turns (after turn_end but
    // before run() was called) are picked up on the first iteration, not
    // silently skipped (PRI-1744).
    let lastSeenEventSeq = findLastTurnEndEventSeq(sessionDir) ?? 0;
    let finalAssistantContent = '';
    let stopReason: RunResult['stopReason'] = 'end_turn';
    // PRI-1818: captured by the outer catch and rethrown after finally so the
    // turn_end write always runs. Undefined means the loop completed cleanly.
    let caughtError: unknown;

    let streamTurnSeq = 0;
    let completedTurns = 0;

    // Bare text retry: when the model returns no tool calls, retry once with
    // tool_choice=required to force a verification tool call (catches
    // NEVER_SUBMITTED pattern where model says "Done" instead of verifying)
    let retriedWithToolChoice = false;
    let nextRequestOptions: RequestOptions | undefined;
    let lastResponseId: string | undefined;

    try {
      for (; completedTurns < maxTurns; completedTurns++) {
        // PRI-1691: pick up any priority='immediate' context_injected events
        // that landed since we last looked. These come from ent/session/inject
        // RPCs fired by peers while this turn is in flight; without this
        // re-read they would not be visible until the next sessionPrompt.
        const { injections, newWatermark } = readImmediateInjectsSince(
          sessionDir,
          lastSeenEventSeq
        );
        for (const content of injections) {
          providerMessages = appendOrMergeUser(providerMessages, content);
        }
        lastSeenEventSeq = newWatermark;

        // Inject a reminder every LOOP_CHECK_INTERVAL turns to help detect
        // stuck loops. PRI-1804 #4 (revised after adversarial review): push
        // the reminder into providerMessages in-memory ONLY. Do NOT persist
        // it as a context_injected event — persisting caused the next
        // iteration's readImmediateInjectsSince to re-read and re-append
        // the same reminder, doubling it in the message stream. The
        // reminder is intentionally ephemeral runtime guidance; if the
        // session restarts mid-run, missing one nudge at turn 50 is fine.
        if (completedTurns > 0 && completedTurns % ConversationRunner.LOOP_CHECK_INTERVAL === 0) {
          const reminder =
            '<system-reminder>You have completed many agentic turns. If you believe you are stuck in a loop or not making progress, stop and ask the user for guidance. Otherwise, continue.</system-reminder>';
          providerMessages = appendOrMergeUser(providerMessages, reminder);
        }

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

        let thinkingTurnSeq = streamTurnSeq;

        // Throttle thinking deltas to ~100ms batches to avoid overwhelming the client
        let thinkingBuffer = '';
        let thinkingFlushTimeout: ReturnType<typeof setTimeout> | null = null;

        const flushThinkingBuffer = () => {
          if (thinkingBuffer && !abortController.signal.aborted) {
            this.deps.onUpdate(thinkingTurnSeq, {
              type: 'thinking_delta',
              text: thinkingBuffer,
              turnId,
              turnSeq: thinkingTurnSeq,
            });
            thinkingBuffer = '';
          }
          thinkingFlushTimeout = null;
        };

        const onThinkingStart = () => {
          if (abortController.signal.aborted) return;
          thinkingTurnSeq = streamTurnSeq++;
          this.deps.onUpdate(thinkingTurnSeq, {
            type: 'thinking_start',
            turnId,
            turnSeq: durableTurnSeq++,
          });
        };

        const onThinkingDelta = ({ text }: { text: string }) => {
          if (abortController.signal.aborted) return;
          thinkingBuffer += text;

          if (!thinkingFlushTimeout) {
            thinkingFlushTimeout = setTimeout(flushThinkingBuffer, 100);
          }
        };

        const onThinkingEnd = ({ tokens }: { tokens: number }) => {
          // Flush any remaining buffer before end
          if (thinkingFlushTimeout) {
            clearTimeout(thinkingFlushTimeout);
            thinkingFlushTimeout = null;
          }
          flushThinkingBuffer();

          if (abortController.signal.aborted) return;
          this.deps.onUpdate(thinkingTurnSeq, {
            type: 'thinking_end',
            tokens,
            turnId,
            turnSeq: durableTurnSeq++,
          });
        };

        provider.on('token', onToken);
        provider.on('thinking_start', onThinkingStart);
        provider.on('thinking_delta', onThinkingDelta);
        provider.on('thinking_end', onThinkingEnd);
        let response;
        try {
          response = await provider.createStreamingResponse(
            providerMessages,
            toolsForProvider,
            modelId || 'unknown-model',
            abortController.signal,
            lastResponseId ? { openaiResponseId: lastResponseId } : undefined,
            nextRequestOptions
          );
          nextRequestOptions = undefined; // Reset after use
          lastResponseId = response.responseId;
        } catch (providerError) {
          provider.off('token', onToken);
          provider.off('thinking_start', onThinkingStart);
          provider.off('thinking_delta', onThinkingDelta);
          provider.off('thinking_end', onThinkingEnd);
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
        provider.off('thinking_start', onThinkingStart);
        provider.off('thinking_delta', onThinkingDelta);
        provider.off('thinking_end', onThinkingEnd);
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

        // Store content in array format (standard content block format).
        // Only persist if there is actual content — an empty assistant turn would
        // produce a {role:'assistant', content:''} when rebuilt, which creates
        // consecutive user/user messages after the format-converter drops the
        // empty block. Anthropic's API rejects consecutive same-role messages.
        const contentBlocks = assistantText ? [{ type: 'text', text: assistantText }] : [];
        if (contentBlocks.length > 0) {
          await writeAndAdvance({ type: 'message', data: { content: contentBlocks } });
        }

        const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
        if (toolCalls.length === 0) {
          if (response.stopReason === 'max_tokens') {
            stopReason = 'max_tokens';
            break;
          }
          // Retry once with tool_choice=required to force a verification tool call.
          // This catches the NEVER_SUBMITTED pattern where the model produces "Done"
          // text or empty responses instead of calling a verification tool.
          if (!retriedWithToolChoice && completedTurns > 0) {
            retriedWithToolChoice = true;
            // Always push an assistant turn before the user reminder, even when
            // assistantText is empty — Anthropic requires alternating roles, and
            // the previous message in providerMessages is user[toolResults].
            // Without a placeholder we'd ship consecutive user messages and get a
            // 400. The placeholder is in-memory only; durable events.jsonl is
            // untouched.
            const assistantPlaceholder =
              assistantText.trim().length > 0 ? assistantText : '(no response)';
            providerMessages = [
              ...providerMessages,
              { role: 'assistant' as const, content: assistantPlaceholder },
              {
                role: 'user' as const,
                content:
                  '<system-reminder>You must use a tool to verify your work before stopping. Do not respond with text — call a tool.</system-reminder>',
              },
            ];
            nextRequestOptions = { toolChoice: 'required' };
            continue;
          }
          // After a tool round-trip, if the model still returns only text and
          // that text declares future-tense intent ("I'll add a note", "I will
          // now apply the change"), the model has promised work it never
          // performed. Surface 'incomplete' so the caller (subagent job, parent
          // agent, scripts) can tell this apart from a clean completion summary.
          if (completedTurns > 0 && hasFutureTenseIntent(assistantText)) {
            stopReason = 'incomplete';
            break;
          }
          stopReason = 'end_turn';
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
          let result;
          try {
            result = await this.executeToolCall({
              toolCall,
              streamTurnSeq,
              toolExecutor,
              executionMode,
              approvalMode,
              cwd,
              filesRead,
              runtimeFileAccessTracker,
              envOverlay,
              abortController,
              turnId,
              startedAt,
              sessionId,
              runtimeBinding,
              writeAndAdvance,
            });
          } catch (toolErr) {
            // PRI-1818: tag the throw so the outer catch's classifier can
            // distinguish a tool-phase failure from a provider-phase failure.
            // The 19 message_then_no_error_logged turns on Ada all match this
            // path: provider returned a tool call, message landed, then
            // executeToolCall threw and the turn abandoned the durable log.
            throw tagAsToolError(toolErr);
          }

          streamTurnSeq = result.streamTurnSeq;
          providerMessages = [
            ...providerMessages,
            { role: 'user', content: '', toolResults: [result.coreResult] },
          ];

          if (!result.shouldContinue) {
            shouldContinue = false;
            // When the permission request itself was cancelled (kata #37 —
            // upstream supervisor has no handler, request races out in ~15ms)
            // the tool never ran. Surface that as a distinct stopReason so
            // subagent-job (and anything else mapping turn results to job
            // status) can mark the job as failed instead of silently
            // reporting 'completed' for a turn that lost its writes.
            if (result.cancelReason === 'permission_cancelled') {
              stopReason = 'permission_cancelled';
            }
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
    } catch (loopError) {
      // PRI-1818: never let a throw skip the turn_end write. We capture the
      // error, derive a fine-grained stopReason from it, and let the finally
      // block close out the durable log. The error is rethrown after the
      // finally so callers (prompt.ts, the job layer, SDK consumers) still
      // see the failure rather than believing the run succeeded.
      caughtError = loopError;
      stopReason = mapErrorToStopReason(loopError);
    } finally {
      provider.cleanup();

      // The max_turns reclassification only applies when the loop completed
      // cleanly with end_turn — an error shouldn't be relabelled max_turns
      // just because it threw on the last permitted iteration.
      if (stopReason === 'end_turn' && completedTurns >= maxTurns) {
        stopReason = 'max_turns';
      }

      // Update session usage even on failure so the cost we DID incur up to
      // the throw is recorded. Wrap in try/catch — the process may be dying
      // and a throw here would shadow the original error AND skip turn_end.
      try {
        this.deps.updateSessionUsage({
          costDelta: sessionCostUsd - this.deps.getSessionCostUsd(),
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        });
      } catch (usageErr) {
        logger.error('runner: updateSessionUsage failed during turn finalization', {
          err: usageErr instanceof Error ? usageErr.message : String(usageErr),
          turnId,
        });
      }

      // The turn_end write itself is wrapped because the process may be in
      // a degraded state (disk full, mutex stuck, parent crashed). Losing
      // the write is bad but recoverable on next session-open by the
      // crash-recovery scan; throwing here would shadow the caught error.
      try {
        await writeAndAdvance({
          type: 'turn_end',
          data: {
            stopReason,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              costUsd: sessionCostUsd - previousSessionCostUsd,
            },
          },
        });
      } catch (writeErr) {
        logger.error('runner: turn_end write failed', {
          err: writeErr instanceof Error ? writeErr.message : String(writeErr),
          turnId,
          stopReason,
        });
      }
    }

    if (caughtError !== undefined) {
      throw caughtError;
    }

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
    runtimeFileAccessTracker: FileAccessTracker;
    envOverlay?: Record<string, string>;
    abortController: AbortController;
    turnId: string;
    startedAt: string;
    sessionId: string;
    runtimeBinding: RuntimeExecutionBinding;
    writeAndAdvance: (event: { type: string; data: Record<string, unknown> }) => Promise<void>;
  }): Promise<{
    streamTurnSeq: number;
    coreResult: CoreToolResult;
    shouldContinue: boolean;
    /**
     * Set when this tool call ended the turn for a reason the main loop must
     * surface as a distinct stopReason. Today only 'permission_cancelled' is
     * used (kata #37) — the permission request threw, the tool never ran, and
     * the parent must be able to tell this apart from a clean end_turn.
     */
    cancelReason?: 'permission_cancelled';
  }> {
    const {
      toolCall,
      executionMode,
      approvalMode,
      cwd,
      filesRead,
      runtimeFileAccessTracker,
      envOverlay,
      abortController,
      turnId,
      startedAt: _startedAt,
      sessionId,
      runtimeBinding,
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
      const parsedBashInput = bashSchema.safeParse(toolInput);
      if (!parsedBashInput.success) {
        const validationMessage = parsedBashInput.error.issues
          .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
          .join('\n');
        const failed: ToolResult = {
          outcome: 'failed',
          content: [{ type: 'error', message: validationMessage }],
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
            content: [{ type: 'text', text: validationMessage }],
          },
          shouldContinue: false,
        };
      }

      const { command, description, progressIntervalMs } = parsedBashInput.data;
      // Forward operator-configured progressIntervalMs (PRI-1707) — without
      // this, the bash tool's schema-documented progressIntervalMs is
      // silently dropped here and the job's progress timer never arms.
      const { jobId } = await this.deps.startShellJob({
        command,
        description: description || command.substring(0, 50),
        turnContext: { turnId, turnSeq: toolTurnSeq },
        runtimeBinding,
        ...(progressIntervalMs !== undefined ? { progressIntervalMs } : {}),
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
          cancelReason: 'permission_cancelled',
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
      runtimeFileAccessTracker,
      envOverlay,
      abortController,
      turnId,
      runtimeBinding,
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
    toolExecutor: {
      execute: (toolCall: ToolCall, context: ToolContext) => Promise<CoreToolResult>;
    };
    cwd: string;
    filesRead: Set<string>;
    runtimeFileAccessTracker: FileAccessTracker;
    envOverlay?: Record<string, string>;
    abortController: AbortController;
    turnId: string;
    runtimeBinding: RuntimeExecutionBinding;
  }): Promise<CoreToolResult> {
    const {
      toolName,
      toolCallId,
      finalInput,
      toolTurnSeq,
      toolExecutor,
      cwd,
      filesRead,
      runtimeFileAccessTracker,
      envOverlay,
      abortController,
      turnId,
      runtimeBinding,
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
    const runtime = this.createRuntime(runtimeBinding, envOverlay);
    const markRuntimeFileRead = (path: RuntimePath): void => {
      runtimeFileAccessTracker.markRead(path, runtime.paths.canonicalKey(path));
      const hostPath = path.hostPath ?? (runtime.kind === 'host' ? path.runtimePath : undefined);
      if (hostPath) filesRead.add(isAbsolutePath(hostPath) ? hostPath : resolvePath(cwd, hostPath));
    };

    return await toolExecutor.execute(
      { id: toolCallId, name: toolName, arguments: finalInput },
      {
        signal: abortController.signal,
        workingDirectory: cwd,
        runtime,
        runtimeBinding,
        toolTempRoot: join(this.config.sessionDir, 'tool-temp'),
        processEnv: envOverlay,
        hasRuntimeFileBeenRead: (path) =>
          runtimeFileAccessTracker.hasRead(path, runtime.paths.canonicalKey(path)),
        markFileRead: markRuntimeFileRead,
        turnId,
        turnSeq: toolTurnSeq,
        ...(this.deps.reminderScheduler ? { reminderScheduler: this.deps.reminderScheduler } : {}),
        ...(this.deps.activeSessionId ? { activeSessionId: this.deps.activeSessionId } : {}),
        activeSessionDir: this.config.sessionDir,
        ...(this.deps.containerMounts ? { containerMounts: this.deps.containerMounts } : {}),
        ...(this.deps.perInvocationReaper
          ? { perInvocationReaper: this.deps.perInvocationReaper }
          : {}),
      }
    );
  }

  private resolveActiveRuntimeBinding(cwd: string): RuntimeExecutionBinding {
    const runtimeBinding =
      this.config.runtimeBinding ??
      buildDefaultBoundedHostRuntimeBinding({
        sessionId: this.config.sessionId,
        cwd,
      });

    return runtimeBinding;
  }

  private createRuntime(
    runtimeBinding: RuntimeExecutionBinding,
    envOverlay?: Record<string, string>
  ): ToolRuntime {
    return createToolRuntimeFromBinding({
      binding: runtimeBinding,
      env: envOverlay,
      containerManager: this.deps.containerManager,
      sessionId: this.config.sessionId,
      secretResolver: this.deps.runtimeSecretResolver,
    });
  }

  private async createFileAccessTracker(
    filesRead: Set<string>,
    runtimeBinding: RuntimeExecutionBinding
  ): Promise<FileAccessTracker> {
    const tracker = new FileAccessTracker();
    const runtime = this.createRuntime(runtimeBinding);

    for (const filePath of filesRead) {
      const runtimePath = await runtime.paths.resolve(filePath);
      tracker.markRead(runtimePath, runtime.paths.canonicalKey(runtimePath));
    }

    return tracker;
  }

  /**
   * Cancel any in-progress operation.
   */
  cancel(): void {
    // The abort controller is passed in via RunParams
    // The caller is responsible for aborting it
  }
}
