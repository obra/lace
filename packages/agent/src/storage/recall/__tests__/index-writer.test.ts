// ABOUTME: Tests for index-writer.ts — idempotent insert into the recall FTS5 index
// ABOUTME: Verifies first-write happens and duplicate event_id is a no-op

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex, type Db } from '../index-db';
import { insertRow } from '../index-writer';
import type { RecallRow } from '../event-to-row';

const ROW: RecallRow = {
  event_id: 'sess_x:1',
  session_id: 'sess_x',
  ts: '2026-05-23T00:00:00Z',
  persona: 'ada',
  kind: 'user_message',
  content: 'hello world',
  track: null,
};

// The version-3 writer inserts directly into FTS and knows nothing about keys.
function appendFtsOnly(db: Db, eventId: string, content: string): void {
  db.prepare('INSERT INTO events (event_id, session_id, content) VALUES (?, ?, ?)').run(
    eventId,
    ROW.session_id,
    content
  );
}

describe('insertRow', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'recall-writer-'));
    db = openRecallIndex(join(dir, 'index.sqlite'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('inserts a new row', () => {
    insertRow(db, ROW);
    const rows = db
      .prepare(`SELECT event_id, session_id, persona, kind, content FROM events`)
      .all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        event_id: 'sess_x:1',
        session_id: 'sess_x',
        persona: 'ada',
        kind: 'user_message',
        content: 'hello world',
      },
    ]);
    expect(db.prepare('SELECT event_id, session_id FROM event_keys').all()).toEqual([
      { event_id: 'sess_x:1', session_id: 'sess_x' },
    ]);
    expect(
      db.prepare("SELECT value FROM _meta WHERE key = 'events_last_rowid'").pluck().get()
    ).toBe('1');
  });

  it('is a no-op when event_id is already present (no duplicate, no throw)', () => {
    insertRow(db, ROW);
    insertRow(db, ROW);
    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_id = ?`).get(ROW.event_id) as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it('does not overwrite the original row when a duplicate event_id is offered', () => {
    insertRow(db, ROW);
    insertRow(db, { ...ROW, content: 'different content', persona: 'bea' });
    const row = db
      .prepare(`SELECT content, persona FROM events WHERE event_id = ?`)
      .get(ROW.event_id) as { content: string; persona: string };
    expect(row).toEqual({ content: 'hello world', persona: 'ada' });
  });

  it('imports identifiers from a version-3 index and retains duplicate FTS rows', () => {
    db.exec('DROP TABLE IF EXISTS event_keys');
    appendFtsOnly(db, ROW.event_id, 'first record');
    appendFtsOnly(db, ROW.event_id, 'historical duplicate');
    db.close();
    db = openRecallIndex(join(dir, 'index.sqlite'));

    insertRow(db, ROW);

    expect(db.prepare('SELECT content FROM events ORDER BY rowid').pluck().all()).toEqual([
      'first record',
      'historical duplicate',
    ]);
    expect(db.prepare('SELECT event_id FROM event_keys').pluck().all()).toEqual(['sess_x:1']);
    expect(
      db.prepare("SELECT value FROM _meta WHERE key = 'events_last_rowid'").pluck().get()
    ).toBe('2');
  });

  it('records rows appended by a prior writer while the upgraded connection stays open', () => {
    insertRow(db, ROW);
    const prior = new Database(join(dir, 'index.sqlite'));
    try {
      appendFtsOnly(prior, 'sess_x:2', 'prior writer');

      insertRow(db, { ...ROW, event_id: 'sess_x:3', content: 'upgraded writer' });
      insertRow(db, { ...ROW, event_id: 'sess_x:2', content: 'would be duplicate' });

      expect(db.prepare('SELECT content FROM events ORDER BY rowid').pluck().all()).toEqual([
        'hello world',
        'prior writer',
        'upgraded writer',
      ]);
      expect(db.prepare('SELECT event_id FROM event_keys ORDER BY event_id').pluck().all()).toEqual(
        ['sess_x:1', 'sess_x:2', 'sess_x:3']
      );
    } finally {
      prior.close();
    }
  });

  it('handles null persona', () => {
    insertRow(db, { ...ROW, event_id: 'sess_x:2', persona: null });
    const row = db.prepare(`SELECT persona FROM events WHERE event_id = ?`).get('sess_x:2') as {
      persona: string | null;
    };
    expect(row.persona).toBeNull();
  });

  it('persists a non-null track value', () => {
    insertRow(db, { ...ROW, event_id: 'sess_x:3', track: 'slack:T1:C1/1.0' });
    const row = db.prepare(`SELECT track FROM events WHERE event_id = ?`).get('sess_x:3') as {
      track: string | null;
    };
    expect(row.track).toBe('slack:T1:C1/1.0');
  });

  it('persists null track', () => {
    insertRow(db, { ...ROW, event_id: 'sess_x:4', track: null });
    const row = db.prepare(`SELECT track FROM events WHERE event_id = ?`).get('sess_x:4') as {
      track: string | null;
    };
    expect(row.track).toBeNull();
  });

  it('stays idempotent across 100 same-row inserts (single-process; cross-process covered by probe)', () => {
    // Single-process can't reproduce the FTS duplicate-row race (no concurrency
    // here), but this guards against regressions in the existence check and
    // exercises the BEGIN IMMEDIATE wrapping path 100 times. Real verification
    // of cross-process serialization lives in
    // tests/scenarios/recall-probe-concurrent-cross-process.ts.
    for (let i = 0; i < 100; i++) {
      insertRow(db, ROW);
    }
    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_id = ?`).get(ROW.event_id) as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });
});
