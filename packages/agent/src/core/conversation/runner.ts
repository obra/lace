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
import { digestToolResultText } from '@lace/agent/tools/result-digest';
import { writeToolResultSidecar } from '@lace/agent/storage/tool-result-store';
import {
  toNonEmptyString,
  toolKindFromName,
  protocolToolResultFromCore,
  shouldAskPermission,
} from '@lace/agent/rpc/utils';
import type { RunnerConfig, RunnerDependencies, RunParams, RunResult, ApprovalMode } from './types';
import type {
  BetaCacheMissReason,
  LaceStopDetails,
  RequestOptions,
  ThinkingBlock,
} from '@lace/agent/providers/base-provider';
import { EntErrorCodes } from '@lace/ent-protocol';
import { logger } from '@lace/agent/utils/logger';
import { computePressure, evaluateBreakpoints } from './compaction-trigger';
import { resolveCompactionStrategy, validatePreserved } from '@lace/agent/compaction/strategy';
import {
  compactionStrategyNameForSession,
  compactionBreakpointsForSession,
} from '@lace/agent/compaction/select';
import { buildCompactionContext } from '@lace/agent/compaction/build-context';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import { injectNotification } from '@lace/agent/notifications/inject-notification';

/**
 * Non-enumerable sentinel applied to errors thrown out of `executeToolCall`.
 * Lets `mapErrorToStopReason` distinguish a tool throw from a provider throw
 * without inspecting the loop's lexical state. The field is non-enumerable so
 * it doesn't pollute JSON serialization of the error.
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
  // The Anthropic / OpenAI SDKs throw subclasses whose constructor name ends
  // in "APIError" — recognise those even if no envelope wrap fired.
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

/**
 * Pick a stopReason for an error caught out of `runner.run()`'s agentic loop.
 *
 * Order of classification:
 * 1. Tool-phase throws (tagged via `tagAsToolError` when `executeToolCall`
 *    threw) map to `tool_error_*` — timeout-looking errors become
 *    `tool_error_timeout`, everything else `tool_error_throw`.
 * 2. Provider-phase throws (the ProviderError envelope thrown after
 *    `createStreamingResponse` fails, plus anything that escapes to
 *    `runner.run()` bearing provider-shaped fields) map to `provider_error_*`
 *    by inspecting the message and well-known err codes.
 * 3. Plain network errors thrown from anywhere also map to
 *    `provider_error_network` since the only network call in the loop is the
 *    provider call.
 * 4. Everything else is `internal_error`.
 *
 * Message-string matching is intentionally permissive: the production samples
 * in scratch/turn-aborts/classified.csv show Anthropic SDK errors arrive as
 * plain Error objects with the upstream JSON body baked into the message, so
 * substring tests catch the realistic shapes (`overloaded_error`,
 * `invalid_request_error`, `model: opus`, `invalid proxy path`, etc.).
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

  if (looksLikeNetworkError(err)) {
    return 'provider_error_network';
  }

  return 'internal_error';
}

// First-person future-tense intent markers. When the model emits one of these
// on a text-only turn following a tool round-trip, it has declared work it has
// not actually performed (kata #31 round 2: production "I'll add a brief note"
// pattern). Past-tense completion summaries ("Done. Updated successfully.") and
// pure-answer text ("The answer is 42.") deliberately do NOT match.
const FUTURE_TENSE_INTENT_PATTERN =
  /\b(?:I'll|I will|I'm going to|I am going to|let me|let's|I shall|I'll just|I'll go ahead|going to add|going to write|going to update|going to create)\b/i;

/**
 * Safety bound on transparent `pause_turn` auto-resumes within a single logical
 * turn. Anthropic surfaces `pause_turn` when a long-running turn hits an
 * internal time slice; the runner re-feeds the partial assistant turn back to
 * the provider to continue generation. A pathological loop where the provider
 * never advances past `pause_turn` would spin forever without this bound — we
 * permit exactly `MAX_PAUSE_RESUMES` successful resumes; the next (i.e. the
 * `MAX_PAUSE_RESUMES + 1`th) consecutive pause surfaces a `'failed'` stop with
 * `code: 'pause_turn_loop'`.
 */
