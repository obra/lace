// ABOUTME: PRI-2943 — size bounds on the generic (track-based) compaction renderer.
// ABOUTME: track-based is the universal fallback every session lands on when its
// ABOUTME: persona cannot be resolved, so its output must be bounded by construction.

import { describe, it, expect } from 'vitest';
import type { DurableEventData, TypedDurableEvent } from '@lace/agent/storage/event-types';
import { renderGenericSections, untrackedSalience, type TrackBlock } from '../toolkit';

// ---------------------------------------------------------------------------
// Why this file exists
//
// cadence-sen's compacted prefix reached 2,304,363 chars — ~1.01M tokens on its
// own, larger than the 1M window it had to fit inside. Compaction could only
// ever shed the 160KB of live tail around it, so every emergency pass produced
// the same over-limit request and the session could never recover.
//
// The block was `untrackedSalience` output joined by `renderGenericSections`:
// 4,056 `Assistant:` + 679 `User:` + 840 `Note:` lines. Each LINE was capped at
// 500 chars; the LINE COUNT was capped at nothing, and nothing evicted by age.
//
// The numbers below are deliberately far beyond any sane session so the
// assertions describe a hard ceiling rather than a tuning preference.
// ---------------------------------------------------------------------------

const PATHOLOGICAL_EVENTS = 5000;
const LONG_TEXT = 'x'.repeat(3000);

const event = (
  seq: number,
  type: DurableEventData['type'],
  data: Record<string, unknown>
): TypedDurableEvent => ({
  eventSeq: seq,
  timestamp: new Date(Date.parse('2026-06-01T00:00:00Z') + seq * 1000).toISOString(),
  type,
  data: { type, ...data } as TypedDurableEvent['data'],
});

/** A conversation track with far more turns than any bound should allow through. */
function pathologicalConversation(): TypedDurableEvent[] {
  const events: TypedDurableEvent[] = [];
  for (let i = 0; i < PATHOLOGICAL_EVENTS; i++) {
    events.push(
      event(i * 2, 'prompt', { content: [{ type: 'text', text: `${LONG_TEXT} prompt ${i}` }] })
    );
    events.push(event(i * 2 + 1, 'message', { content: `${LONG_TEXT} reply ${i}` }));
  }
  return events;
}

/** A ceiling generous enough that no legitimate session hits it. */
const PREFIX_CHAR_CEILING = 400_000;

describe('untrackedSalience is bounded (PRI-2943)', () => {
  it('caps total body size, not just per-line length', () => {
    const block = untrackedSalience('untracked', pathologicalConversation());
    expect(block.body.length).toBeLessThanOrEqual(PREFIX_CHAR_CEILING);
  });

  it('caps the number of rendered lines', () => {
    const block = untrackedSalience('untracked', pathologicalConversation());
    const lines = block.body.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeLessThan(PATHOLOGICAL_EVENTS);
  });

  it('keeps the most recent turns when it drops', () => {
    const block = untrackedSalience('untracked', pathologicalConversation());
    expect(block.body).toContain(`reply ${PATHOLOGICAL_EVENTS - 1}`);
  });

  it('says so when it dropped history, so the agent knows to recall', () => {
    const block = untrackedSalience('untracked', pathologicalConversation());
    expect(block.body.toLowerCase()).toMatch(/omitted|dropped|truncated|earlier|recall/);
  });

  it('leaves a small conversation completely intact', () => {
    const small: TypedDurableEvent[] = [
      event(0, 'prompt', { content: [{ type: 'text', text: 'hello' }] }),
      event(1, 'message', { content: 'hi back' }),
    ];
    const block = untrackedSalience('untracked', small);
    expect(block.body).toContain('User: hello');
    expect(block.body).toContain('Assistant: hi back');
  });
});

describe('renderGenericSections is bounded (PRI-2943)', () => {
  const bigBlock = (trackId: string, n: number): TrackBlock => ({
    trackId,
    body: `${trackId}\n${'y'.repeat(20_000)}`,
    estimatedTokens: 5000,
    lastActivityTs: new Date(Date.parse('2026-06-01T00:00:00Z') + n * 1000).toISOString(),
    lastSeq: n,
  });

  it('caps the whole rendered prefix regardless of how many blocks arrive', () => {
    const blocks = [
      ...Array.from({ length: 200 }, (_, i) => bigBlock(`system:notify-${i}`, i)),
      ...Array.from({ length: 200 }, (_, i) => bigBlock(`slack:C0/thread-${i}`, 200 + i)),
    ];
    const out = renderGenericSections({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
      referenceTimestamp: '2026-06-08T00:00:00Z',
    });
    expect(out.length).toBeLessThanOrEqual(PREFIX_CHAR_CEILING);
  });

  it('evicts stale system blocks the way it already evicts stale job blocks', () => {
    const blocks = Array.from({ length: 200 }, (_, i) => bigBlock(`system:notify-${i}`, i));
    const out = renderGenericSections({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
      referenceTimestamp: '2026-07-01T00:00:00Z', // every block is far past any horizon
    });
    expect(out).not.toContain('system:notify-0');
    expect(out).toContain(`system:notify-199`);
  });

  it('never grows without a referenceTimestamp either', () => {
    const blocks = Array.from({ length: 200 }, (_, i) => bigBlock(`other:${i}`, i));
    const out = renderGenericSections({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out.length).toBeLessThanOrEqual(PREFIX_CHAR_CEILING);
  });

  it('renders a normal-sized set unchanged', () => {
    const out = renderGenericSections({
      blocks: [
        {
          trackId: 'job:abc',
          body: '- job:abc do a thing → ✓ completed',
          estimatedTokens: 10,
          lastActivityTs: '2026-06-01T00:00:00Z',
          lastSeq: 1,
        },
      ],
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).toContain('## Subagent jobs');
    expect(out).toContain('- job:abc do a thing → ✓ completed');
  });
});
