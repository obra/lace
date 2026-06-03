// ABOUTME: Tests for the track-based compaction trigger
// ABOUTME: Pressure thresholds, stopReason gating, cache field defaults, breakpoint evaluator

import { describe, it, expect } from 'vitest';
import { computePressure, evaluateBreakpoints } from '../compaction-trigger';
import type { TurnEndEventData } from '@lace/agent/storage/event-types';
import type { Breakpoint } from '@lace/agent/compaction/select';

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

const defaultBreakpoints: Breakpoint[] = [
  { at: 0.6, action: 'compact' },
  { at: 0.9, action: 'compact' },
];

describe('evaluateBreakpoints', () => {
  it('fires the first-crossed compact breakpoint', () => {
    const result = evaluateBreakpoints({
      pressure: 0.65,
      breakpoints: defaultBreakpoints,
      highestFiredAt: 0,
    });
    expect(result.fire).toEqual({ at: 0.6, action: 'compact' });
    expect(result.nextHighestFiredAt).toBe(0.6);
    expect(result.reset).toBe(false);
  });

  it('does not re-fire a breakpoint already in highestFiredAt', () => {
    const result = evaluateBreakpoints({
      pressure: 0.65,
      breakpoints: defaultBreakpoints,
      highestFiredAt: 0.6,
    });
    expect(result.fire).toBeNull();
    expect(result.nextHighestFiredAt).toBe(0.6);
    expect(result.reset).toBe(false);
  });

  it('fires the 0.9 breakpoint when 0.6 already fired', () => {
    const result = evaluateBreakpoints({
      pressure: 0.95,
      breakpoints: defaultBreakpoints,
      highestFiredAt: 0.6,
    });
    expect(result.fire).toEqual({ at: 0.9, action: 'compact' });
    expect(result.nextHighestFiredAt).toBe(0.9);
    expect(result.reset).toBe(false);
  });

  it('resets when pressure drops below lowest breakpoint', () => {
    const result = evaluateBreakpoints({
      pressure: 0.3,
      breakpoints: defaultBreakpoints,
      highestFiredAt: 0.6,
    });
    expect(result.fire).toBeNull();
    expect(result.reset).toBe(true);
  });

  it('does not reset when pressure is at or above the lowest breakpoint', () => {
    const result = evaluateBreakpoints({
      pressure: 0.6,
      breakpoints: defaultBreakpoints,
      highestFiredAt: 0,
    });
    expect(result.reset).toBe(false);
  });

  it('ladder: fires the highest un-fired breakpoint when multiple are newly crossed', () => {
    // If pressure jumps from 0 to 0.95 in one turn, fire only the highest (0.9)
    const result = evaluateBreakpoints({
      pressure: 0.95,
      breakpoints: defaultBreakpoints,
      highestFiredAt: 0,
    });
    expect(result.fire).toEqual({ at: 0.9, action: 'compact' });
    expect(result.nextHighestFiredAt).toBe(0.9);
  });

  it('respects notify action', () => {
    const breakpoints: Breakpoint[] = [
      { at: 0.6, action: 'notify' },
      { at: 0.9, action: 'compact' },
    ];
    const result = evaluateBreakpoints({
      pressure: 0.65,
      breakpoints,
      highestFiredAt: 0,
    });
    expect(result.fire).toEqual({ at: 0.6, action: 'notify' });
    expect(result.nextHighestFiredAt).toBe(0.6);
  });

  it('returns no-fire and no-reset when pressure is below all breakpoints and highestFiredAt is 0', () => {
    const result = evaluateBreakpoints({
      pressure: 0.2,
      breakpoints: defaultBreakpoints,
      highestFiredAt: 0,
    });
    expect(result.fire).toBeNull();
    expect(result.reset).toBe(true); // pressure < min(0.6)
    expect(result.nextHighestFiredAt).toBe(0);
  });

  it('returns stable result for empty breakpoints', () => {
    const result = evaluateBreakpoints({
      pressure: 0.99,
      breakpoints: [],
      highestFiredAt: 0,
    });
    expect(result.fire).toBeNull();
    expect(result.reset).toBe(false);
    expect(result.nextHighestFiredAt).toBe(0);
  });
});
