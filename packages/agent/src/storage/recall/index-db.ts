// ABOUTME: Opens (and lazily creates) the SQLite FTS5 index used by the recall tool
// ABOUTME: One DB per lace instance; survives container rebuilds on the persistent state volume

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getLaceDir } from '../../config/lace-dir';
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from '../transcript-paths';

export type { Db };

// Bump this integer whenever the FTS5 virtual-table schema changes.
// FTS5 does not support ALTER TABLE ADD COLUMN, so a version mismatch triggers
// a DROP + CREATE (full index rebuild). The backfill path then repopulates the
// index on the next startup.
//
// History:
//   1 — initial schema (event_id, session_id, ts, persona, kind, content)
//   2 — added track UNINDEXED column (Task 9, 2026-06-03)
//   3 — added the event_journal verbatim-line store (2026-06-18)
export const SCHEMA_VERSION = 3;

const EVENTS_SCHEMA = `
CREATE VIRTUAL TABLE events USING fts5(
  event_id UNINDEXED,
  session_id UNINDEXED,
  ts UNINDEXED,
  persona UNINDEXED,
  kind UNINDEXED,
  content,
  track UNINDEXED,
  tokenize = 'porter unicode61'
);
`;

// One row per durable event, storing the VERBATIM JSONL line. Unlike the FTS
// `events` table this captures EVERY event type (not just the 5 indexed kinds),
// so /recall can return original event bytes instead of the lossy FTS render.
// It is a plain table (not a virtual FTS table), so it survives a version bump
// without being dropped — created unconditionally with CREATE IF NOT EXISTS so
// existing DBs gain it on the next open. Best-effort + backfill-repaired like
// the FTS index; never on a correctness path.
const EVENT_JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS event_journal (
  session_id TEXT    NOT NULL,
  event_seq  INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  ts         TEXT    NOT NULL,
  line       TEXT    NOT NULL,
  PRIMARY KEY (session_id, event_seq)
);
CREATE INDEX IF NOT EXISTS ej_session ON event_journal(session_id, event_seq);
`;

function ensureWalMode(db: Db): void {
  // busy_timeout (set just before this call) covers normal write contention
  // but does NOT cover the EXCLUSIVE lock that journal_mode acquires. During
  // a concurrent first-open both the SET and the READ pragmas can trip
  // SQLITE_BUSY. Retry until the deadline; check the mode each cycle so we
  // exit as soon as a sibling process has WAL in place.
  const deadline = Date.now() + 5000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const current = db.pragma('journal_mode', { simple: true }) as string;
      if (current === 'wal') return;
      db.pragma('journal_mode = WAL');
      return;
    } catch (err) {
      lastErr = err;
      // Brief sleep before retry. better-sqlite3 is synchronous, so use a
      // tight busy-wait — these races resolve in microseconds in practice.
      const spinUntil = Date.now() + 5;
      while (Date.now() < spinUntil) {
        /* spin */
      }
    }
  }
  throw lastErr;
}

export function openRecallIndex(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: SECURE_DIR_MODE });
  const db = new Database(dbPath);
  // Multi-process subagent containers share LACE_DIR and contend on this
  // file. WAL allows concurrent readers + one writer, but contending writers
  // still get SQLITE_BUSY immediately without a timeout. 5 seconds is long
  // enough for any single-row insert to complete, short enough to avoid
  // unbounded blocking of the event-write path on a true deadlock.
  //
  // ORDER MATTERS: busy_timeout must be set BEFORE journal_mode. The
  // journal_mode pragma briefly acquires the write lock to switch modes; if
  // another process is mid-write it returns SQLITE_BUSY immediately unless
  // busy_timeout is already in effect.
  db.pragma('busy_timeout = 5000');
  // Setting journal_mode = WAL needs an EXCLUSIVE lock and busy_timeout
  // does NOT cover that path — a concurrent writer trips SQLITE_BUSY
  // immediately. WAL persists across opens, so after the first successful
  // set every subsequent open already sees mode='wal' and skips the
  // assignment. We still need to handle the genuinely racy first-open case
  // (multiple processes simultaneously opening a new DB): if the SET trips
  // BUSY, re-read the mode — most often a sibling process won the race and
  // already put it in WAL. Only re-throw if it's still not WAL.
  ensureWalMode(db);
  applySchema(db);
  // Apply 0o600 to the index file and any WAL/SHM sidecars. In-memory
  // databases (dbPath === ':memory:') have no on-disk file; skip them.
  if (dbPath !== ':memory:') {
    if (fs.existsSync(dbPath)) {
      fs.chmodSync(dbPath, SECURE_FILE_MODE);
    }
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = dbPath + suffix;
      if (fs.existsSync(sidecar)) {
        fs.chmodSync(sidecar, SECURE_FILE_MODE);
      }
    }
  }
  return db;
}

/**
 * Create or upgrade the recall schema.
 *
 * Strategy: maintain a `_meta` table with a `schema_version` key. On each
 * open, compare the stored version against SCHEMA_VERSION. If they differ
 * (or the table doesn't exist yet), drop the FTS5 `events` table and
 * recreate it with the current schema. FTS5 virtual tables cannot have
 * columns added via ALTER TABLE, so a rebuild is the only upgrade path.
 *
 * After a rebuild the index is empty; the startup backfill repopulates it
 * on the next launch. This is the same behaviour as a fresh install: all
 * data lives in JSONL on disk and is never lost, only re-indexed.
 */
function applySchema(db: Db): void {
  // Ensure the _meta table exists (safe to run unconditionally).
  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // The journal is a plain table (not FTS5), so it can be created additively
  // every open without dropping data. Run it unconditionally — independent of
  // the FTS version gate below — so existing DBs gain the table without losing
  // their FTS index, and so a brand-new DB has it before any write-through.
  db.exec(EVENT_JOURNAL_SCHEMA);

  const metaRow = db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;

  const storedVersion = metaRow !== undefined ? Number(metaRow.value) : 0;

  if (storedVersion === SCHEMA_VERSION) {
    // Schema is current — nothing to do.
    return;
  }

  // Version mismatch (or first open on a DB that never had _meta).
  // Drop the existing FTS5 table (if any) and recreate with the current schema.
  // FTS5 stores index data in shadow tables named events_*, so a simple
  // DROP TABLE on the virtual table removes them all.
  db.exec(`DROP TABLE IF EXISTS events;`);
  db.exec(EVENTS_SCHEMA);
  db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`).run(
    String(SCHEMA_VERSION)
  );
}

let _instance: Db | null = null;

/**
 * Lazily open and return the process-scope recall index. The DB lives at
 * `<laceDir>/recall/index.sqlite`. All write-through and read callers share
 * this single handle so we don't fight better-sqlite3 over multiple opens
 * against the same WAL file.
 */
export function getRecallIndex(): Db {
  if (_instance) return _instance;
  const dbPath = path.join(getLaceDir(), 'recall', 'index.sqlite');
  _instance = openRecallIndex(dbPath);
  return _instance;
}

/**
 * Close the singleton index, if any. Safe to call when no instance is open.
 * Intended for graceful shutdown and for tests that need a fresh DB per case.
 */
export function closeRecallIndex(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}
