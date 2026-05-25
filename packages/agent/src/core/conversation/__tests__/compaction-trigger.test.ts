// ABOUTME: Tests for the track-based compaction trigger
// ABOUTME: Pressure thresholds, stopReason gating, cache field defaults

import { describe, it, expect } from 'vitest';
import { computePressure, shouldFireCompaction } from '../compaction-trigger';
import type { TurnEndEventData } from '@lace/agent/storage/event-types';

const usage = (overrides: Partial<NonNullable<TurnEndEventData['usage']>>) => ({
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  ...overrides,
});

describe('computePressure', () => {
  it('uses lastCallInputContextTokens when present', () => {
    expect(computePressure(usage({ lastCallInputContextTokens: 500_000 }), 1_000_000)).toBe(0.5);
  });

  it('falls back to inputTokens + cache fields when lastCallInputContextTokens absent', () => {
    expect(
      computePressure(
        usage({ inputTokens: 100, cacheCreationInputTokens: 200, cacheReadInputTokens: 300 }),
        1_000
      )
    ).toBe(0.6);
  });

  it('treats missing cache fields as zero', () => {
    expect(computePressure(usage({ inputTokens: 600 }), 1_000)).toBe(0.6);
  });

  it('returns 0 for missing usage', () => {
    expect(computePressure(undefined, 1_000_000)).toBe(0);
  });

  it('returns 0 for non-positive window size', () => {
    expect(computePressure(usage({ inputTokens: 100 }), 0)).toBe(0);
  });
});

describe('shouldFireCompaction', () => {
  const trigger = (stopReason: string, pressure: number) =>
    shouldFireCompaction({ stopReason: stopReason as any, pressure });

  it('fires at 60% for clean stop reasons', () => {
    expect(trigger('end_turn', 0.6)).toBe(true);
    expect(trigger('stop_sequence', 0.61)).toBe(true);
    expect(trigger('max_turns', 0.7)).toBe(true);
  });

  it('does not fire below 60%', () => {
    expect(trigger('end_turn', 0.59)).toBe(false);
  });

  it('fires at 90% emergency regardless', () => {
    expect(trigger('end_turn', 0.9)).toBe(true);
  });

  it('does not fire on error stop reasons', () => {
    expect(trigger('provider_error_overloaded', 0.95)).toBe(false);
    expect(trigger('tool_error_throw', 0.95)).toBe(false);
    expect(trigger('process_died', 0.95)).toBe(false);
    expect(trigger('cancelled', 0.95)).toBe(false);
  });
});
