// ABOUTME: Compaction registry seam — register built-ins, resolve by name, enforce replay-legality
import { registries } from '@lace/agent/plugins';
import type { CompactionStrategy, CompactResult } from './types';
import { trackBasedStrategy } from './track-strategy';
import { mergePreservedAdjacent, type PreservedEntry } from './toolkit';

/** Register the built-in compaction strategies.
 *  Robust to resetRegistriesForTest(): re-registers if the registry was cleared. */
export function registerBuiltinCompaction(): void {
  if (!registries.compaction.has('track-based')) {
    registries.compaction.register('track-based', trackBasedStrategy, 'builtin');
  }
}

export function resolveCompactionStrategy(name: string): CompactionStrategy {
  // Ensure the built-in is registered even when boot() hasn't run (e.g. tests).
  registerBuiltinCompaction();
  return registries.compaction.resolve(name);
}

export function assertCompactionStrategyRegistered(name: string | undefined): void {
  if (!name) return; // unset → default 'track-based', always registered
  try {
    resolveCompactionStrategy(name);
  } catch {
    throw new Error(
      `Compaction strategy "${name}" (selected by the persona) is not registered. ` +
        `Is its plugin loaded via LACE_PLUGINS? Built-in strategies: track-based.`
    );
  }
}

export function validatePreserved(result: CompactResult): CompactResult {
  if ('noop' in result) return result;
  const repaired = mergePreservedAdjacent(
    result.compactionEvent.data.preserved as PreservedEntry[]
  );
  if (repaired.length === 0) return { noop: true };
  return {
    compactionEvent: {
      type: 'context_compacted',
      data: { ...result.compactionEvent.data, preserved: repaired },
    },
  };
}

// ---------------------------------------------------------------------------
// Compaction progress postcondition (PRI-2943)
//
// `validatePreserved` answers "is this result structurally sound". Nothing
// answered "did this compaction make the session runnable again", and the two
// are not the same question. cadence-sen's emergency compactions all passed
// validation while emitting a prefix larger than the context window; the runner
// read that as success, retried, re-assembled a multi-megabyte context, and
// exhausted the 2GB node heap. Thirty-two times over two days, with the
// container reporting healthy and Slack events queueing behind it.
//
// A compaction that cannot fit the window is terminal, not transient: the same
// strategy over the same events is deterministic, so retrying reproduces it
// exactly. Say so once, loudly, and stop.
// ---------------------------------------------------------------------------

/**
 * Deliberately pessimistic chars-per-token divisor. A real wedged session
 * measured 2.46 chars/token against Anthropic's count_tokens endpoint; the
 * conventional 4 would have understated that prefix by ~40% and let it through.
 * This guard exists to catch the pathological case, so it errs toward tripping.
 */
const CONSERVATIVE_CHARS_PER_TOKEN = 3;

export interface CompactionProgress {
  /** Did compaction leave the session in a runnable state? */
  ok: boolean;
  /** Is retrying the same compaction capable of a different outcome? */
  retryable: boolean;
  /** Operator-facing explanation, with the numbers, when `ok` is false. */
  reason?: string;
}

export function assessCompactionProgress(
  result: CompactResult,
  opts: { contextWindow?: number; inputChars: number }
): CompactionProgress {
  if ('noop' in result) return { ok: true, retryable: true };

  const preservedChars = JSON.stringify(result.compactionEvent.data.preserved).length;
  const preservedTokens = Math.ceil(preservedChars / CONSERVATIVE_CHARS_PER_TOKEN);

  if (opts.contextWindow !== undefined && preservedTokens >= opts.contextWindow) {
    return {
      ok: false,
      retryable: false,
      reason:
        `compacted prefix is ~${preservedTokens} tokens (${preservedChars} chars), at or over the ` +
        `${opts.contextWindow}-token context window — compaction cannot make this session runnable ` +
        `and retrying is deterministic. The session needs its history repaired out of band.`,
    };
  }

  if (preservedChars >= opts.inputChars) {
    return {
      ok: false,
      retryable: false,
      reason:
        `compaction did not shrink the session: ${preservedChars} chars out for ${opts.inputChars} ` +
        `chars in. The strategy has nothing left to shed; retrying reproduces this exactly.`,
    };
  }

  return { ok: true, retryable: true };
}
