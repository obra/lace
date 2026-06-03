// ABOUTME: Tests for index-db.ts — SQLite FTS5 opener for the recall index
// ABOUTME: Verifies schema creation, idempotency, and FTS round-trip on real SQLite

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeRecallIndex, getRecallIndex, openRecallIndex } from '../index-db';

describe('openRecallIndex', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('creates the events FTS5 table on first open', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toContain('events');
    } finally {
      db.close();
    }
  });

  it('creates the parent directory if missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const dbPath = join(dir, 'nested', 'subdir', 'index.sqlite');
    const db = openRecallIndex(dbPath);
    try {
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is idempotent on re-open (no throw, no duplicate table)', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const dbPath = join(dir, 'index.sqlite');
    openRecallIndex(dbPath).close();
    const db = openRecallIndex(dbPath);
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('uses WAL journal mode', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const mode = db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('sets a non-zero busy_timeout so contending writers wait instead of failing immediately', () => {
    // C5: multi-process subagents share the same index.sqlite. Without
    // busy_timeout, the second writer throws SQLITE_BUSY and the
    // write-through indexer drops the row (event-log.ts swallows the throw).
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const timeout = db.pragma('busy_timeout', { simple: true });
      expect(typeof timeout).toBe('number');
      expect(timeout as number).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('creates index.sqlite (and WAL/SHM if present) with mode 0o600', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-mode-'));
    const dbPath = join(dir, 'index.sqlite');
    const db = openRecallIndex(dbPath);
    try {
      // Force WAL sidecar by doing a write
      db.prepare(
        `INSERT INTO events (event_id, session_id, ts, persona, kind, content) VALUES (?, ?, ?, ?, ?, ?)`
      ).run('sess_x:1', 'sess_x', '2026-05-23T00:00:00Z', 'ada', 'user_message', 'hi');

      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = dbPath + suffix;
        if (existsSync(sidecar)) {
          expect(statSync(sidecar).mode & 0o777).toBe(0o600);
        }
      }
    } finally {
      db.close();
    }
  });

  it('roundtrips a row through FTS (insert + MATCH returns expected row)', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      db.prepare(
        `INSERT INTO events (event_id, session_id, ts, persona, kind, content) VALUES (?, ?, ?, ?, ?, ?)`
      ).run('sess_x:1', 'sess_x', '2026-05-23T00:00:00Z', 'ada', 'user_message', 'hello world');
      const rows = db
        .prepare(`SELECT event_id FROM events WHERE content MATCH 'hello'`)
        .all() as Array<{ event_id: string }>;
      expect(rows).toEqual([{ event_id: 'sess_x:1' }]);
    } finally {
      db.close();
    }
  });
});

describe('schema version and track column', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('creates a _meta table with the current schema version', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-ver-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const row = db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as
        | { value: string }
        | undefined;
      expect(row).toBeDefined();
      expect(Number(row!.value)).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('creates the events table with a track column', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-track-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      // Insert a row with a track value and read it back
      db.prepare(
        `INSERT INTO events (event_id, session_id, ts, persona, kind, content, track)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'sess_x:1',
        'sess_x',
        '2026-06-01T00:00:00Z',
        'ada',
        'user_message',
        'hi',
        'slack:T1:C1/1.0'
      );
      const row = db.prepare(`SELECT track FROM events WHERE event_id = ?`).get('sess_x:1') as
        | { track: string | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.track).toBe('slack:T1:C1/1.0');
    } finally {
      db.close();
    }
  });

  it('rebuilds the events table when the DB has an older schema version', async () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-rebuild-'));
    const dbPath = join(dir, 'index.sqlite');

    // Simulate an old DB: create the old 6-column schema (no track) manually,
    // set _meta.schema_version to 0 so openRecallIndex detects a stale schema.
    const Database = (await import('better-sqlite3')).default;
    const oldDb = new Database(dbPath);
    oldDb.exec(`
      CREATE VIRTUAL TABLE events USING fts5(
        event_id UNINDEXED, session_id UNINDEXED, ts UNINDEXED,
        persona UNINDEXED, kind UNINDEXED, content,
        tokenize = 'porter unicode61'
      );
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta VALUES ('schema_version', '0');
    `);
    // Seed a row in the old schema
    oldDb
      .prepare(
        `INSERT INTO events (event_id, session_id, ts, persona, kind, content)
       VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('sess_y:1', 'sess_y', '2026-06-01T00:00:00Z', 'ada', 'user_message', 'old content');
    oldDb.close();

    // openRecallIndex must detect the version mismatch and rebuild
    const db = openRecallIndex(dbPath);
    try {
      // After rebuild, the table exists (was dropped + recreated), version is current
      const verRow = db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as
        | { value: string }
        | undefined;
      expect(Number(verRow!.value)).toBeGreaterThan(0);

      // The track column must now be present (insert with track succeeds)
      expect(() =>
        db
          .prepare(
            `INSERT INTO events (event_id, session_id, ts, persona, kind, content, track)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            'sess_z:1',
            'sess_z',
            '2026-06-01T00:00:00Z',
            'ada',
            'user_message',
            'new',
            'slack:T2:C2'
          )
      ).not.toThrow();

      // Old rows were dropped (backfill repopulates them — that's the known trade-off)
      const oldRow = db.prepare(`SELECT 1 FROM events WHERE event_id = ?`).get('sess_y:1');
      expect(oldRow).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe('getRecallIndex / closeRecallIndex', () => {
  let dir: string | undefined;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    dir = mkdtempSync(join(tmpdir(), 'recall-singleton-'));
    process.env.LACE_DIR = dir;
  });

  afterEach(() => {
    closeRecallIndex();
    if (savedLaceDir === undefined) {
      delete process.env.LACE_DIR;
    } else {
      process.env.LACE_DIR = savedLaceDir;
    }
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('returns the same instance on repeated calls', () => {
    const a = getRecallIndex();
    const b = getRecallIndex();
    expect(a).toBe(b);
  });

  it('writes the DB under <laceDir>/recall/index.sqlite', () => {
    getRecallIndex();
    expect(existsSync(join(dir!, 'recall', 'index.sqlite'))).toBe(true);
  });

  it('returns a fresh instance after closeRecallIndex()', () => {
    const a = getRecallIndex();
    closeRecallIndex();
    const b = getRecallIndex();
    expect(a).not.toBe(b);
  });

  it('closeRecallIndex() is a no-op when no instance is open', () => {
    expect(() => closeRecallIndex()).not.toThrow();
    expect(() => {
      closeRecallIndex();
      closeRecallIndex();
    }).not.toThrow();
  });
});
