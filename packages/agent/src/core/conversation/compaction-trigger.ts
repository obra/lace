// ABOUTME: Track-based compaction trigger — pressure evaluator + threshold predicate
// ABOUTME: Pure functions; called from runner.run() after turn_end is written

import type { TurnEndEventData } from '@lace/agent/storage/event-types';

const GLOBAL_THRESHOLD = 0.6;
const EMERGENCY_THRESHOLD = 0.9;

const CLEAN_STOP_REASONS = new Set(['end_turn', 'stop_sequence', 'max_turns']);

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

/**
 * Decide whether to fire compaction at the end of a turn.
 *
 * Fires at 60% pressure on clean stop reasons (end_turn / stop_sequence /
 * max_turns). The 90% emergency threshold applies the same gate — error/abort
 * stop reasons never fire because the model state is unreliable; we'll
 * re-evaluate on the next clean turn.
 */
export function shouldFireCompaction(args: { stopReason: string; pressure: number }): boolean {
  if (!CLEAN_STOP_REASONS.has(args.stopReason)) return false;
  if (args.pressure >= EMERGENCY_THRESHOLD) return true;
  return args.pressure >= GLOBAL_THRESHOLD;
}
