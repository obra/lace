// ABOUTME: Canonical LaceStopReason types and per-provider stop-reason normalizers
// ABOUTME: Maps each provider's stop-reason surface into a single unified canonical form

import { logger } from '@lace/agent/utils/logger';

/**
 * Canonical stop reasons. Every provider's stop surface normalizes into one of
 * these values. The set is deliberately small — interface code, telemetry, and
 * compaction logic only need this enum to make decisions; provider-specific
 * detail lives in `LaceStopDetails`.
 */
export type LaceStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'stop_sequence'
  | 'max_output_tokens'
  | 'context_window_exceeded'
  | 'refusal'
  | 'pause_turn'
  | 'cancelled'
  | 'permission_cancelled'
  | 'max_turns'
  | 'budget_exceeded'
  | 'incomplete'
  | 'failed';

/**
 * Structured detail accompanying a `LaceStopReason`. The discriminator `type`
 * matches a subset of `LaceStopReason` values where extra context is useful.
 * Stop reasons that need no extra context (e.g. `end_turn`, `tool_use`) have
 * `stopDetails: null`.
 *
 * The `source` field is informational provenance — it identifies *where* the
 * mapping decision came from. Useful for debugging and for downstream code
 * that wants to distinguish e.g. "OpenAI Chat content_filter" from "OpenAI
 * Responses content_filter".
 */
export type LaceStopDetails =
  | {
      type: 'refusal';
      category: string | null;
      explanation: string | null;
      source:
        | 'anthropic_classifier'
        | 'openai_chat_content_filter'
        | 'openai_responses_content_filter'
        | 'openai_responses_refusal_item';
    }
  | {
      type: 'context_window_exceeded';
      source:
        | 'anthropic_beta_stop_reason'
        | 'http_400_prompt_too_long'
        | 'preflight_token_estimate';
      estimatedExcessTokens?: number;
    }
  | {
      type: 'max_output_tokens';
      source:
        | 'anthropic_stop_reason'
        | 'openai_chat_finish_reason'
        | 'openai_responses_incomplete_details';
      requestedMaxTokens?: number;
    }
  | { type: 'stop_sequence'; sequence: string; source: 'anthropic_stop_sequence' }
  | { type: 'pause_turn'; source: 'anthropic_stop_reason' }
  | {
      type: 'failed';
      code: string;
      message: string;
      source: 'openai_responses_failed_status' | 'http_error';
    }
  | { type: 'cancelled'; reason: 'abort_signal' | 'permission_cancelled' };

/**
 * Bundle returned by every normalizer. Always populated — `stopDetails: null`
 * when the canonical reason needs no extra context.
 */
export interface NormalizedStop {
  stopReason: LaceStopReason;
  stopDetails: LaceStopDetails | null;
}

/**
 * Anthropic raw `stop_details` shape — we only consume the refusal variant.
 * Kept structural (not a `Anthropic.SomeType` import) so this module has no
 * SDK dependency.
 */
interface AnthropicRefusalStopDetails {
  type: 'refusal';
  category: string | null;
  explanation: string | null;
}

/**
 * Normalize an Anthropic Messages API `stop_reason` (both base and beta) into
 * the canonical form. `source` is informational — Bedrock and direct Anthropic
 * currently use the same mapping; the parameter is reserved for future use if
 * we need to distinguish (e.g. omitting `model_context_window_exceeded` on
 * Bedrock when it doesn't ship the beta).
 */
