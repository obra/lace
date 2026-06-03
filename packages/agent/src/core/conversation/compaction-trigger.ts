// ABOUTME: Track-based compaction trigger — pressure evaluator + breakpoint evaluator
// ABOUTME: Pure functions; called from runner.run() after turn_end is written

import type { TurnEndEventData } from '@lace/agent/storage/event-types';
import type { Breakpoint } from '@lace/agent/compaction/select';

/**
 * Compute context-window pressure as a fraction (0..1).
 *
 * Prefers `usage.lastCallInputContextTokens` (the last API call's on-the-wire
 * context size). Falls back to summing `inputTokens + cacheCreationInputTokens
 * + cacheReadInputTokens` for legacy events without the lastCall field.
 * Missing cache fields are treated as zero (forward-compat across providers).
 */
export function computePressure(
  usage: TurnEndEventData['usage'] | undefined,
  contextWindowSize: number
): number {
  if (!usage || contextWindowSize <= 0) return 0;
  if (typeof usage.lastCallInputContextTokens === 'number') {
    return usage.lastCallInputContextTokens / contextWindowSize;
  }
  const inputs =
    (usage.inputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0);
  return inputs / contextWindowSize;
}

export interface EvaluateBreakpointsResult {
  /** The highest un-fired breakpoint that is now crossed, or null if none. */
  fire: Breakpoint | null;
  /** Updated highestFiredAt: fire.at when fired, or unchanged when not. */
  nextHighestFiredAt: number;
  /** True when pressure has dropped below all breakpoints — caller should reset highestFiredAt to 0. */
  reset: boolean;
}

/**
 * Pure breakpoint evaluator. Given the current pressure, breakpoint list, and
 * the highest `at` value previously fired, determines whether a new breakpoint
 * should fire this turn, and whether the state should reset.
 *
 * Semantics:
 * - candidates = breakpoints where `at <= pressure` AND `at > highestFiredAt`
 * - fire = highest-`at` candidate (once-per-crossing: each level fires at most once per ascent)
 * - reset = true when pressure < min(breakpoints.at), which signals a descent below all thresholds
 * - nextHighestFiredAt = fire.at when fired, else unchanged highestFiredAt
 */
export function evaluateBreakpoints(args: {
  pressure: number;
  breakpoints: Breakpoint[];
  highestFiredAt: number;
}): EvaluateBreakpointsResult {
  const { pressure, breakpoints, highestFiredAt } = args;

  if (breakpoints.length === 0) {
    return { fire: null, nextHighestFiredAt: highestFiredAt, reset: false };
  }

  const minAt = Math.min(...breakpoints.map((b) => b.at));
  const reset = pressure < minAt;

  // Candidates: crossed (at <= pressure) AND not yet fired (at > highestFiredAt)
  const candidates = breakpoints.filter((b) => b.at <= pressure && b.at > highestFiredAt);

  if (candidates.length === 0) {
    return { fire: null, nextHighestFiredAt: highestFiredAt, reset };
  }

  // Fire the highest-at candidate
  const fire = candidates.reduce((best, b) => (b.at > best.at ? b : best));
  return { fire, nextHighestFiredAt: fire.at, reset };
}
