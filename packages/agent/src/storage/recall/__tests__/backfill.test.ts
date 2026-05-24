// ABOUTME: Tests for backfill.ts — one-time-per-startup catch-up scan of JSONL transcripts
// ABOUTME: Covers new and legacy layouts, partial-index resume, idempotency, and _unknown bucket

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex, type Db } from '../index-db';
import { insertRow } from '../index-writer';
import { backfillIndex } from '../backfill';
import type { DurableEvent } from '../../event-log';

// session ids must match sess_<uuid> format (see ent-protocol/src/ids.ts)
const SESSION_IDS = {
  legacy: 'sess_11111111-1111-4111-8111-111111111111',
  new: 'sess_22222222-2222-4222-8222-222222222222',
  partial: 'sess_33333333-3333-4333-8333-333333333333',
  idem: 'sess_44444444-4444-4444-8444-444444444444',
  unknown: 'sess_55555555-5555-4555-8555-555555555555',
  noMeta: 'sess_66666666-6666-4666-8666-666666666666',
  malformed: 'sess_77777777-7777-4777-8777-777777777777',
  legacyMix: 'sess_88888888-8888-4888-8888-888888888888',
  newMix: 'sess_99999999-9999-4999-8999-999999999999',
} as const;

type Row = {
  event_id: string;
  session_id: string;
  persona: string | null;
  kind: string;
  content: string;
};

function promptEvent(eventSeq: number, text: string): DurableEvent {
  return {
    eventSeq,
    timestamp: `2026-05-23T00:00:0${eventSeq}Z`,
    type: 'prompt',
    data: { type: 'prompt', content: [{ type: 'text', text }] },
  };
}

function writeJsonl(filePath: string, events: DurableEvent[]): void {
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(filePath, body, 'utf8');
}

function writeMeta(sessionDir: string, sessionId: string, persona: string | null): void {
  const meta: Record<string, unknown> = {
    sessionId,
    workDir: '/tmp/workdir',
    created: '2026-05-23T00:00:00Z',
  };
  if (persona !== null) meta.persona = persona;
  writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta), 'utf8');
}

function allRows(db: Db): Row[] {
  return db
    .prepare(`SELECT event_id, session_id, persona, kind, content FROM events ORDER BY event_id`)
    .all() as Row[];
}