export function normalizeAnthropicStop(
  stopReason: string | null | undefined,
  stopDetails: AnthropicRefusalStopDetails | null | undefined,
  stopSequence: string | null | undefined,
  source: 'anthropic_direct' | 'bedrock'
): NormalizedStop {
  // `source` retained as part of the API surface for forwards compatibility;
  // referenced here to suppress unused-var lint without changing semantics.
  void source;

  switch (stopReason) {
    case 'end_turn':
      return { stopReason: 'end_turn', stopDetails: null };

    case 'max_tokens':
      return {
        stopReason: 'max_output_tokens',
        stopDetails: { type: 'max_output_tokens', source: 'anthropic_stop_reason' },
      };

    case 'tool_use':
      return { stopReason: 'tool_use', stopDetails: null };

    case 'stop_sequence':
      return {
        stopReason: 'stop_sequence',
        stopDetails: {
          type: 'stop_sequence',
          sequence: stopSequence ?? '',
          source: 'anthropic_stop_sequence',
        },
      };

    case 'pause_turn':
      return {
        stopReason: 'pause_turn',
        stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
      };

    case 'refusal':
      return {
        stopReason: 'refusal',
        stopDetails: {
          type: 'refusal',
          category: stopDetails?.category ?? null,
          explanation: stopDetails?.explanation ?? null,
          source: 'anthropic_classifier',
        },
      };

    case 'model_context_window_exceeded':
      return {
        stopReason: 'context_window_exceeded',
        stopDetails: {
          type: 'context_window_exceeded',
          source: 'anthropic_beta_stop_reason',
        },
      };

    default:
      logger.warn('Unknown Anthropic stop_reason, falling back to end_turn', {
        stopReason,
        source,
      });
      return { stopReason: 'end_turn', stopDetails: null };
  }
}

/**
 * Normalize an OpenAI Chat Completions `finish_reason` into the canonical
 * form.
 *
 * Note on null/undefined: the streaming response emits chunks with
 * `finish_reason: null` until the terminal chunk. Callers should not invoke
 * this normalizer for non-terminal chunks, but for safety we accept the value
 * and return `end_turn` without warning — it's not malformed, just non-terminal.
 */
export function normalizeOpenAIChatStop(finishReason: string | null | undefined): NormalizedStop {
  if (finishReason === null || finishReason === undefined) {
    return { stopReason: 'end_turn', stopDetails: null };
  }

  switch (finishReason) {
    case 'stop':
      return { stopReason: 'end_turn', stopDetails: null };

    case 'length':
      return {
        stopReason: 'max_output_tokens',
        stopDetails: {
          type: 'max_output_tokens',
          source: 'openai_chat_finish_reason',
        },
      };

    case 'tool_calls':
      return { stopReason: 'tool_use', stopDetails: null };

    case 'content_filter':
      return {
        stopReason: 'refusal',
        stopDetails: {
          type: 'refusal',
          category: null,
          explanation: null,
          source: 'openai_chat_content_filter',
        },
      };

    case 'function_call':
      logger.warn('Legacy function_call finish_reason encountered, mapping to tool_use', {
        finishReason,
      });
      return { stopReason: 'tool_use', stopDetails: null };

    default:
      logger.warn('Unknown OpenAI Chat finish_reason, falling back to end_turn', {
        finishReason,
      });
      return { stopReason: 'end_turn', stopDetails: null };
  }
}

/**
 * Shape of the `incomplete_details` field on the OpenAI Responses API
 * `response` object. We only consume `reason`.
 */
interface OpenAIResponsesIncompleteDetails {
  reason: string;
}

/**
 * Shape of the `error` field on the OpenAI Responses API `response` object
 * when `status === 'failed'`.
 */
interface OpenAIResponsesError {
  code: string;
  message: string;
}

/**
 * Normalize an OpenAI Responses API terminal `response.status` (plus
 * accompanying context) into the canonical form.
 *
 * Precedence is LOAD-BEARING:
 *   1. Refusal item emitted during stream wins over everything else.
 *   2. `status: 'completed'` + tool output → `tool_use`.
 *   3. `status: 'completed'` alone → `end_turn`.
 *   4. `status: 'incomplete'` with reason → max_output_tokens / refusal.
 *   5. `status: 'failed'` with error.code → `failed`.
 *   6. `status: 'cancelled'` → `cancelled`.
 *   7. `queued` / `in_progress` → `end_turn` + WARN (provider shouldn't have
 *      returned yet).
 *   8. Anything else → `failed` with `unknown_status` + WARN.
 */
