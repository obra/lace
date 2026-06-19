// ABOUTME: Tests compaction toolkit helpers, incl. surrogate-safe truncation tails.

import { describe, expect, it } from 'vitest';
import {
  applyRecencyKeep,
  jobSalience,
  renderGenericSections,
  stripTrailingLoneSurrogate,
  systemSalience,
  untrackedSalience,
} from './toolkit.js';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const EMOJI = '😀'; // U+1F600 = '😀'

describe('stripTrailingLoneSurrogate', () => {
  it('drops a trailing lone high surrogate left by a mid-emoji slice', () => {
    // Slice an emoji in half: keep the lead surrogate, drop the trail.
    const torn = `done ${EMOJI}`.slice(0, 'done '.length + 1); // 'done \uD83D'
    expect(LONE_SURROGATE.test(torn)).toBe(true); // precondition: it IS torn
    const fixed = stripTrailingLoneSurrogate(torn);
    expect(LONE_SURROGATE.test(fixed)).toBe(false);
    expect(fixed).toBe('done ');
    // The real failure mode — strict JSON round-trip — now succeeds.
    expect(() => JSON.parse(JSON.stringify({ t: fixed }))).not.toThrow();
  });

  it('leaves a string ending in a complete emoji intact', () => {
    expect(stripTrailingLoneSurrogate(`hi ${EMOJI}`)).toBe(`hi ${EMOJI}`);
  });

  it('leaves an ordinary string and the empty string unchanged', () => {
    expect(stripTrailingLoneSurrogate('hello')).toBe('hello');
    expect(stripTrailingLoneSurrogate('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Fixtures: build TypedDurableEvent job tracks
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = '2026-06-19T12:00:00.000Z';
const nowMs = Date.parse(NOW);
const at = (msAgo: number) => new Date(nowMs - msAgo).toISOString();

function jobEvents(
  jobId: string,
  startSeq: number,
  lastTsMsAgo: number,
  outcome: 'completed' | 'failed' | 'cancelled' = 'completed'
): TypedDurableEvent[] {
  return [
    {
      eventSeq: startSeq,
      timestamp: at(lastTsMsAgo + 1000),
      type: 'job_started',
      data: { type: 'job_started', jobId, jobType: 'delegate', description: `do ${jobId}` },
    },
    {
      eventSeq: startSeq + 1,
      timestamp: at(lastTsMsAgo),
      type: 'job_finished',
      data: { type: 'job_finished', jobId, outcome },
    },
  ];
}

describe('applyRecencyKeep', () => {
  type Item = { id: string; ts: string; seq: number };
  const opts = (over: Partial<Parameters<typeof applyRecencyKeep<Item>>[1]> = {}) => ({
    now: NOW,
    horizonMs: 2 * DAY_MS,
    floorN: 2,
    getTs: (i: Item) => i.ts,
    getSeq: (i: Item) => i.seq,
    ...over,
  });

  it('keeps age≤horizon ∪ topN-by-seq, in original order', () => {
    const items: Item[] = [
      { id: 'old-low', ts: at(10 * DAY_MS), seq: 1 }, // old, not topN → drop
      { id: 'fresh', ts: at(1 * DAY_MS), seq: 2 }, // fresh → keep
      { id: 'old-hi1', ts: at(8 * DAY_MS), seq: 9 }, // old but topN → keep
      { id: 'old-hi2', ts: at(9 * DAY_MS), seq: 8 }, // old but topN → keep
    ];
    const kept = applyRecencyKeep(items, opts());
    expect(kept.map((i) => i.id)).toEqual(['fresh', 'old-hi1', 'old-hi2']);
  });

  it('all-old but floorN keeps exactly N most-recent by seq', () => {
    const items: Item[] = [
      { id: 'a', ts: at(10 * DAY_MS), seq: 1 },
      { id: 'b', ts: at(10 * DAY_MS), seq: 5 },
      { id: 'c', ts: at(10 * DAY_MS), seq: 3 },
      { id: 'd', ts: at(10 * DAY_MS), seq: 4 },
    ];
    const kept = applyRecencyKeep(items, opts({ floorN: 2 }));
    // topN seqs are 5 (b) and 4 (d); original order preserved
    expect(kept.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('all-fresh keeps all', () => {
    const items: Item[] = [
      { id: 'a', ts: at(1 * DAY_MS), seq: 1 },
      { id: 'b', ts: at(0), seq: 2 },
    ];
    expect(applyRecencyKeep(items, opts({ floorN: 0 })).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('floorN ≥ length keeps all even when all old', () => {
    const items: Item[] = [
      { id: 'a', ts: at(10 * DAY_MS), seq: 1 },
      { id: 'b', ts: at(10 * DAY_MS), seq: 2 },
    ];
    expect(applyRecencyKeep(items, opts({ floorN: 5 })).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('floorN ≤ 0 means no floor (only age-window)', () => {
    const items: Item[] = [
      { id: 'old', ts: at(10 * DAY_MS), seq: 9 },
      { id: 'fresh', ts: at(0), seq: 1 },
    ];
    expect(applyRecencyKeep(items, opts({ floorN: 0 })).map((i) => i.id)).toEqual(['fresh']);
  });
});

describe('salience builders set activity', () => {
  it('jobSalience sets lastActivityTs/lastSeq to the newest event', () => {
    const events = jobEvents('job:j1', 40, 3 * DAY_MS);
    const block = jobSalience('job:j1', events);
    expect(block.lastSeq).toBe(41);
    expect(block.lastActivityTs).toBe(at(3 * DAY_MS));
  });

  it('untrackedSalience sets lastActivityTs/lastSeq to the newest event', () => {
    const events: TypedDurableEvent[] = [
      {
        eventSeq: 5,
        timestamp: at(2 * DAY_MS),
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'hello' }] },
      },
      {
        eventSeq: 7,
        timestamp: at(1 * DAY_MS),
        type: 'message',
        data: { type: 'message', content: 'world' },
      },
    ];
    const block = untrackedSalience('untracked', events);
    expect(block.lastSeq).toBe(7);
    expect(block.lastActivityTs).toBe(at(1 * DAY_MS));
  });

  it('systemSalience sets lastActivityTs/lastSeq to the newest event', () => {
    const events: TypedDurableEvent[] = [
      {
        eventSeq: 11,
        timestamp: at(2 * DAY_MS),
        type: 'turn_end',
        data: { type: 'turn_end', stopReason: 'end_turn' },
      },
      {
        eventSeq: 13,
        timestamp: at(1 * DAY_MS),
        type: 'turn_end',
        data: { type: 'turn_end', stopReason: 'end_turn' },
      },
    ];
    const block = systemSalience('system:idle-errors', events);
    expect(block).not.toBeNull();
    expect(block?.lastSeq).toBe(13);
    expect(block?.lastActivityTs).toBe(at(1 * DAY_MS));
  });
});

describe('renderGenericSections job eviction', () => {
  const blocks = [
    jobSalience('job:fresh', jobEvents('job:fresh', 10, 1 * DAY_MS)),
    jobSalience('job:old1', jobEvents('job:old1', 20, 10 * DAY_MS)),
    jobSalience('job:old2', jobEvents('job:old2', 30, 11 * DAY_MS)),
  ];

  it('with referenceTimestamp drops aged-out jobs below the floor', () => {
    // floorN default is 10, so all 3 survive the floor regardless of age.
    // Use a render where floor cannot rescue: build > floor old jobs.
    const many = [
      jobSalience('job:fresh', jobEvents('job:fresh', 1000, 1 * DAY_MS)),
      ...Array.from({ length: 12 }, (_, i) =>
        jobSalience(`job:old${i}`, jobEvents(`job:old${i}`, 100 + i * 2, (10 + i) * DAY_MS))
      ),
    ];
    const out = renderGenericSections({
      blocks: many,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
      referenceTimestamp: NOW,
    });
    expect(out).toContain('job:fresh');
    // The 10 highest-seq old jobs are kept by the floor; the 2 lowest-seq drop.
    // old0/old1 have the lowest seqs → dropped.
    expect(out).not.toContain('job:old0 ');
    expect(out).not.toContain('job:old1 ');
    expect(out).toContain('job:old11');
  });

  it('without referenceTimestamp renders all jobs (backward)', () => {
    const out = renderGenericSections({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).toContain('job:fresh');
    expect(out).toContain('job:old1');
    expect(out).toContain('job:old2');
  });
});