const MAX_PAUSE_RESUMES = 10;

const CLEAN_STOP_REASONS = new Set(['end_turn', 'stop_sequence', 'max_turns']);

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
 * Cap an oversized tool result in place. The text content blocks are concatenated
 * and digested; if anything was elided, the full payload is spilled to a per-session
 * sidecar (when a sessionId is available) and the text blocks are replaced with a
 * single digest block. Non-text blocks (images, resources) are preserved and never
 * measured. Results at or below the ride-whole budget are left untouched.
 *
 * `read_tool_result`'s own output is excluded: it is already bounded by its args,
 * and digesting it would defeat paging through the sidecar.
 */
function capToolResult(params: {
  coreResult: CoreToolResult;
  toolName: string;
  toolCallId: string;
  sessionId: string;
}): void {
  const { coreResult, toolName, toolCallId, sessionId } = params;
  if (toolName === 'read_tool_result') return;

  const content = coreResult.content;
  if (!Array.isArray(content) || content.length === 0) return;

  const textBlocks = content.filter((b) => b.type === 'text' && typeof b.text === 'string');
  if (textBlocks.length === 0) return;

  const fullText = textBlocks.map((b) => b.text ?? '').join('');
  const digest = digestToolResultText(fullText, toolCallId);
  if (digest.elidedBytes === 0) return;

  // Spill the full payload to the sidecar so read_tool_result can page it back.
  // Without a sessionId we can't place the sidecar; still inline-truncate so the
  // cap holds, but skip writing a stray file.
  if (sessionId) {
    try {
      writeToolResultSidecar(sessionId, toolCallId, fullText);
    } catch (err) {
      logger.error('runner: failed to write tool-result sidecar', {
        err: err instanceof Error ? err.message : String(err),
        toolName,
        toolCallId,
      });
    }
  }

  // Replace the run of text blocks with a single digest block, preserving any
  // non-text blocks (and their relative order against the digest's position).
  const nonTextBlocks = content.filter((b) => !(b.type === 'text' && typeof b.text === 'string'));
  coreResult.content = [{ type: 'text', text: digest.text }, ...nonTextBlocks];
}

