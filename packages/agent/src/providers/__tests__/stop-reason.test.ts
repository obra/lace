// ABOUTME: Tests for canonical stop-reason normalizers (Anthropic, OpenAI Chat, OpenAI Responses, LMStudio, legacy)
// ABOUTME: Each row of spec §3 tables has a corresponding test asserting normalizer output

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeAnthropicStop,
  normalizeOpenAIChatStop,
  normalizeOpenAIResponsesStop,
  normalizeLMStudioStop,
  normalizeLegacyStopReason,
} from '../stop-reason';

// Mock logger so we can assert WARN calls without polluting test output
vi.mock('@lace/agent/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

import { logger } from '@lace/agent/utils/logger';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeAnthropicStop', () => {
  // §3.1 row 1
  it('maps end_turn to end_turn with null details', () => {
    expect(normalizeAnthropicStop('end_turn', null, null, 'anthropic_direct')).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
  });

  // §3.1 row 2
  it('maps max_tokens to max_output_tokens with anthropic_stop_reason source', () => {
    expect(normalizeAnthropicStop('max_tokens', null, null, 'anthropic_direct')).toEqual({
      stopReason: 'max_output_tokens',
      stopDetails: {
        type: 'max_output_tokens',
        source: 'anthropic_stop_reason',
      },
    });
  });

  // §3.1 row 3
  it('maps tool_use to tool_use with null details', () => {
    expect(normalizeAnthropicStop('tool_use', null, null, 'anthropic_direct')).toEqual({
      stopReason: 'tool_use',
      stopDetails: null,
    });
  });

  // §3.1 row 4a — stop_sequence with sequence field
  it('maps stop_sequence with sequence to stop_sequence + details', () => {
    expect(normalizeAnthropicStop('stop_sequence', null, '\n\nHuman:', 'anthropic_direct')).toEqual(
      {
        stopReason: 'stop_sequence',
        stopDetails: {
          type: 'stop_sequence',
          sequence: '\n\nHuman:',
          source: 'anthropic_stop_sequence',
        },
      }
    );
  });

  // §3.1 row 4b — stop_sequence without sequence field (null)
  it('maps stop_sequence without sequence field with null sequence in details', () => {
    expect(normalizeAnthropicStop('stop_sequence', null, null, 'anthropic_direct')).toEqual({
      stopReason: 'stop_sequence',
      stopDetails: {
        type: 'stop_sequence',
        sequence: '',
        source: 'anthropic_stop_sequence',
      },
    });
  });

  // §3.1 row 5
  it('maps pause_turn to pause_turn with anthropic_stop_reason source', () => {
    expect(normalizeAnthropicStop('pause_turn', null, null, 'anthropic_direct')).toEqual({
      stopReason: 'pause_turn',
      stopDetails: { type: 'pause_turn', source: 'anthropic_stop_reason' },
    });
  });

  // §3.1 row 6a — refusal with structured stop_details
  it('maps refusal with structured stop_details to refusal + populated details', () => {
    const raw = {
      type: 'refusal' as const,
      category: 'harm/violence',
      explanation: 'I cannot help with that.',
    };
    expect(normalizeAnthropicStop('refusal', raw, null, 'anthropic_direct')).toEqual({
      stopReason: 'refusal',
      stopDetails: {
        type: 'refusal',
        category: 'harm/violence',
        explanation: 'I cannot help with that.',
        source: 'anthropic_classifier',
      },
    });
  });

  // §3.1 row 6b — refusal without structured stop_details
  it('maps refusal without stop_details to refusal with null fields', () => {
    expect(normalizeAnthropicStop('refusal', null, null, 'anthropic_direct')).toEqual({
      stopReason: 'refusal',
      stopDetails: {
        type: 'refusal',
        category: null,
        explanation: null,
        source: 'anthropic_classifier',
      },
    });
  });

  // §3.1 row 7
  it('maps model_context_window_exceeded (beta) to context_window_exceeded', () => {
    expect(
      normalizeAnthropicStop('model_context_window_exceeded', null, null, 'anthropic_direct')
    ).toEqual({
      stopReason: 'context_window_exceeded',
      stopDetails: {
        type: 'context_window_exceeded',
        source: 'anthropic_beta_stop_reason',
      },
    });
  });

  // §3.1 row 8 — unknown
  it('maps unknown stop_reason to end_turn and WARNs', () => {
    const result = normalizeAnthropicStop('quantum_collapse', null, null, 'anthropic_direct');
    expect(result).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toMatch(/unknown.*stop.*reason/i);
  });

  // Source discriminator: bedrock should use same mapping
  it('produces same mapping for bedrock source as anthropic_direct', () => {
    const direct = normalizeAnthropicStop('end_turn', null, null, 'anthropic_direct');
    const bedrock = normalizeAnthropicStop('end_turn', null, null, 'bedrock');
    expect(direct).toEqual(bedrock);
  });

  it('produces same refusal mapping for bedrock source', () => {
    const raw = {
      type: 'refusal' as const,
      category: 'harm/sexual',
      explanation: 'No.',
    };
    const direct = normalizeAnthropicStop('refusal', raw, null, 'anthropic_direct');
    const bedrock = normalizeAnthropicStop('refusal', raw, null, 'bedrock');
    expect(direct).toEqual(bedrock);
  });
});

