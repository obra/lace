// ABOUTME: Tests for crash-recovery synthesis of turn_end events at session-open
// ABOUTME: Covers single/multi orphans, clean sessions, last-event orphan, and idempotency

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempLaceDir } from '../../test-utils/temp-lace-dir';
import { loadSession, writeSessionMeta } from '../session-store';
import { readAllSessionEventLines } from '../event-log';
import { closeRecallIndex } from '../recall/index-db';
import { PROCESS_DIED_STOP_REASON } from '../event-types';

type RawEvent = {
  eventSeq: number;
  timestamp: string;
  turnId?: string;
  turnSeq?: number;
  type: string;
  data: Record<string, unknown>;
};

const SESSION_ID = 'sess_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

function sessionDirFor(laceDir: string): string {
  return join(laceDir, 'agent-sessions', SESSION_ID);
}

function setupSession(laceDir: string, events: RawEvent[]): string {
  const dir = sessionDirFor(laceDir);
  mkdirSync(dir, { recursive: true });
  writeSessionMeta(dir, {
    sessionId: SESSION_ID,
    workDir: laceDir,
    created: '2026-05-24T00:00:00.000Z',
  });
  // Synthesize the prior process's events.jsonl in the legacy path; the
  // dual-reader will pick it up alongside any new-layout files we never
  // create here. Keeps the fixture self-contained without persona routing.
  const eventsPath = join(dir, 'events.jsonl');
  if (events.length > 0) {
    writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
  return dir;
}

function readEvents(dir: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const line of readAllSessionEventLines(dir)) {
    try {
      out.push(JSON.parse(line) as RawEvent);
    } catch {
      // skip malformed lines (matches production reader's tolerance)
    }
  }
  return out;
}

function turnStart(eventSeq: number, turnId: string, turnSeq = 1): RawEvent {
  return {
    eventSeq,
    timestamp: `2026-05-24T00:00:${String(eventSeq).padStart(2, '0')}.000Z`,
    turnId,
    turnSeq,
    type: 'turn_start',
    data: { type: 'turn_start' },
  };
}

function turnEnd(eventSeq: number, turnId: string, turnSeq = 2, stopReason = 'end_turn'): RawEvent {
  return {
    eventSeq,
    timestamp: `2026-05-24T00:00:${String(eventSeq).padStart(2, '0')}.000Z`,
    turnId,
    turnSeq,
    type: 'turn_end',
    data: { type: 'turn_end', stopReason },
  };
}

function prompt(eventSeq: number, turnId: string): RawEvent {
  return {
    eventSeq,
    timestamp: `2026-05-24T00:00:${String(eventSeq).padStart(2, '0')}.000Z`,
    turnId,
    turnSeq: 0,
    type: 'prompt',
    data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
  };
}