describe('backfillIndex', () => {
  let laceDir: string;
  let db: Db;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'recall-backfill-'));
    db = openRecallIndex(join(laceDir, 'recall', 'index.sqlite'));
  });

  afterEach(() => {
    db.close();
    rmSync(laceDir, { recursive: true, force: true });
  });

  it('backfills events from legacy <laceDir>/agent-sessions layout', () => {
    const sessionId = SESSION_IDS.legacy;
    const sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeMeta(sessionDir, sessionId, 'ada');
    writeJsonl(join(sessionDir, 'events.jsonl'), [
      promptEvent(1, 'hello'),
      promptEvent(2, 'world'),
      promptEvent(3, 'again'),
    ]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(3);
    const rows = allRows(db);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.event_id)).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
    ]);
    expect(rows.every((r) => r.session_id === sessionId)).toBe(true);
    expect(rows.every((r) => r.persona === 'ada')).toBe(true);
    expect(rows.every((r) => r.kind === 'user_message')).toBe(true);
  });

  it('backfills events from new transcripts/<persona>/<date> layout', () => {
    const sessionId = SESSION_IDS.new;
    const dir = join(laceDir, 'transcripts', 'bea', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'one'),
      promptEvent(2, 'two'),
      promptEvent(3, 'three'),
    ]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(3);
    const rows = allRows(db);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.session_id === sessionId)).toBe(true);
    expect(rows.every((r) => r.persona === 'bea')).toBe(true);
  });

  it('skips events already present in the index, inserting only later ones', () => {
    const sessionId = SESSION_IDS.partial;
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'one'),
      promptEvent(2, 'two'),
      promptEvent(3, 'three'),
      promptEvent(4, 'four'),
      promptEvent(5, 'five'),
    ]);

    // Pre-seed the index with eventSeq 1 and 2
    insertRow(db, {
      event_id: `${sessionId}:1`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:01Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'one',
    });
    insertRow(db, {
      event_id: `${sessionId}:2`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:02Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'two',
    });

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(3);
    const rows = allRows(db);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.event_id)).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
      `${sessionId}:4`,
      `${sessionId}:5`,
    ]);
  });

  it('is idempotent — second run inserts nothing more', () => {
    const sessionId = SESSION_IDS.idem;
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'a'),
      promptEvent(2, 'b'),
      promptEvent(3, 'c'),
    ]);

    const first = backfillIndex(db, laceDir);
    const second = backfillIndex(db, laceDir);

    expect(first.inserted).toBe(3);
    expect(second.inserted).toBe(0);
    expect(allRows(db)).toHaveLength(3);
  });

  it('writes persona: null for events under the _unknown bucket', () => {
    const sessionId = SESSION_IDS.unknown;
    const dir = join(laceDir, 'transcripts', '_unknown', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [promptEvent(1, 'orphan')]);

    backfillIndex(db, laceDir);

    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].persona).toBeNull();
  });

  it('survives a session dir with no meta.json (legacy)', () => {
    const sessionId = SESSION_IDS.noMeta;
    const sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeJsonl(join(sessionDir, 'events.jsonl'), [promptEvent(1, 'lonely')]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(1);
    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].persona).toBeNull();
  });

  it('survives malformed JSON lines without throwing', () => {
    const sessionId = SESSION_IDS.malformed;
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    const good = JSON.stringify(promptEvent(1, 'good'));
    const bad = '{this is not json';
    const good2 = JSON.stringify(promptEvent(2, 'good2'));
    writeFileSync(join(dir, `${sessionId}.jsonl`), `${good}\n${bad}\n${good2}\n`, 'utf8');

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(2);
    expect(allRows(db)).toHaveLength(2);
  });

  it('returns zero stats when there are no transcript or session directories', () => {
    const stats = backfillIndex(db, laceDir);
    expect(stats).toEqual({ scanned: 0, inserted: 0, skipped: 0, errors: 0 });
  });

  it('repairs gaps in FTS even when index has higher seqs than the gap (C1/B2)', () => {
    // FTS has {1, 2, 3, 5} but JSONL has {1, 2, 3, 4, 5}. The previous
    // MAX(eventSeq) watermark logic saw MAX=5 and skipped seq 4 forever.
    // The fix uses a per-session set of event_ids, so seq 4 is detected
    // as missing regardless of higher-numbered neighbors.
    const sessionId = 'sess_aaaaaaaa-1111-4111-8111-111111111111';
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'one'),
      promptEvent(2, 'two'),
      promptEvent(3, 'three'),
      promptEvent(4, 'four'),
      promptEvent(5, 'five'),
    ]);
    insertRow(db, {
      event_id: `${sessionId}:1`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:01Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'one',
    });
    insertRow(db, {
      event_id: `${sessionId}:2`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:02Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'two',
    });
    insertRow(db, {
      event_id: `${sessionId}:3`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:03Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'three',
    });
    insertRow(db, {
      event_id: `${sessionId}:5`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:05Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'five',
    });

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(1);
    const rows = allRows(db).filter((r) => r.session_id === sessionId);
    expect(rows.map((r) => r.event_id).sort()).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
      `${sessionId}:4`,
      `${sessionId}:5`,
    ]);
  });

  it('does not skip legacy events when new-layout for same session is processed first (C1/A1)', () => {
    // The previous code computed MAX(eventSeq) once per file. When the
    // new-layout pass ran first for a session, it raised the per-session
    // MAX above the legacy file's seqs, and the legacy events were silently
    // dropped from the index forever. Per-session set of event_ids fixes it.
    const sessionId = 'sess_bbbbbbbb-2222-4222-8222-222222222222';
    const legacyDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(legacyDir, { recursive: true });
    writeMeta(legacyDir, sessionId, 'ada');
    writeJsonl(join(legacyDir, 'events.jsonl'), [
      promptEvent(1, 'legacy-1'),
      promptEvent(2, 'legacy-2'),
      promptEvent(3, 'legacy-3'),
    ]);
    const newDir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(newDir, { recursive: true });
    writeJsonl(join(newDir, `${sessionId}.jsonl`), [
      promptEvent(4, 'new-4'),
      promptEvent(5, 'new-5'),
    ]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(5);
    const rows = allRows(db).filter((r) => r.session_id === sessionId);
    expect(rows.map((r) => r.event_id).sort()).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
      `${sessionId}:4`,
      `${sessionId}:5`,
    ]);
  });

  it('one malformed event does not roll back inserts from other rows in the session (C2)', () => {
    // A message event without `content` would throw inside eventToRow under
    // the old implementation; the throw aborted the whole-pass transaction
    // and rolled back every other insert. With per-session txn + hardened
    // eventToRow, the bad row is skipped (or counted as an error) but the
    // good rows commit.
    const sessionId = 'sess_cccccccc-3333-4333-8333-333333333333';
    const sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeMeta(sessionDir, sessionId, 'ada');
    const badMessage: DurableEvent = {
      eventSeq: 2,
      timestamp: '2026-05-23T00:00:02Z',
      type: 'message',
      data: { role: 'assistant' }, // NO content
    };
    writeJsonl(join(sessionDir, 'events.jsonl'), [
      promptEvent(1, 'good-1'),
      badMessage,
      promptEvent(3, 'good-3'),
    ]);

    const stats = backfillIndex(db, laceDir);

    // Two good rows landed; the bad row was skipped (returned null) not
    // counted as error since eventToRow tolerates missing content now.
    expect(stats.inserted).toBe(2);
    const rows = allRows(db).filter((r) => r.session_id === sessionId);
    expect(rows.map((r) => r.event_id).sort()).toEqual([`${sessionId}:1`, `${sessionId}:3`]);
  });

  it('one malformed event in session A does not roll back session B (C2)', () => {
    // Cross-session isolation: per-session transactions ensure a bad row in
    // one session can't poison another. Even if session A throws inside its
    // transaction, session B's rows still commit.
    const sessionA = 'sess_dddddddd-4444-4444-8444-444444444444';
    const sessionB = 'sess_eeeeeeee-5555-4555-8555-555555555555';
    const dirA = join(laceDir, 'agent-sessions', sessionA);
    mkdirSync(dirA, { recursive: true });
    writeMeta(dirA, sessionA, 'ada');
    writeJsonl(join(dirA, 'events.jsonl'), [
      promptEvent(1, 'a-good'),
      { eventSeq: 2, timestamp: 'x', type: 'message', data: { role: 'assistant' } },
    ]);

    const dirB = join(laceDir, 'agent-sessions', sessionB);
    mkdirSync(dirB, { recursive: true });
    writeMeta(dirB, sessionB, 'bea');
    writeJsonl(join(dirB, 'events.jsonl'), [promptEvent(1, 'b-one'), promptEvent(2, 'b-two')]);

    backfillIndex(db, laceDir);

    const rowsB = allRows(db).filter((r) => r.session_id === sessionB);
    expect(rowsB.map((r) => r.event_id).sort()).toEqual([`${sessionB}:1`, `${sessionB}:2`]);
  });

  it('handles both layouts present at once', () => {
    // Legacy
    const legacyId = SESSION_IDS.legacyMix;
    const legacyDir = join(laceDir, 'agent-sessions', legacyId);
    mkdirSync(legacyDir, { recursive: true });
    writeMeta(legacyDir, legacyId, 'ada');
    writeJsonl(join(legacyDir, 'events.jsonl'), [promptEvent(1, 'legacy-1')]);

    // New
    const newId = SESSION_IDS.newMix;
    const newDir = join(laceDir, 'transcripts', 'bea', '2026-05-23');
    mkdirSync(newDir, { recursive: true });
    writeJsonl(join(newDir, `${newId}.jsonl`), [promptEvent(1, 'new-1'), promptEvent(2, 'new-2')]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(3);
    const rows = allRows(db);
    expect(rows).toHaveLength(3);
    const legacyRows = rows.filter((r) => r.session_id === legacyId);
    const newRows = rows.filter((r) => r.session_id === newId);
    expect(legacyRows).toHaveLength(1);
    expect(legacyRows[0].persona).toBe('ada');
    expect(newRows).toHaveLength(2);
    expect(newRows.every((r) => r.persona === 'bea')).toBe(true);
  });
});
