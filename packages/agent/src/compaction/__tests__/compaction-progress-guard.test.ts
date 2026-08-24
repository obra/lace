// ABOUTME: PRI-2943 — a compaction that cannot fit the window must be reported as
// ABOUTME: unrecoverable, not retried forever as if it had succeeded.

import { describe, it, expect } from 'vitest';
import type { CompactResult } from '../types';
// Does not exist yet. The postcondition compaction never had.
import { assessCompactionProgress } from '../strategy';

// ---------------------------------------------------------------------------
// `validatePreserved` checks that the result is structurally sound and that is
// all. cadence-sen's emergency compactions all passed it while emitting a
// prefix larger than the window, so the runner retried, re-assembled a
// multi-megabyte context, and eventually exhausted the 2GB node heap. Thirty-two
// times. The container reported `Up (healthy)` throughout and Slack events kept
// queueing, so from outside she looked idle rather than broken.
//
// The missing postcondition is not "did it produce valid output" but "did it
// make the session runnable". A compaction that cannot is a terminal state and
// needs to say so once, loudly, rather than fail silently on a loop.
// ---------------------------------------------------------------------------

const CONTEXT_WINDOW = 1_000_000;

const resultOfSize = (chars: number): CompactResult =>
  ({
    compactionEvent: {
      type: 'context_compacted',
      data: {
        type: 'context_compacted',
        strategy: 'track-based',
        messagesCompacted: 13957,
        preserved: [{ role: 'user', content: 'x'.repeat(chars) }],
      },
    },
  }) as unknown as CompactResult;

describe('assessCompactionProgress (PRI-2943)', () => {
  it('accepts a compaction that leaves the session comfortably runnable', () => {
    const verdict = assessCompactionProgress(resultOfSize(200_000), {
      contextWindow: CONTEXT_WINDOW,
      inputChars: 8_000_000,
    });
    expect(verdict.ok).toBe(true);
  });

  it('rejects a compaction whose own output exceeds the window', () => {
    const verdict = assessCompactionProgress(resultOfSize(4_400_000), {
      contextWindow: CONTEXT_WINDOW,
      inputChars: 8_000_000,
    });
    expect(verdict.ok).toBe(false);
  });

  it('marks an over-window result unrecoverable rather than retryable', () => {
    const verdict = assessCompactionProgress(resultOfSize(4_400_000), {
      contextWindow: CONTEXT_WINDOW,
      inputChars: 8_000_000,
    });
    expect(verdict.retryable).toBe(false);
  });

  it('rejects a compaction that did not shrink its input', () => {
    const verdict = assessCompactionProgress(resultOfSize(500_000), {
      contextWindow: CONTEXT_WINDOW,
      inputChars: 500_000,
    });
    expect(verdict.ok).toBe(false);
  });

  it('explains itself with the numbers an operator needs', () => {
    const verdict = assessCompactionProgress(resultOfSize(4_400_000), {
      contextWindow: CONTEXT_WINDOW,
      inputChars: 8_000_000,
    });
    expect(verdict.reason).toBeTruthy();
    expect(String(verdict.reason)).toMatch(/\d/);
  });

  it('passes through when no context window is known', () => {
    const verdict = assessCompactionProgress(resultOfSize(4_400_000), {
      inputChars: 8_000_000,
    });
    expect(verdict.ok).toBe(true);
  });
});
