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
