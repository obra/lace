// ABOUTME: Tests for subagent-job helpers (config inheritance + error extraction)

import { describe, it, expect } from 'vitest';
import {
  applyEffectiveJobConfig,
  buildSubagentInitConfig,
  formatSubagentStopDetails,
  jobStatusFromStopReason,
  rpcErrorMessage,
} from '../subagent-job-helpers';

describe('applyEffectiveJobConfig', () => {
  it('fills both fields when both are unset on the job', () => {
    const job: { connectionId?: string; modelId?: string } = {};
    applyEffectiveJobConfig(job, { connectionId: 'parent-conn', modelId: 'parent-model' });
    expect(job).toEqual({ connectionId: 'parent-conn', modelId: 'parent-model' });
  });

  it('inherits connectionId when only modelId was set (persona-supplied model case)', () => {
    const job: { connectionId?: string; modelId?: string } = { modelId: 'persona-model' };
    applyEffectiveJobConfig(job, { connectionId: 'parent-conn', modelId: 'parent-model' });
    expect(job).toEqual({ connectionId: 'parent-conn', modelId: 'persona-model' });
  });

  it('inherits modelId when only connectionId was set', () => {
    const job: { connectionId?: string; modelId?: string } = { connectionId: 'explicit-conn' };
    applyEffectiveJobConfig(job, { connectionId: 'parent-conn', modelId: 'parent-model' });
    expect(job).toEqual({ connectionId: 'explicit-conn', modelId: 'parent-model' });
  });

  it('does not overwrite either field when both are already set', () => {
    const job: { connectionId?: string; modelId?: string } = {
      connectionId: 'explicit-conn',
      modelId: 'explicit-model',
    };
    applyEffectiveJobConfig(job, { connectionId: 'parent-conn', modelId: 'parent-model' });
    expect(job).toEqual({ connectionId: 'explicit-conn', modelId: 'explicit-model' });
  });

  it('leaves a field undefined when the effective config also has it undefined', () => {
    const job: { connectionId?: string; modelId?: string } = { modelId: 'persona-model' };
    applyEffectiveJobConfig(job, { modelId: 'parent-model' });
    expect(job.connectionId).toBeUndefined();
    expect(job.modelId).toBe('persona-model');
  });
});

describe('buildSubagentInitConfig (kata #37 Layer A)', () => {
  // The bug: subagent-job.ts:569 used to hardcode `config: { approvalMode: 'ask' }`
  // on `initialize`, regardless of the parent's approvalMode. That meant a parent
  // running with `dangerouslySkipPermissions` (e.g. an automated runner that never
  // attaches a permission handler) would spawn children that still tried to ask
  // for permission — and the request would be cancelled within ~15ms by the
  // sen-core supervisor's missing handler, silently dropping the subagent's
  // tool calls. The fix propagates the parent's effective approvalMode.

  it('propagates dangerouslySkipPermissions from the parent effective config', () => {
    expect(buildSubagentInitConfig({ approvalMode: 'dangerouslySkipPermissions' })).toEqual({
      approvalMode: 'dangerouslySkipPermissions',
    });
  });

  it('propagates ask from the parent effective config (negative: not always skip)', () => {
    // Parent's mode propagates verbatim — children do not get a hardcoded
    // permission-bypass when the parent is genuinely in ask mode.
    expect(buildSubagentInitConfig({ approvalMode: 'ask' })).toEqual({
      approvalMode: 'ask',
    });
  });

  it('propagates approve from the parent effective config', () => {
    expect(buildSubagentInitConfig({ approvalMode: 'approve' })).toEqual({
      approvalMode: 'approve',
    });
  });

  it('propagates deny from the parent effective config', () => {
    expect(buildSubagentInitConfig({ approvalMode: 'deny' })).toEqual({
      approvalMode: 'deny',
    });
  });

  it("defaults to 'ask' when the parent effective config has no approvalMode set", () => {
    // Safe fallback: an unconfigured parent must not silently grant child
    // sessions a permission bypass.
    expect(buildSubagentInitConfig({})).toEqual({ approvalMode: 'ask' });
  });
});

