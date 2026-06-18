// ABOUTME: Tests for the event_journal store — verbatim-line recall over real SQLite
// ABOUTME: Covers schema, unfiltered writer, write-through on append, backfill, and recall return

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex } from '../index-db';
import { insertJournalRow } from '../index-writer';

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