describe('normalizeOpenAIChatStop', () => {
  // §3.3 row 1
  it("maps 'stop' to end_turn with null details", () => {
    expect(normalizeOpenAIChatStop('stop')).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
  });

  // §3.3 row 2
  it("maps 'length' to max_output_tokens with openai_chat_finish_reason source", () => {
    expect(normalizeOpenAIChatStop('length')).toEqual({
      stopReason: 'max_output_tokens',
      stopDetails: {
        type: 'max_output_tokens',
        source: 'openai_chat_finish_reason',
      },
    });
  });

  // §3.3 row 3
  it("maps 'tool_calls' to tool_use with null details", () => {
    expect(normalizeOpenAIChatStop('tool_calls')).toEqual({
      stopReason: 'tool_use',
      stopDetails: null,
    });
  });

  // §3.3 row 4
  it("maps 'content_filter' to refusal with openai_chat_content_filter source", () => {
    expect(normalizeOpenAIChatStop('content_filter')).toEqual({
      stopReason: 'refusal',
      stopDetails: {
        type: 'refusal',
        category: null,
        explanation: null,
        source: 'openai_chat_content_filter',
      },
    });
  });

  // §3.3 row 5 — legacy function_call: tool_use + WARN
  it("maps legacy 'function_call' to tool_use and WARNs", () => {
    const result = normalizeOpenAIChatStop('function_call');
    expect(result).toEqual({
      stopReason: 'tool_use',
      stopDetails: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(logger.warn).mock.calls[0]?.[0] ?? '';
    expect(msg).toMatch(/legacy/i);
    expect(msg).toMatch(/function_call/i);
  });

  // §3.3 row 6 — null/undefined finish_reason: end_turn, no WARN
  it('maps null finish_reason to end_turn without WARN', () => {
    const result = normalizeOpenAIChatStop(null);
    expect(result).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('maps undefined finish_reason to end_turn without WARN', () => {
    const result = normalizeOpenAIChatStop(undefined);
    expect(result).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // §3.3 row 7 — unknown
  it('maps unknown finish_reason to end_turn and WARNs', () => {
    const result = normalizeOpenAIChatStop('alien_intervention');
    expect(result).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toMatch(/unknown.*finish_reason/i);
  });
});

describe('normalizeOpenAIResponsesStop', () => {
  // §3.4 row 1 — refusal item wins over anything
  it('maps refusal-emitted-during-stream to refusal regardless of completed status', () => {
    const result = normalizeOpenAIResponsesStop(
      'completed',
      null,
      null,
      'I refuse to help with that.',
      false
    );
    expect(result).toEqual({
      stopReason: 'refusal',
      stopDetails: {
        type: 'refusal',
        category: null,
        explanation: 'I refuse to help with that.',
        source: 'openai_responses_refusal_item',
      },
    });
  });

  it('maps refusal-emitted-during-stream to refusal regardless of incomplete status', () => {
    const result = normalizeOpenAIResponsesStop(
      'incomplete',
      { reason: 'max_output_tokens' },
      null,
      'No.',
      false
    );
    expect(result.stopReason).toBe('refusal');
    expect(result.stopDetails).toEqual({
      type: 'refusal',
      category: null,
      explanation: 'No.',
      source: 'openai_responses_refusal_item',
    });
  });

  it('treats empty-string refusalEmittedDuringStream as falsy (no refusal item)', () => {
    const result = normalizeOpenAIResponsesStop('completed', null, null, '', false);
    expect(result.stopReason).toBe('end_turn');
  });

  // §3.4 row 2 — completed + tool wins over completed alone
  it('maps completed status + hasFunctionToolCallOutput to tool_use', () => {
    expect(normalizeOpenAIResponsesStop('completed', null, null, null, true)).toEqual({
      stopReason: 'tool_use',
      stopDetails: null,
    });
  });

  // §3.4 row 3 — completed alone
  it('maps completed status without tool to end_turn', () => {
    expect(normalizeOpenAIResponsesStop('completed', null, null, null, false)).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
  });

  // §3.4 row 4 — incomplete + max_output_tokens
  it('maps incomplete + max_output_tokens to max_output_tokens', () => {
    expect(
      normalizeOpenAIResponsesStop('incomplete', { reason: 'max_output_tokens' }, null, null, false)
    ).toEqual({
      stopReason: 'max_output_tokens',
      stopDetails: {
        type: 'max_output_tokens',
        source: 'openai_responses_incomplete_details',
      },
    });
  });

  // §3.4 row 5 — incomplete + content_filter
  it('maps incomplete + content_filter to refusal', () => {
    expect(
      normalizeOpenAIResponsesStop('incomplete', { reason: 'content_filter' }, null, null, false)
    ).toEqual({
      stopReason: 'refusal',
      stopDetails: {
        type: 'refusal',
        category: null,
        explanation: null,
        source: 'openai_responses_content_filter',
      },
    });
  });

  // §3.4 row 6 — failed with error.code
  it('maps failed with error.code to failed', () => {
    expect(
      normalizeOpenAIResponsesStop(
        'failed',
        null,
        { code: 'server_error', message: 'kaboom' },
        null,
        false
      )
    ).toEqual({
      stopReason: 'failed',
      stopDetails: {
        type: 'failed',
        code: 'server_error',
        message: 'kaboom',
        source: 'openai_responses_failed_status',
      },
    });
  });

  // §3.4 row 7 — cancelled
  it('maps cancelled status to cancelled with abort_signal', () => {
    expect(normalizeOpenAIResponsesStop('cancelled', null, null, null, false)).toEqual({
      stopReason: 'cancelled',
      stopDetails: {
        type: 'cancelled',
        reason: 'abort_signal',
      },
    });
  });

  // §3.4 row 8 — queued/in_progress: non-terminal, map to end_turn + WARN
  it('maps queued status to end_turn and WARNs (non-terminal)', () => {
    const result = normalizeOpenAIResponsesStop('queued', null, null, null, false);
    expect(result).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('maps in_progress status to end_turn and WARNs (non-terminal)', () => {
    const result = normalizeOpenAIResponsesStop('in_progress', null, null, null, false);
    expect(result).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  // §3.4 row 9 — unknown status
  it('maps unknown status to failed with unknown_status code and WARNs', () => {
    const result = normalizeOpenAIResponsesStop('zombified', null, null, null, false);
    expect(result).toEqual({
      stopReason: 'failed',
      stopDetails: {
        type: 'failed',
        code: 'unknown_status',
        message: 'zombified',
        source: 'openai_responses_failed_status',
      },
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  // Precedence: refusal-item wins over completed-status (explicit)
  it('precedence: refusal-item wins over status:completed + hasFunctionToolCallOutput', () => {
    const result = normalizeOpenAIResponsesStop(
      'completed',
      null,
      null,
      'I refuse.',
      true // has tool output, would normally be tool_use
    );
    expect(result.stopReason).toBe('refusal');
  });

  // Precedence: completed+tool wins over completed-only
  it('precedence: completed + tool wins over completed alone', () => {
    const withTool = normalizeOpenAIResponsesStop('completed', null, null, null, true);
    const without = normalizeOpenAIResponsesStop('completed', null, null, null, false);
    expect(withTool.stopReason).toBe('tool_use');
    expect(without.stopReason).toBe('end_turn');
  });

  // Precedence: incomplete-max-tokens vs incomplete-content-filter
  it('precedence: incomplete reasons distinguish max_output_tokens vs content_filter', () => {
    const max = normalizeOpenAIResponsesStop(
      'incomplete',
      { reason: 'max_output_tokens' },
      null,
      null,
      false
    );
    const filter = normalizeOpenAIResponsesStop(
      'incomplete',
      { reason: 'content_filter' },
      null,
      null,
      false
    );
    expect(max.stopReason).toBe('max_output_tokens');
    expect(filter.stopReason).toBe('refusal');
  });

  // Precedence: failed-with-code vs unknown-status
  it('precedence: status:failed with error.code uses failed path (not unknown_status)', () => {
    const result = normalizeOpenAIResponsesStop(
      'failed',
      null,
      { code: 'real_code', message: 'real message' },
      null,
      false
    );
    if (result.stopDetails?.type !== 'failed') {
      throw new Error('expected failed stopDetails');
    }
    expect(result.stopDetails.code).toBe('real_code');
    expect(result.stopDetails.message).toBe('real message');
  });
});

describe('normalizeLMStudioStop', () => {
  // §3.6 row 1
  it("maps 'tool_use' to tool_use", () => {
    expect(normalizeLMStudioStop('tool_use')).toEqual({
      stopReason: 'tool_use',
      stopDetails: null,
    });
  });

  // §3.6 row 2
  it("maps 'stop' to end_turn", () => {
    expect(normalizeLMStudioStop('stop')).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
  });

  // §3.6 row 3 — undefined
  it('maps undefined to end_turn and WARNs', () => {
    const result = normalizeLMStudioStop(undefined);
    expect(result).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  // §3.6 row 3 — unknown
  it('maps unknown to end_turn and WARNs', () => {
    const result = normalizeLMStudioStop('alien');
    expect(result).toEqual({
      stopReason: 'end_turn',
      stopDetails: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeLegacyStopReason', () => {
  it("renames legacy 'max_tokens' to 'max_output_tokens'", () => {
    expect(normalizeLegacyStopReason('max_tokens')).toBe('max_output_tokens');
  });

  it("preserves 'end_turn'", () => {
    expect(normalizeLegacyStopReason('end_turn')).toBe('end_turn');
  });

  it("preserves 'tool_use'", () => {
    expect(normalizeLegacyStopReason('tool_use')).toBe('tool_use');
  });

  it("preserves 'refusal'", () => {
    expect(normalizeLegacyStopReason('refusal')).toBe('refusal');
  });

  it("preserves 'stop_sequence'", () => {
    expect(normalizeLegacyStopReason('stop_sequence')).toBe('stop_sequence');
  });

  it("preserves 'context_window_exceeded'", () => {
    expect(normalizeLegacyStopReason('context_window_exceeded')).toBe('context_window_exceeded');
  });

  it("preserves 'pause_turn'", () => {
    expect(normalizeLegacyStopReason('pause_turn')).toBe('pause_turn');
  });

  it("preserves 'cancelled'", () => {
    expect(normalizeLegacyStopReason('cancelled')).toBe('cancelled');
  });

  it("preserves 'permission_cancelled'", () => {
    expect(normalizeLegacyStopReason('permission_cancelled')).toBe('permission_cancelled');
  });

  it("preserves 'max_turns'", () => {
    expect(normalizeLegacyStopReason('max_turns')).toBe('max_turns');
  });

  it("preserves 'budget_exceeded'", () => {
    expect(normalizeLegacyStopReason('budget_exceeded')).toBe('budget_exceeded');
  });

  it("preserves 'incomplete'", () => {
    expect(normalizeLegacyStopReason('incomplete')).toBe('incomplete');
  });

  it("preserves 'failed'", () => {
    expect(normalizeLegacyStopReason('failed')).toBe('failed');
  });

  it('maps unknown legacy value to end_turn and WARNs', () => {
    const result = normalizeLegacyStopReason('quantum_collapse');
    expect(result).toBe('end_turn');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toMatch(/unknown.*legacy.*stop.*reason/i);
  });
});