describe('jobStatusFromStopReason — parametric over RunResult.stopReason', () => {
  // Each case is one of the 11 RunResult.stopReason values (the canonical
  // LaceStopReason set minus the non-terminal 'tool_use' and 'pause_turn' values
  // that the runner handles internally and never surfaces). The mapping must be
  // exhaustive — a missed case would leave a subagent's terminal stop with the
  // default 'completed' status and hide e.g. a refusal or context-exceeded
  // failure from the parent.
  const cases: ReadonlyArray<[string, 'completed' | 'failed' | 'cancelled', string]> = [
    ['end_turn', 'completed', 'natural turn end — model finished its work'],
    ['stop_sequence', 'completed', 'model hit a configured stop sequence — clean exit'],
    [
      'max_output_tokens',
      'completed',
      "model ran out of output budget but produced what it could — not a 'lost writes' signal",
    ],
    [
      'max_turns',
      'completed',
      'runner-side cap on iterations — clean exit from the agentic loop, not a failure',
    ],
    [
      'budget_exceeded',
      'completed',
      'runner-side cost cap — partial result, but not a failure of the tool calls that did run',
    ],
    ['cancelled', 'cancelled', 'turn was aborted via signal — surface as cancelled, not failed'],
    [
      'permission_cancelled',
      'failed',
      'kata #37 — tool permission was cancelled by the supervisor; the tool never ran, so the ' +
        'turn cannot honestly be reported as completed',
    ],
    [
      'context_window_exceeded',
      'failed',
      "provider rejected the prompt for being too long — the subagent's work was not completed",
    ],
    [
      'refusal',
      'failed',
      'model refused to answer (content filter, safety policy, etc.) — the requested work was ' +
        'not performed',
    ],
    [
      'incomplete',
      'failed',
      'kata #31 round 2 — model declared intent but did not call the tool that would do the work',
    ],
    [
      'failed',
      'failed',
      'provider reported an unrecoverable error code — surface as job failure to the parent',
    ],
  ];

  it.each(cases)("maps stopReason='%s' to job status '%s' (%s)", (stopReason, expected) => {
    expect(jobStatusFromStopReason(stopReason)).toBe(expected);
  });

  it("treats an undefined stopReason as 'completed'", () => {
    // Defensive default — older code paths in the RPC layer may omit stopReason
    // entirely. Treat absence as a clean end_turn rather than synthesizing a
    // failure.
    expect(jobStatusFromStopReason(undefined)).toBe('completed');
  });

  it("treats an unknown stopReason string as 'completed'", () => {
    // Forward-compatible default. If a future provider variant slips a new
    // stopReason through normalization without an explicit mapping here, the
    // safer behavior is to surface the subagent's writes (completed) rather
    // than silently mark the job failed.
    expect(jobStatusFromStopReason('not_a_real_stop_reason')).toBe('completed');
  });
});

