// ABOUTME: Tests for the event_journal store — verbatim-line recall over real SQLite
// ABOUTME: Covers schema, unfiltered writer, write-through on append, backfill, and recall return

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { closeRecallIndex, getRecallIndex, openRecallIndex } from '../index-db';
import { insertJournalRow } from '../index-writer';
import { appendDurableEvent } from '../../event-log';
import { backfillIndex } from '../backfill';

describe('event_journal schema', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-ej-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates event_journal with the verbatim-line column', () => {
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const cols = db.prepare(`PRAGMA table_info(event_journal)`).all() as { name: string }[];
      const names = cols.map((c) => c.name).sort();
      expect(names).toEqual(['event_seq', 'line', 'session_id', 'ts', 'type'].sort());
    } finally {
      db.close();
    }
  });
});

describe('insertJournalRow', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-ej-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('journals EVERY event type incl. turn_end, idempotently', () => {
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const line = JSON.stringify({
        eventSeq: 7,
        timestamp: 't',
        type: 'turn_end',
        data: { stopReason: 'end_turn' },
      });
      insertJournalRow(db, { session_id: 's1', event_seq: 7, type: 'turn_end', ts: 't', line });
      // Duplicate PK → no-op (INSERT OR IGNORE).
      insertJournalRow(db, { session_id: 's1', event_seq: 7, type: 'turn_end', ts: 't', line });
      const rows = db.prepare(`SELECT line FROM event_journal WHERE session_id='s1'`).all() as {
        line: string;
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].line).toBe(line);
    } finally {
      db.close();
    }
  });
});

/**
 * Stand up a laceDir + sessionDir (with persona meta) and point LACE_DIR at it
 * so appendDurableEvent / getRecallIndex resolve to this tempdir. Mirrors the
 * helper in event-log.test.ts.
 */
function makeTestSessionDirs(persona: string | null = 'ada'): {
  laceDir: string;
  sessionDir: string;
  sessionId: string;
} {
  const laceDir = mkdtempSync(join(tmpdir(), 'lace-ej-append-'));
  const sessionId = `sess_${randomUUID()}`;
  const sessionDir = join(laceDir, 'agent-sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  if (persona !== null) {
    writeFileSync(
      join(sessionDir, 'meta.json'),
      JSON.stringify({
        sessionId,
        workDir: laceDir,
        created: new Date().toISOString(),
        persona,
      })
    );
  }
  return { laceDir, sessionDir, sessionId };
}

describe('event_journal write-through on append', () => {
  let savedLaceDir: string | undefined;
  let laceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
  });

  afterEach(() => {
    // The write-through opens the process-singleton index rooted at LACE_DIR;
    // release it before removing the tempdir so the singleton never points at
    // a deleted file.
    closeRecallIndex();
    if (savedLaceDir === undefined) {
      delete process.env.LACE_DIR;
    } else {
      process.env.LACE_DIR = savedLaceDir;
    }
    if (laceDir) {
      rmSync(laceDir, { recursive: true, force: true });
      laceDir = undefined;
    }
  });

  it('journals the verbatim line for appended events incl. turn_end', () => {
    const dirs = makeTestSessionDirs();
    laceDir = dirs.laceDir;
    process.env.LACE_DIR = dirs.laceDir;

    let state = { nextEventSeq: 1, nextStreamSeq: 1 };
    const prompt = appendDurableEvent(dirs.sessionDir, state, {
      type: 'prompt',
      data: { content: [{ type: 'text', text: 'hi' }] },
    });
    state = prompt.nextState;
    const turnEnd = appendDurableEvent(dirs.sessionDir, state, {
      type: 'turn_end',
      data: { stopReason: 'end_turn' },
    });

    const db = getRecallIndex();
    const rows = db
      .prepare(
        `SELECT event_seq, type, line FROM event_journal WHERE session_id = ? ORDER BY event_seq`
      )
      .all(dirs.sessionId) as { event_seq: number; type: string; line: string }[];

    expect(rows).toHaveLength(2);
    // turn_end is dropped by the FTS filter but MUST be journaled.
    expect(rows.map((r) => r.type)).toEqual(['prompt', 'turn_end']);
    // The verbatim line is byte-identical to JSON.stringify(written) — the same
    // bytes appendDurableEvent wrote to the JSONL (minus the trailing newline).
    expect(rows[0].line).toBe(JSON.stringify(prompt.written));
    expect(rows[1].line).toBe(JSON.stringify(turnEnd.written));
  });
});

describe('event_journal backfill', () => {
  let dir: string;
  let savedLaceDir: string | undefined;
  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    dir = mkdtempSync(join(tmpdir(), 'lace-ej-backfill-'));
    process.env.LACE_DIR = dir;
  });
  afterEach(() => {
    if (savedLaceDir === undefined) {
      delete process.env.LACE_DIR;
    } else {
      process.env.LACE_DIR = savedLaceDir;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('journals every scanned event (incl. turn_end) with the raw JSONL line', () => {
    const sessionId = `sess_${randomUUID()}`;
    const sessionDir = join(dir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const promptLine = JSON.stringify({
      eventSeq: 1,
      timestamp: '2026-06-18T00:00:00Z',
      type: 'prompt',
      data: { content: [{ type: 'text', text: 'hi' }] },
    });
    const turnEndLine = JSON.stringify({
      eventSeq: 2,
      timestamp: '2026-06-18T00:00:01Z',
      type: 'turn_end',
      data: { stopReason: 'end_turn' },
    });
    writeFileSync(join(sessionDir, 'events.jsonl'), `${promptLine}\n${turnEndLine}\n`);

    const db = openRecallIndex(join(dir, 'recall', 'index.sqlite'));
    try {
      backfillIndex(db, dir);
      const rows = db
        .prepare(
          `SELECT event_seq, type, line FROM event_journal WHERE session_id = ? ORDER BY event_seq`
        )
        .all(sessionId) as { event_seq: number; type: string; line: string }[];
      expect(rows.map((r) => r.type)).toEqual(['prompt', 'turn_end']);
      expect(rows[0].line).toBe(promptLine);
      expect(rows[1].line).toBe(turnEndLine);

      // Re-running backfill is idempotent (PK dedup).
      backfillIndex(db, dir);
      const again = db
        .prepare(`SELECT COUNT(*) AS n FROM event_journal WHERE session_id = ?`)
        .get(sessionId) as { n: number };
      expect(again.n).toBe(2);
    } finally {
      db.close();
    }
  });
});
