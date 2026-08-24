// ABOUTME: PRI-2943 — compaction must make progress: strictly smaller than its input,
// ABOUTME: and never larger on a second pass over its own output.

import { describe, it, expect } from 'vitest';
import type { DurableEventData, TypedDurableEvent } from '@lace/agent/storage/event-types';
import { compact } from '../track-compaction';

// ---------------------------------------------------------------------------
// The wedge this prevents.
//
// cadence-sen ran ten consecutive emergency compactions on 2026-08-24 with
// `messagesCompacted` frozen at 13,957 and the resulting request pinned at
// ~1,010,063 tokens against a 1,000,000 window. Compaction "succeeded" every
// time — it produced a structurally valid result — while making no progress at
// all, because the compacted prefix it emitted was itself larger than the
// window and the strategy had no way to shrink it further.
//
// Structural validity was the only postcondition anyone checked. These tests
// add the two that matter: output smaller than input, and no growth across
// passes.
// ---------------------------------------------------------------------------

const CONTEXT_WINDOW = 1_000_000;
const CHARS_PER_TOKEN = 4;

const event = (
  seq: number,
  type: DurableEventData['type'],
  data: Record<string, unknown>,
  turnId?: string
): TypedDurableEvent => ({
  eventSeq: seq,
  timestamp: new Date(Date.parse('2026-06-01T00:00:00Z') + seq * 1000).toISOString(),
  ...(turnId ? { turnId } : {}),
  type,
  data: { type, ...data } as TypedDurableEvent['data'],
});

/**
 * A session shaped like cadence's: thousands of turns of chatty
 * notification-and-reply traffic, none of it individually large.
 */
function longSession(turns: number, startSeq = 0): TypedDurableEvent[] {
  const events: TypedDurableEvent[] = [];
  let seq = startSeq;
  for (let i = 0; i < turns; i++) {
    const turnId = `turn_${i}`;
    events.push(event(seq++, 'turn_start', {}, turnId));
    events.push(
      event(seq++, 'prompt', {
        content: [{ type: 'text', text: `message ${i} from a human: ${'detail '.repeat(40)}` }],
      })
    );
    events.push(
      event(seq++, 'context_injected', {
        content: [
          {
            type: 'text',
            text: `<notification kind="job-completed">Your background job completed successfully (exit code 0). ${'padding '.repeat(30)}</notification>`,
          },
        ],
      })
    );
    events.push(
      event(seq++, 'message', { content: `reply ${i}: ${'reasoning '.repeat(40)}` }, turnId)
    );
    events.push(event(seq++, 'turn_end', { stopReason: 'end_turn' }, turnId));
  }
  return events;
}

const sizeOf = (events: TypedDurableEvent[]) => JSON.stringify(events).length;

function preservedSize(result: Awaited<ReturnType<typeof compact>>): number {
  if ('noop' in result) return 0;
  return JSON.stringify(result.compactionEvent.data.preserved).length;
}

describe('compaction makes progress (PRI-2943)', () => {
  it('emits a prefix smaller than the events it compacted', async () => {
    const events = longSession(1500);
    const result = await compact(events, {
      threadId: 'sess_progress',
      contextWindow: CONTEXT_WINDOW,
    });
    expect('noop' in result).toBe(false);
    expect(preservedSize(result)).toBeLessThan(sizeOf(events));
  });

  it('emits a prefix that fits the context window it was given', async () => {
    const events = longSession(3000);
    const result = await compact(events, { threadId: 'sess_fits', contextWindow: CONTEXT_WINDOW });
    expect('noop' in result).toBe(false);
    // Not merely "under the window" — under it with room for a real turn.
    expect(preservedSize(result) / CHARS_PER_TOKEN).toBeLessThan(CONTEXT_WINDOW * 0.8);
  });

  it('does not grow when compacting again over its own output', async () => {
    const first = longSession(1500);
    const firstResult = await compact(first, {
      threadId: 'sess_fixedpoint',
      contextWindow: CONTEXT_WINDOW,
    });
    expect('noop' in firstResult).toBe(false);
    if ('noop' in firstResult) return;

    // Replay as the runner does: the prior compaction event, then more traffic.
    const second = [
      ...first,
      { ...event(9_000, 'context_compacted', {}), data: firstResult.compactionEvent.data },
      ...longSession(200, 10_000),
    ] as TypedDurableEvent[];

    const secondResult = await compact(second, {
      threadId: 'sess_fixedpoint',
      contextWindow: CONTEXT_WINDOW,
    });
    expect('noop' in secondResult).toBe(false);
    expect(preservedSize(secondResult)).toBeLessThanOrEqual(preservedSize(firstResult) * 1.1);
  });

  it('still shrinks a session whose prior prefix is already over the window', async () => {
    // cadence's actual state: the carried summary alone exceeds the window.
    const oversizeSummary = '[Earlier conversation, compacted by track]\n' + 'x'.repeat(2_300_000);
    const events = [
      {
        ...event(0, 'context_compacted', {}),
        data: {
          type: 'context_compacted',
          strategy: 'track-based',
          messagesCompacted: 13957,
          preserved: [{ role: 'user', content: oversizeSummary }],
        },
      },
      ...longSession(100, 1),
    ] as TypedDurableEvent[];

    const result = await compact(events, {
      threadId: 'sess_wedged',
      contextWindow: CONTEXT_WINDOW,
    });
    expect('noop' in result).toBe(false);
    expect(preservedSize(result) / CHARS_PER_TOKEN).toBeLessThan(CONTEXT_WINDOW * 0.8);
  });
});