/**
 * Read durable events newer than `afterEventSeq` and return any
 * priority='immediate' context_injected events plus the highest eventSeq seen.
 *
 * A sessionPrompt can be in flight while a peer
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
    // Native structured outputs: the prompt handler validated this shape
    // ({ type: 'json_schema', schema }) before constructing the runner, so the
    // cast is safe. Threaded into every provider call's RequestOptions below.
    const runOutputFormat = params.outputFormat as RequestOptions['outputFormat'] | undefined;
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

    // Track token usage across the turn. Track all four Anthropic
    // categories so events.jsonl carries the full breakdown — without
    // cache_creation/cache_read, cost reconstruction from disk under-counts
    // by ~70% on heavily-cached workloads.
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreationInputTokens = 0;
    let totalCacheReadInputTokens = 0;
    // Per-call snapshot of the LAST response's input + cache fields. Overwritten
    // each call; the final value reflects the model's most recent on-the-wire
    // context size. Used by the track-based compaction trigger.
    let lastCallInputTokens = 0;
    let lastCallCacheCreationInputTokens = 0;
    let lastCallCacheReadInputTokens = 0;
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
    // silently skipped.
    let lastSeenEventSeq = findLastTurnEndEventSeq(sessionDir) ?? 0;
    let finalAssistantContent = '';
    let stopReason: RunResult['stopReason'] = 'end_turn';
    let stopDetails: LaceStopDetails | null = null;
    // Captured by the outer catch and rethrown after the finally
    // block so the turn_end write always runs. `undefined` means the loop
    // completed cleanly and there is nothing to rethrow.
    let caughtError: unknown;

    let streamTurnSeq = 0;
    let completedTurns = 0;

    // Bare text retry: when the model returns no tool calls, retry once with
    // tool_choice=required to force a verification tool call (catches
    // NEVER_SUBMITTED pattern where model says "Done" instead of verifying)
    let retriedWithToolChoice = false;
    let nextRequestOptions: RequestOptions | undefined;
    // Carries forward the parsed structured object from the last provider
    // response that produced one, surfaced on the RunResult for the prompt
    // handler. Only set when this turn requested an outputFormat.
    let lastStructuredOutput: unknown;
    let lastResponseId: string | undefined;
    // Cache-diagnosis-2026-04-07 only meaningful on Anthropic-direct. We carry
    // forward the LAST provider response's cache_miss_reason for this turn so
    // turn_end records whether the most recent request hit the cache. Inner
    // tool-use loop iterations within the same turn reuse the same prefix, so
    // their miss reasons would not be a meaningful "vs previous request"
    // comparison — we intentionally drop them.
    let lastCacheMissReason: BetaCacheMissReason | null | undefined = undefined;

    // pause_turn auto-resume bookkeeping. `partialAssistantText` accumulates
    // text fragments across consecutive `pause_turn` iterations so the durable
    // 'message' event for the logical turn is written ONCE at non-pause
    // completion with the full concatenated text. `pauseResumeCount` enforces
    // MAX_PAUSE_RESUMES and is reset on every non-pause iteration.
    let partialAssistantText = '';
    // Thinking blocks accumulate across pause_turn iterations alongside the text,
    // so the single durable 'message' event carries the full reasoning for the
    // logical turn. Reset on every non-pause iteration (mirrors partialAssistantText).
    let partialThinkingBlocks: ThinkingBlock[] = [];
    let pauseResumeCount = 0;

    // Per-turn compaction request cell. compact_session mutates this during
    // tool execution; the post-turn block reads it to decide whether to fire.
    // A single shared object is used so the tool (which receives the same
    // reference via ToolContext) mutates the runner's local state in place.
    const compactionRequest: { requested: boolean; guidance?: string } = { requested: false };

    try {
      for (; completedTurns < maxTurns; completedTurns++) {
        // Pick up any priority='immediate' context_injected events
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
        // stuck loops. Revised after adversarial review: push
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
          // Merge the turn-level outputFormat into the per-call options. Unlike
          // nextRequestOptions (a one-shot tool_choice nudge), outputFormat
          // applies to every call this turn so the final answer stays
          // schema-constrained even after tool-use iterations.
          const requestOptions: RequestOptions | undefined = runOutputFormat
            ? { ...nextRequestOptions, outputFormat: runOutputFormat }
            : nextRequestOptions;
          response = await provider.createStreamingResponse(
            providerMessages,
            toolsForProvider,
            modelId || 'unknown-model',
            abortController.signal,
            lastResponseId ? { previousResponseId: lastResponseId } : undefined,
            requestOptions
          );
          nextRequestOptions = undefined; // Reset after use
          if (response.structuredOutput !== undefined) {
            lastStructuredOutput = response.structuredOutput;
          }
          lastResponseId = response.responseId;
          lastCacheMissReason = response.cacheMissReason ?? null;
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
          const inputTokens = response.usage.promptTokens ?? 0;
          const outputTokens = response.usage.completionTokens ?? 0;
          const cacheCreationInputTokens = response.usage.cacheCreationInputTokens ?? 0;
          const cacheReadInputTokens = response.usage.cacheReadInputTokens ?? 0;

          totalInputTokens += inputTokens;
          totalOutputTokens += outputTokens;
          totalCacheCreationInputTokens += cacheCreationInputTokens;
          totalCacheReadInputTokens += cacheReadInputTokens;
          lastCallInputTokens = inputTokens;
          lastCallCacheCreationInputTokens = cacheCreationInputTokens;
          lastCallCacheReadInputTokens = cacheReadInputTokens;

          // Real cache-aware cost. Anthropic bills cache_creation
          // at a premium over base input, cache_read at a steep discount.
          // Pre-cache-aware code computed `input * costPer1mIn` only, which
          // happens to coincide with reality on the cold-cache path but
          // under-counts dramatically once the cache is warm. Catalog
          // entries without cache pricing collapse to base input rate.
          if (modelPricing) {
            const inputCost = (inputTokens / 1_000_000) * modelPricing.costPer1mIn;
            const outputCost = (outputTokens / 1_000_000) * modelPricing.costPer1mOut;
            const cacheCreationCost =
              (cacheCreationInputTokens / 1_000_000) * modelPricing.costPer1mCacheCreation;
            const cacheReadCost =
              (cacheReadInputTokens / 1_000_000) * modelPricing.costPer1mCacheRead;
            sessionCostUsd += inputCost + outputCost + cacheCreationCost + cacheReadCost;
          }
        }

        // Check budget before continuing
        if (maxBudgetUsd && maxBudgetUsd > 0 && sessionCostUsd > maxBudgetUsd) {
          stopReason = 'budget_exceeded';
        }

        const assistantText = typeof response.content === 'string' ? response.content : '';

        if (!streamedAny && assistantText.length > 0) {
          await this.deps.onUpdate(messageTurnSeq, { type: 'text_delta', text: assistantText });
        }

        // Accumulate text across consecutive pause_turn iterations so the
        // durable 'message' event is written ONCE at logical-turn end with the
        // full concatenated text. On non-pause iterations this still records
        // only the current iteration's text (partialAssistantText is empty).
        const concatenatedAssistantText = partialAssistantText + assistantText;
        finalAssistantContent = concatenatedAssistantText;

        // Accumulate this iteration's thinking blocks with any carried over from
        // prior pause_turn iterations. Persisted on the single 'message' event so
        // the next turn can replay them before the turn's text/tool_use.
        const iterationThinkingBlocks = Array.isArray(response.thinkingBlocks)
          ? response.thinkingBlocks
          : [];
        const concatenatedThinkingBlocks = [...partialThinkingBlocks, ...iterationThinkingBlocks];

        // Defer the durable 'message' event when the provider is asking us to
        // auto-resume (pause_turn). Writing the partial would surface mid-turn
        // text fragments as durable events and break the invariant of one
        // assistant message per logical turn. The non-pause branch below
        // writes the full concatenated text exactly once.
        const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
        if (response.stopReason !== 'pause_turn') {
          // Store content in array format (standard content block format).
          // Only persist if there is actual content — an empty assistant turn would
          // produce a {role:'assistant', content:''} when rebuilt, which creates
          // consecutive user/user messages after the format-converter drops the
          // empty block. Anthropic's API rejects consecutive same-role messages.
          const contentBlocks = concatenatedAssistantText
            ? [{ type: 'text', text: concatenatedAssistantText }]
            : [];
          // Persist the turn when it has text OR thinking blocks. A tool-only
          // turn (no text) still needs its 'message' event when thinking is
          // present, so the rebuilt assistant message carries the thinking that
          // must precede its tool_use blocks. A turn with neither is skipped (an
          // empty {role:'assistant'} would create consecutive same-role messages).
          if (contentBlocks.length > 0 || concatenatedThinkingBlocks.length > 0) {
            await writeAndAdvance({
              type: 'message',
              data: {
                content: contentBlocks,
                ...(concatenatedThinkingBlocks.length > 0
                  ? { thinkingBlocks: concatenatedThinkingBlocks }
                  : {}),
              },
            });
          }
        }

        // Dispatch on the provider's canonical stopReason. Terminal stops other
        // than 'tool_use' / 'end_turn' exit the loop here; the existing
        // tool-execution path runs only when stopReason === 'tool_use'.
        switch (response.stopReason) {
          case 'refusal':
          case 'context_window_exceeded':
          case 'max_output_tokens':
          case 'stop_sequence': {
            // Preserve any pending tool_use blocks the model emitted before the
            // stop. They land in the durable event log alongside a synthetic
            // cancelled tool_result so:
            //   1. The UI can show what the model intended (the tool_use is
            //      still durable with its input).
            //   2. The next turn's rebuilt provider message history stays
            //      valid — every assistant tool_use is paired with a
            //      tool_result, which Anthropic / OpenAI require.
            // The synthetic result uses outcome='cancelled' (closest match in
            // the ToolResult outcome enum) with explanatory text that names
            // the terminal stopReason. The result is NOT routed through the
            // provider as a real tool execution — it exists purely so the
            // durable log can be rebuilt into valid provider input.
            const cancelledNote = `<tool not executed: turn stopped with reason ${response.stopReason}>`;
            for (const toolCall of toolCalls) {
              const toolCallId = toNonEmptyString(toolCall.id);
              const toolName = toNonEmptyString(toolCall.name);
              if (!toolCallId || !toolName) continue;
              const toolInput =
                typeof toolCall.arguments === 'object' && toolCall.arguments
                  ? (toolCall.arguments as Record<string, unknown>)
                  : {};
              const syntheticResult: ToolResult = {
                outcome: 'cancelled',
                content: [{ type: 'text', text: cancelledNote }],
              };
              await writeAndAdvance({
                type: 'tool_use',
                data: {
                  toolCallId,
                  name: toolName,
                  kind: toolKindFromName(toolName),
                  input: toolInput,
                  result: syntheticResult,
                },
              });
            }
            stopReason = response.stopReason;
            stopDetails = response.stopDetails ?? null;
            break;
          }
          case 'failed':
            throw {
              code: EntErrorCodes.ProviderError,
              message:
                response.stopDetails?.type === 'failed'
                  ? response.stopDetails.message
                  : 'Provider request failed',
              data: { category: 'provider', stopDetails: response.stopDetails ?? null },
            };
          case 'pause_turn': {
            // Anthropic surfaced pause_turn — re-feed the partial assistant
            // turn back to the provider so it can resume generation. The
            // durable 'message' event has been intentionally skipped above;
            // we accumulate partialAssistantText and write once when the turn
            // finally ends with a non-pause stopReason. Pause iterations do
            // NOT count against maxTurns — we cancel out the for-loop's
            // increment below.
            pauseResumeCount++;
            // MAX_PAUSE_RESUMES=10 means 10 successful resumes are allowed;
            // the 11th consecutive pause throws. Using `>` (not `>=`) so the
            // counter measures "how many pauses we've seen" and the check
            // fires only when that exceeds the budget.
            if (pauseResumeCount > MAX_PAUSE_RESUMES) {
              throw {
                code: EntErrorCodes.ProviderError,
                message: `pause_turn loop: ${MAX_PAUSE_RESUMES} consecutive pauses`,
                data: {
                  category: 'provider',
                  stopDetails: {
                    type: 'failed' as const,
                    code: 'pause_turn_loop',
                    message: `Provider returned pause_turn ${MAX_PAUSE_RESUMES} times in a row without advancing`,
                    source: 'http_error' as const,
                  },
                },
              };
            }
            partialAssistantText = concatenatedAssistantText;
            partialThinkingBlocks = concatenatedThinkingBlocks;
            // Anthropic rejects consecutive same-role messages. On the FIRST
            // pause of a logical turn we append a new assistant message; on
            // subsequent pauses we MERGE by replacing the last assistant
            // message with one that carries the concatenated text. We
            // intentionally DROP toolCalls because pause iterations execute
            // no tools — emitting tool_use blocks with no following
            // tool_result would cause Anthropic to 400 on the next request.
            // Thinking blocks are carried through so the resumed turn keeps its
            // own partial reasoning (replayed verbatim before any text).
            const last = providerMessages[providerMessages.length - 1];
            const mergedAssistant = {
              role: 'assistant' as const,
              content: concatenatedAssistantText,
              ...(concatenatedThinkingBlocks.length > 0
                ? { thinkingBlocks: concatenatedThinkingBlocks }
                : {}),
            };
            providerMessages =
              last?.role === 'assistant'
                ? [...providerMessages.slice(0, -1), mergedAssistant]
                : [...providerMessages, mergedAssistant];
            // Cancel the for-loop's `completedTurns++` so this pause doesn't
            // count as a logical turn against maxTurns.
            completedTurns--;
            continue;
          }
          case undefined:
          case 'end_turn':
          case 'tool_use':
          case 'cancelled':
          case 'permission_cancelled':
          case 'max_turns':
          case 'budget_exceeded':
          case 'incomplete':
            // These either continue the loop (tool_use / end_turn) or are
            // handled by the runner-derived paths below (cancelled,
            // permission_cancelled, budget_exceeded, etc.).
            // Reset pause-resume accounting: any non-pause iteration ends the
            // logical turn for pause-tracking purposes.
            pauseResumeCount = 0;
            partialAssistantText = '';
            partialThinkingBlocks = [];
            break;
          default:
            // A future provider may invent a new stopReason. Don't fall through
            // into the existing tool-execution path silently — log and exit.
            logger.warn('Unknown provider stopReason; treating as end_turn', {
              stopReason: response.stopReason,
            });
        }

        // Terminal provider stops (refusal / context_window_exceeded /
        // max_output_tokens / stop_sequence) exit the loop here. budget_exceeded
        // is set ABOVE the switch on every iteration; it is intentionally
        // allowed to fall through to the tool-execution path below so the
        // current turn's tool results get persisted before the next iteration's
        // budget check fires the actual break (line ~615).
        if (
          stopReason === 'refusal' ||
          stopReason === 'context_window_exceeded' ||
          stopReason === 'max_output_tokens' ||
          stopReason === 'stop_sequence'
        ) {
          break;
        }

        if (toolCalls.length === 0) {
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

        // Load-bearing safety check: execute tool calls ONLY when the provider's
        // canonical stop reason explicitly says so. Refusal / context_exceeded /
        // max_output_tokens / stop_sequence have already exited the loop above,
        // but this guard protects against any future stop reason slipping
        // through into the tool-execution path.
        if (response.stopReason === 'tool_use') {
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
                compactionRequest,
              });
            } catch (toolErr) {
              // Log at ERROR with toolName + toolCallId so the next
              // occurrence of message_then_no_tool_use surfaces in agent.log
              // (the 19 Ada cases had no error logged at all — the throw was
              // entirely silent). The outer catch + finally then produce the
              // turn_end(stopReason=tool_error_throw) for durability.
              logger.error('runner: executeToolCall threw', {
                err: toolErr instanceof Error ? toolErr.message : String(toolErr),
                toolName: typeof toolCall?.name === 'string' ? toolCall.name : 'unknown',
                toolCallId: typeof toolCall?.id === 'string' ? toolCall.id : 'unknown',
                turnId,
              });
              // Tag the throw so the outer catch's classifier can distinguish a
              // tool-phase failure from a provider-phase failure.
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
              // parent client has no handler, request races out in ~15ms)
              // the tool never ran. Surface that as a distinct stopReason so
              // subagent-job (and anything else mapping turn results to job
              // status) can mark the job as failed instead of silently
              // reporting 'completed' for a turn that lost its writes.
              if (result.cancelReason === 'permission_cancelled') {
                stopReason = 'permission_cancelled';
              }
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
      // Never let a throw skip the turn_end write. Capture the
      // error, derive a fine-grained stopReason from it, and let the finally
      // block close out the durable log. The error is rethrown after the
      // finally so callers (prompt.ts, the job layer, SDK consumers) still
      // see the failure rather than believing the run succeeded.
      caughtError = loopError;
      stopReason = mapErrorToStopReason(loopError);
    } finally {
      provider.cleanup();

      // The max_turns reclassification only applies when the loop completed
      // cleanly with end_turn. An error must not be relabelled max_turns just
      // because it threw on the last permitted iteration.
      if (stopReason === 'end_turn' && completedTurns >= maxTurns) {
        stopReason = 'max_turns';
      }

      // Update session usage even on failure so the cost we DID incur up to
      // the throw is recorded. Wrap in try/catch — the process may be dying
      // and a throw here would shadow the original error AND skip turn_end.
      const turnCostUsd = sessionCostUsd - previousSessionCostUsd;
      try {
        this.deps.updateSessionUsage({
          costDelta: sessionCostUsd - this.deps.getSessionCostUsd(),
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheCreationInputTokens: totalCacheCreationInputTokens,
          cacheReadInputTokens: totalCacheReadInputTokens,
        });
      } catch (usageErr) {
        logger.error('runner: updateSessionUsage failed during turn finalization', {
          err: usageErr instanceof Error ? usageErr.message : String(usageErr),
          turnId,
        });
      }

      // The turn_end write itself is wrapped because the process may be in a
      // degraded state (disk full, mutex stuck, parent crashed). Losing the
      // write is bad but recoverable on next session-open by the crash-
      // recovery scan; throwing here would shadow the caught
      // error.
      try {
        await writeAndAdvance({
          type: 'turn_end',
          data: {
            stopReason,
            stopDetails,
            cacheMissReason: lastCacheMissReason ?? null,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              cacheCreationInputTokens: totalCacheCreationInputTokens,
              cacheReadInputTokens: totalCacheReadInputTokens,
              lastCallInputContextTokens:
                lastCallInputTokens +
                lastCallCacheCreationInputTokens +
                lastCallCacheReadInputTokens,
              costUsd: turnCostUsd,
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

      // Compaction trigger. Runs synchronously in the runner's finally block
      // after the turn_end write. Uses the raw appendDurableEvent +
      // writeSessionState path (no writeAndAdvance) so we don't acquire a
      // nested runExclusive lock and deadlock. Failures are logged but never
      // abort the turn — pressure stays high and the next clean turn
      // re-evaluates. The clean-stop-reason gate below (compactionRequest gate
      // skips it) mirrors the prior shouldFireCompaction gate.
      try {
        const usage = {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheCreationInputTokens: totalCacheCreationInputTokens,
          cacheReadInputTokens: totalCacheReadInputTokens,
          lastCallInputContextTokens:
            lastCallInputTokens + lastCallCacheCreationInputTokens + lastCallCacheReadInputTokens,
          costUsd: turnCostUsd,
        };
        const contextWindowSize = provider.contextWindowForModel(modelId ?? 'default');
        const pressure = computePressure(usage, contextWindowSize);

        const isCleanStop = CLEAN_STOP_REASONS.has(stopReason);

        // Evaluate persona breakpoints (only on clean stops; compactionRequest
        // bypasses the clean-stop gate entirely so the agent can explicitly
        // request compaction at any stop reason).
        let breakpointCompactCrossed = false;
        if (isCleanStop) {
          const breakpoints = compactionBreakpointsForSession(sessionDir);
          const currentHighestFiredAt = readSessionState(sessionDir).highestFiredBreakpointAt ?? 0;
          const ev = evaluateBreakpoints({
            pressure,
            breakpoints,
            highestFiredAt: currentHighestFiredAt,
          });

          if (ev.reset) {
            // Pressure has dropped below all breakpoints: reset once-per-crossing state
            await this.deps.runExclusive(() => {
              const sessionState = readSessionState(sessionDir);
              writeSessionState(sessionDir, { ...sessionState, highestFiredBreakpointAt: 0 });
            });
          } else if (ev.fire?.action === 'notify') {
            // Notify action: inject a notification and persist the crossed level
            const pressurePct = Math.round(pressure * 100);
            await this.deps.runExclusive(() => {
              const sessionState = readSessionState(sessionDir);
              injectNotification({
                sessionDir,
                kind: 'compaction-pressure',
                attributes: { pressure: pressurePct },
                body: `Context window is ${pressurePct}% full. Consider wrapping up your current task or calling compact_session to compress the conversation history.`,
              });
              writeSessionState(sessionDir, {
                ...sessionState,
                highestFiredBreakpointAt: ev.nextHighestFiredAt,
              });
            });
          } else if (ev.fire?.action === 'compact') {
            breakpointCompactCrossed = true;
            // Persist the new highestFiredBreakpointAt — the compact path below
            // will read and write state under its own runExclusive.
            await this.deps.runExclusive(() => {
              const sessionState = readSessionState(sessionDir);
              writeSessionState(sessionDir, {
                ...sessionState,
                highestFiredBreakpointAt: ev.nextHighestFiredAt,
              });
            });
          }
        }

        if (compactionRequest.requested || breakpointCompactCrossed) {
          const allEvents = readDurableEvents(sessionDir, {
            limit: Number.MAX_SAFE_INTEGER,
          }).events;
          const strategy = resolveCompactionStrategy(
            this.config.persona ? compactionStrategyNameForSession(sessionDir) : 'track-based'
          );
          const compactionCtx = buildCompactionContext({
            threadId: sessionId,
            sessionDir,
            connectionId: this.config.connectionId,
            modelId: modelId ?? undefined,
            guidance: compactionRequest.guidance,
          });
          const raw = await strategy.compact(
            // DurableEvent.data is Record<string,unknown>; TypedDurableEvent.data
            // is the typed union. The shapes are identical on disk — this cast is
            // safe because the event-log writer and event-types agree on the wire
            // format.
            allEvents as unknown as TypedDurableEvent[],
            compactionCtx
          );
          const result = validatePreserved(raw);
          if (!('noop' in result)) {
            await this.deps.runExclusive(async () => {
              const sessionState = readSessionState(sessionDir);
              const { nextState } = appendDurableEvent(sessionDir, sessionState, {
                type: 'context_compacted',
                // ContextCompactedEventData satisfies Record<string,unknown>; the
                // cast here is the symmetric inverse of the one above.
                data: result.compactionEvent.data as Record<string, unknown>,
              });
              writeSessionState(sessionDir, nextState);
              // Re-render the persona (model + system prompt) from the current
              // persona file so the compacted session reflects the live persona.
              await this.deps.rerenderPersonaAfterCompaction?.();
            });
          }
        }
      } catch (compactionErr) {
        logger.error('runner: compaction failed', {
          err: compactionErr instanceof Error ? compactionErr.message : String(compactionErr),
          turnId,
          stopReason,
        });
        // No persistent disable. Pressure stays high; next turn re-evaluates.
      }
    }

    if (caughtError !== undefined) {
      throw caughtError;
    }

    const turnCostUsd = sessionCostUsd - previousSessionCostUsd;

    return {
      turnId,
      stopReason,
      stopDetails,
      content:
        finalAssistantContent.length > 0
          ? [{ type: 'text' as const, text: finalAssistantContent }]
          : [],
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheCreationInputTokens: totalCacheCreationInputTokens,
        cacheReadInputTokens: totalCacheReadInputTokens,
        lastCallInputContextTokens:
          lastCallInputTokens + lastCallCacheCreationInputTokens + lastCallCacheReadInputTokens,
        costUsd: turnCostUsd,
      },
      ...(lastStructuredOutput !== undefined ? { structuredOutput: lastStructuredOutput } : {}),
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
    compactionRequest: { requested: boolean; guidance?: string };
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
      compactionRequest,
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
      // Forward operator-configured progressIntervalMs — without
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
      compactionRequest,
    });

    // Cap how much a single tool result contributes to the live context AND the
    // durable transcript. Mutating coreResult here covers both downstream
    // consumers: the durable tool_use event (built from protocolToolResultFromCore
    // below) and the providerMessages append in the main loop. read_tool_result is
    // excluded — its output is already bounded by its args and digesting it would
    // defeat paging.
    capToolResult({ coreResult, toolName, toolCallId, sessionId });

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
    compactionRequest: { requested: boolean; guidance?: string };
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
      compactionRequest,
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
        ...(this.config.persona ? { persona: this.config.persona } : {}),
        ...(this.config.roleEnvironment ? { roleEnvironment: this.config.roleEnvironment } : {}),
        ...(this.config.credentialBrokerSocket
          ? { credentialBrokerSocket: this.config.credentialBrokerSocket }
          : {}),
        activeSessionDir: this.config.sessionDir,
        ...(this.deps.containerMounts ? { containerMounts: this.deps.containerMounts } : {}),
        ...(this.deps.workspaceReaper ? { workspaceReaper: this.deps.workspaceReaper } : {}),
        compactionRequest,
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