describe('repairOrphanTurnStarts via loadSession', () => {
  const ctx = useTempLaceDir();

  // Each test creates its own session under ctx.tempDir; close the recall
  // index between tests so the next case sees a fresh DB rooted at its
  // tempdir (mirrors event-log.test.ts's pattern).
  afterEach(() => {
    closeRecallIndex();
  });

  it('synthesizes one turn_end for a single orphan turn_start', () => {
    const dir = setupSession(ctx.tempDir, [prompt(1, 'turn_solo'), turnStart(2, 'turn_solo', 1)]);

    loadSession(SESSION_ID, { repairOrphanTurnStarts: true });

    const events = readEvents(dir);
    const turnEnds = events.filter((e) => e.type === 'turn_end');
    expect(turnEnds).toHaveLength(1);
    expect(turnEnds[0].turnId).toBe('turn_solo');
    expect(turnEnds[0].data.stopReason).toBe(PROCESS_DIED_STOP_REASON);
    expect(turnEnds[0].turnSeq).toBe(2);
    expect(turnEnds[0].eventSeq).toBeGreaterThan(2);
  });

  it('synthesizes a turn_end for each of three back-to-back orphan turn_starts', () => {
    const dir = setupSession(ctx.tempDir, [
      prompt(1, 'turn_a'),
      turnStart(2, 'turn_a', 1),
      prompt(3, 'turn_b'),
      turnStart(4, 'turn_b', 1),
      prompt(5, 'turn_c'),
      turnStart(6, 'turn_c', 1),
    ]);

    loadSession(SESSION_ID, { repairOrphanTurnStarts: true });

    const turnEnds = readEvents(dir).filter((e) => e.type === 'turn_end');
    expect(turnEnds).toHaveLength(3);
    const closedTurnIds = turnEnds.map((e) => e.turnId).sort();
    expect(closedTurnIds).toEqual(['turn_a', 'turn_b', 'turn_c']);
    for (const te of turnEnds) {
      expect(te.data.stopReason).toBe(PROCESS_DIED_STOP_REASON);
    }
  });

  it('appends nothing when every turn_start already has a matching turn_end', () => {
    const dir = setupSession(ctx.tempDir, [
      prompt(1, 'turn_a'),
      turnStart(2, 'turn_a', 1),
      turnEnd(3, 'turn_a', 2),
      prompt(4, 'turn_b'),
      turnStart(5, 'turn_b', 1),
      turnEnd(6, 'turn_b', 2),
    ]);
    const before = readEvents(dir);

    loadSession(SESSION_ID, { repairOrphanTurnStarts: true });

    const after = readEvents(dir);
    expect(after).toHaveLength(before.length);
  });

  it('handles an orphan turn_start that is the last event in the file', () => {
    const dir = setupSession(ctx.tempDir, [
      prompt(1, 'turn_a'),
      turnStart(2, 'turn_a', 1),
      turnEnd(3, 'turn_a', 2),
      prompt(4, 'turn_b'),
      turnStart(5, 'turn_b', 1),
    ]);

    loadSession(SESSION_ID, { repairOrphanTurnStarts: true });

    const events = readEvents(dir);
    const turnEnds = events.filter((e) => e.type === 'turn_end');
    expect(turnEnds).toHaveLength(2);
    const synthesized = turnEnds.find((e) => e.turnId === 'turn_b');
    expect(synthesized).toBeDefined();
    expect(synthesized!.data.stopReason).toBe(PROCESS_DIED_STOP_REASON);
    expect(synthesized!.turnSeq).toBe(2);
    expect(synthesized!.eventSeq).toBeGreaterThan(5);
  });

  it('is idempotent: second loadSession does not append more turn_ends', () => {
    const dir = setupSession(ctx.tempDir, [prompt(1, 'turn_solo'), turnStart(2, 'turn_solo', 1)]);

    loadSession(SESSION_ID, { repairOrphanTurnStarts: true });
    const afterFirst = readEvents(dir);
    const firstCount = afterFirst.length;
    const firstSynthesized = afterFirst.filter(
      (e) => e.type === 'turn_end' && e.data.stopReason === PROCESS_DIED_STOP_REASON
    );
    expect(firstSynthesized).toHaveLength(1);

    loadSession(SESSION_ID, { repairOrphanTurnStarts: true });
    const afterSecond = readEvents(dir);
    expect(afterSecond).toHaveLength(firstCount);
  });

  it('does not synthesize when a session has no events', () => {
    const dir = setupSession(ctx.tempDir, []);
    expect(existsSync(join(dir, 'events.jsonl'))).toBe(false);

    loadSession(SESSION_ID, { repairOrphanTurnStarts: true });

    // No events file should be created by repair (post-migration sessions
    // route writes under transcripts/, but with no synth there's nothing to
    // write anywhere).
    const events = readEvents(dir);
    expect(events).toHaveLength(0);
  });

  it('does NOT synthesize when called without the repairOrphanTurnStarts option (default refresh path)', () => {
    // Safety invariant: mid-flight loadSession() refreshes (called all over
    // the rpc handlers after writes) must NOT synthesize turn_end for an
    // in-flight turn_start. Default behavior is no-repair.
    const dir = setupSession(ctx.tempDir, [prompt(1, 'turn_solo'), turnStart(2, 'turn_solo', 1)]);

    loadSession(SESSION_ID);

    const turnEnds = readEvents(dir).filter((e) => e.type === 'turn_end');
    expect(turnEnds).toHaveLength(0);
  });

  it('survives a malformed final line (partial write) in events.jsonl', () => {
    const dir = sessionDirFor(ctx.tempDir);
    mkdirSync(dir, { recursive: true });
    writeSessionMeta(dir, {
      sessionId: SESSION_ID,
      workDir: ctx.tempDir,
      created: '2026-05-24T00:00:00.000Z',
    });

    const validLines = [prompt(1, 'turn_solo'), turnStart(2, 'turn_solo', 1)].map((e) =>
      JSON.stringify(e)
    );
    const truncated =
      '{"eventSeq":3,"timestamp":"2026-05-24T00:00:03Z","turnId":"turn_x","type":"message","data":';
    writeFileSync(join(dir, 'events.jsonl'), validLines.join('\n') + '\n' + truncated, 'utf8');

    loadSession(SESSION_ID, { repairOrphanTurnStarts: true });

    // Sanity: a synthesized turn_end exists for the orphan and we didn't
    // crash on the malformed line. Repair writes to the dual-read transcript
    // layout, so read via readAllSessionEventLines (which honors both
    // legacy events.jsonl and the new transcripts/<persona>/<date>/ path).
    const synthesized = readEvents(dir).filter(
      (e) => e.type === 'turn_end' && e.data.stopReason === PROCESS_DIED_STOP_REASON
    );
    expect(synthesized).toHaveLength(1);
    expect(synthesized[0].turnId).toBe('turn_solo');
  });
});