describe('formatSubagentStopDetails', () => {
  it('returns null when stopDetails is null', () => {
    expect(formatSubagentStopDetails(null)).toBeNull();
  });

  it('formats a refusal with category and explanation (the kata #41 case)', () => {
    // The parent agent needs to see the model's stated reason — otherwise it
    // either retries blindly or gives up without context. Both category and
    // explanation are surfaced verbatim.
    const block = formatSubagentStopDetails({
      type: 'refusal',
      category: 'hate',
      explanation: 'the request asked for disallowed content',
      source: 'anthropic_classifier',
    });
    expect(block).not.toBeNull();
    expect(block).toContain('[SUBAGENT STOP: refusal]');
    expect(block).toContain('Source: anthropic_classifier');
    expect(block).toContain('Category: hate');
    expect(block).toContain('Explanation: the request asked for disallowed content');
  });

  it('formats a refusal with null category/explanation by omitting those lines', () => {
    // Some refusal sources (e.g. OpenAI Responses content_filter) only carry
    // the discriminator and source — no category / explanation. The block
    // must still be useful even in that minimal case.
    const block = formatSubagentStopDetails({
      type: 'refusal',
      category: null,
      explanation: null,
      source: 'openai_responses_content_filter',
    });
    expect(block).not.toBeNull();
    expect(block).toContain('[SUBAGENT STOP: refusal]');
    expect(block).toContain('Source: openai_responses_content_filter');
    expect(block).not.toContain('Category:');
    expect(block).not.toContain('Explanation:');
  });

  it('formats context_window_exceeded with source and estimatedExcessTokens', () => {
    // The source tells the parent *where* the overflow was detected (preflight
    // vs. the provider's 400 vs. the Anthropic beta stop_reason). The parent
    // can decide whether to compact + retry or surface to its own caller.
    const block = formatSubagentStopDetails({
      type: 'context_window_exceeded',
      source: 'preflight_token_estimate',
      estimatedExcessTokens: 4321,
    });
    expect(block).not.toBeNull();
    expect(block).toContain('[SUBAGENT STOP: context_window_exceeded]');
    expect(block).toContain('Source: preflight_token_estimate');
    expect(block).toContain('Estimated excess tokens: 4321');
  });

  it('formats context_window_exceeded without estimatedExcessTokens when absent', () => {
    const block = formatSubagentStopDetails({
      type: 'context_window_exceeded',
      source: 'http_400_prompt_too_long',
    });
    expect(block).not.toBeNull();
    expect(block).toContain('Source: http_400_prompt_too_long');
    expect(block).not.toContain('Estimated excess tokens');
  });

  it('formats a failed stopDetails with code, message and source', () => {
    const block = formatSubagentStopDetails({
      type: 'failed',
      code: 'rate_limit_error',
      message: 'request was rate-limited',
      source: 'http_error',
    });
    expect(block).not.toBeNull();
    expect(block).toContain('[SUBAGENT STOP: failed]');
    expect(block).toContain('Source: http_error');
    expect(block).toContain('Code: rate_limit_error');
    expect(block).toContain('Message: request was rate-limited');
  });

  it('formats max_output_tokens with requestedMaxTokens when present', () => {
    const block = formatSubagentStopDetails({
      type: 'max_output_tokens',
      source: 'anthropic_stop_reason',
      requestedMaxTokens: 2048,
    });
    expect(block).not.toBeNull();
    expect(block).toContain('[SUBAGENT STOP: max_output_tokens]');
    expect(block).toContain('Source: anthropic_stop_reason');
    expect(block).toContain('Requested max tokens: 2048');
  });

  it('formats stop_sequence with the matched sequence', () => {
    const block = formatSubagentStopDetails({
      type: 'stop_sequence',
      sequence: '</done>',
      source: 'anthropic_stop_sequence',
    });
    expect(block).not.toBeNull();
    expect(block).toContain('[SUBAGENT STOP: stop_sequence]');
    expect(block).toContain('Sequence: </done>');
  });

  it("returns null for 'cancelled' stopDetails — the lifecycle already explains it", () => {
    expect(formatSubagentStopDetails({ type: 'cancelled', reason: 'abort_signal' })).toBeNull();
  });

  it("returns null for 'pause_turn' stopDetails — the runner auto-resumes", () => {
    expect(
      formatSubagentStopDetails({ type: 'pause_turn', source: 'anthropic_stop_reason' })
    ).toBeNull();
  });
});

describe('rpcErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(rpcErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('extracts message from a JSON-RPC error response object (the kata #29 case)', () => {
    const wireError = {
      code: -32602,
      message: 'connectionId and modelId are required before prompting',
      data: { category: 'protocol' },
    };
    expect(rpcErrorMessage(wireError)).toBe(
      'connectionId and modelId are required before prompting'
    );
  });

  it('extracts message from a plain object that has a string message field', () => {
    expect(rpcErrorMessage({ message: 'hello' })).toBe('hello');
  });

  it('falls back to String() when message is not a string', () => {
    expect(rpcErrorMessage({ message: { nested: true } })).toBe('[object Object]');
  });

  it('falls back to String() when value has no message field', () => {
    expect(rpcErrorMessage('plain string')).toBe('plain string');
    expect(rpcErrorMessage(42)).toBe('42');
  });

  it('handles null and undefined', () => {
    expect(rpcErrorMessage(null)).toBe('null');
    expect(rpcErrorMessage(undefined)).toBe('undefined');
  });
});