export function normalizeOpenAIResponsesStop(
  status: string,
  incompleteDetails: OpenAIResponsesIncompleteDetails | null | undefined,
  error: OpenAIResponsesError | null | undefined,
  refusalEmittedDuringStream: string | null | undefined,
  hasFunctionToolCallOutput: boolean
): NormalizedStop {
  // 1. Refusal item beats everything (including completed status).
  if (refusalEmittedDuringStream) {
    return {
      stopReason: 'refusal',
      stopDetails: {
        type: 'refusal',
        category: null,
        explanation: refusalEmittedDuringStream,
        source: 'openai_responses_refusal_item',
      },
    };
  }

  if (status === 'completed') {
    // 2. completed + tool wins over completed alone
    if (hasFunctionToolCallOutput) {
      return { stopReason: 'tool_use', stopDetails: null };
    }
    // 3. completed alone
    return { stopReason: 'end_turn', stopDetails: null };
  }

  if (status === 'incomplete') {
    // 4. incomplete reasons
    if (incompleteDetails?.reason === 'max_output_tokens') {
      return {
        stopReason: 'max_output_tokens',
        stopDetails: {
          type: 'max_output_tokens',
          source: 'openai_responses_incomplete_details',
        },
      };
    }
    if (incompleteDetails?.reason === 'content_filter') {
      return {
        stopReason: 'refusal',
        stopDetails: {
          type: 'refusal',
          category: null,
          explanation: null,
          source: 'openai_responses_content_filter',
        },
      };
    }
    // Unknown incomplete reason — fall through to default warn path
  }

  // 5. failed with error.code
  if (status === 'failed' && error?.code) {
    return {
      stopReason: 'failed',
      stopDetails: {
        type: 'failed',
        code: error.code,
        message: error.message,
        source: 'openai_responses_failed_status',
      },
    };
  }

  // 6. cancelled
  if (status === 'cancelled') {
    return {
      stopReason: 'cancelled',
      stopDetails: {
        type: 'cancelled',
        reason: 'abort_signal',
      },
    };
  }

  // 7. queued / in_progress — non-terminal
  if (status === 'queued' || status === 'in_progress') {
    logger.warn(
      'OpenAI Responses non-terminal status encountered at normalize time, mapping to end_turn',
      { status }
    );
    return { stopReason: 'end_turn', stopDetails: null };
  }

  // 8. unknown
  logger.warn('Unknown OpenAI Responses status, mapping to failed/unknown_status', { status });
  return {
    stopReason: 'failed',
    stopDetails: {
      type: 'failed',
      code: 'unknown_status',
      message: status,
      source: 'openai_responses_failed_status',
    },
  };
}

/**
 * Normalize an LMStudio stop value into the canonical form. LMStudio's surface
 * is minimal — `tool_use`, `stop`, or unknown.
 */
export function normalizeLMStudioStop(rawStop: string | null | undefined): NormalizedStop {
  if (rawStop === 'tool_use') {
    return { stopReason: 'tool_use', stopDetails: null };
  }
  if (rawStop === 'stop') {
    return { stopReason: 'end_turn', stopDetails: null };
  }
  logger.warn('Unknown LMStudio stop value, falling back to end_turn', { rawStop });
  return { stopReason: 'end_turn', stopDetails: null };
}

/**
 * Set of canonical LaceStopReason values, built once at module load so the
 * legacy normalizer can validate inputs in O(1) without rebuilding on every
 * call. Kept in sync with the `LaceStopReason` union above.
 */
const CANONICAL_STOP_REASONS: ReadonlySet<LaceStopReason> = new Set<LaceStopReason>([
  'end_turn',
  'tool_use',
  'stop_sequence',
  'max_output_tokens',
  'context_window_exceeded',
  'refusal',
  'pause_turn',
  'cancelled',
  'permission_cancelled',
  'max_turns',
  'budget_exceeded',
  'incomplete',
  'failed',
]);

/**
 * Map a legacy stop-reason string (read from historical `turn_end` events) to
 * its canonical equivalent. The only renamed value is `max_tokens` →
 * `max_output_tokens`; everything else should already be canonical.
 *
 * Values that don't match the canonical set after rewrite produce a WARN and
 * fall back to `end_turn`. This protects downstream code from drifted legacy
 * events injecting invalid `LaceStopReason` values into telemetry / UI logic.
 *
 * This exists so consumers reading old events get canonical values without
 * needing per-call-site rewrites.
 */
export function normalizeLegacyStopReason(legacyValue: string): LaceStopReason {
  const rewritten = legacyValue === 'max_tokens' ? 'max_output_tokens' : legacyValue;
  if (CANONICAL_STOP_REASONS.has(rewritten as LaceStopReason)) {
    return rewritten as LaceStopReason;
  }
  logger.warn('Unknown legacy stop reason, falling back to end_turn', { legacyValue });
  return 'end_turn';
}
