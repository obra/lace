// ABOUTME: Tests for inject-tailer.ts — the partial-line-safe JSONL tail reader and
// ABOUTME: the InjectTailer that surfaces immediate injects incrementally across shards.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNewCompleteLines, createInjectTailer } from '@lace/agent/storage/inject-tailer';
import { transcriptDir } from '@lace/agent/storage/transcript-paths';

type ShardEvent = {
  eventSeq: number;
  type: string;
  data: Record<string, unknown>;
};

const immediateInject = (eventSeq: number, text: string): ShardEvent => ({
  eventSeq,
  type: 'context_injected',
  data: { priority: 'immediate', content: [{ type: 'text', text }] },
});

function shardLine(e: ShardEvent): string {
  return `${JSON.stringify({ timestamp: '2026-06-18T00:00:00.000Z', ...e })}\n`;
}

/** Write/append events to the new-layout shard for the given persona + UTC date. */
function writeShard(
  laceDir: string,
  persona: string,
  date: Date,
  sessionId: string,
  events: ShardEvent[],
  mode: 'write' | 'append'
): void {
  const dir = transcriptDir({ laceDir, persona, date });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  const body = events.map(shardLine).join('');
  if (mode === 'write') writeFileSync(file, body, 'utf8');
  else appendFileSync(file, body, 'utf8');
}

describe('readNewCompleteLines', () => {
  let f: string;
  beforeEach(() => {
    f = join(mkdtempSync(join(tmpdir(), 'lace-tail-')), 'events.jsonl');
  });
  afterEach(() => rmSync(f, { recursive: true, force: true }));

  it('returns only newline-terminated lines and advances the offset past them', () => {
    writeFileSync(f, 'a\nb\n', 'utf8');
    const r1 = readNewCompleteLines(f, 0);
    expect(r1.lines).toEqual(['a', 'b']);
    expect(r1.offset).toBe(4);

    // A partial line (no trailing newline yet) is NOT returned and does not advance.
    appendFileSync(f, 'c', 'utf8');
    const r2 = readNewCompleteLines(f, r1.offset);
    expect(r2.lines).toEqual([]);
    expect(r2.offset).toBe(r1.offset); // held back

    // Once the partial line completes, it is returned exactly once.
    appendFileSync(f, '\nd\n', 'utf8');
    const r3 = readNewCompleteLines(f, r2.offset);
    expect(r3.lines).toEqual(['c', 'd']);
    expect(r3.offset).toBe(8);
  });

  it('returns {lines:[], offset} for a missing file', () => {
    expect(readNewCompleteLines(join(f, 'nope'), 0)).toEqual({ lines: [], offset: 0 });
  });
});

describe('createInjectTailer', () => {
  const sessionId = 'sess-tailer';
  const persona = 'ada';
  const day1 = new Date('2026-06-18T12:00:00.000Z');
  const day2 = new Date('2026-06-19T12:00:00.000Z');
  let laceDir: string;
  let prevLaceDir: string | undefined;
  let prevSessionDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-injecttailer-'));
    prevLaceDir = process.env.LACE_DIR;
    prevSessionDir = process.env.LACE_SESSION_DIR;
    process.env.LACE_DIR = laceDir;
    // Point the legacy events.jsonl path (resolved via getSessionDir) at a dir
    // with no legacy file, so the tailer reads only the new-layout shards here.
    process.env.LACE_SESSION_DIR = join(laceDir, 'agent-sessions');
  });

  afterEach(() => {
    if (prevLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = prevLaceDir;
    if (prevSessionDir === undefined) delete process.env.LACE_SESSION_DIR;
    else process.env.LACE_SESSION_DIR = prevSessionDir;
    rmSync(laceDir, { recursive: true, force: true });
  });

  it('surfaces only new immediate injects, across shards, once', () => {
    // Initial shard with events up to seq 5 (no qualifying inject after wm=5).
    writeShard(
      laceDir,
      persona,
      day1,
      sessionId,
      [
        { eventSeq: 4, type: 'message', data: {} },
        immediateInject(5, 'old inject (<= watermark, ignored)'),
      ],
      'write'
    );

    const tailer = createInjectTailer(laceDir, sessionId, 5);

    // Append: an immediate inject (6), a non-immediate inject (7), a tool_use (8).
    writeShard(
      laceDir,
      persona,
      day1,
      sessionId,
      [
        immediateInject(6, 'live inject'),
        {
          eventSeq: 7,
          type: 'context_injected',
          data: { priority: 'queued', content: [{ type: 'text', text: 'queued, ignored' }] },
        },
        { eventSeq: 8, type: 'tool_use', data: {} },
      ],
      'append'
    );

    const a = tailer.readNew();
    expect(a.injections).toEqual(['live inject']);
    expect(a.newWatermark).toBe(8);

    // Second call with nothing new returns [].
    expect(tailer.readNew().injections).toEqual([]);

    // A NEW shard (next day) with an immediate inject (seq 9) is picked up.
    writeShard(laceDir, persona, day2, sessionId, [immediateInject(9, 'next-day inject')], 'write');

    const b = tailer.readNew();
    expect(b.injections).toEqual(['next-day inject']);
    expect(b.newWatermark).toBe(9);
  });
});
