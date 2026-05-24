// ABOUTME: Opens (and lazily creates) the SQLite FTS5 index used by the recall tool
// ABOUTME: One DB per lace instance; survives container rebuilds on the persistent state volume

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getLaceDir } from '../../config/lace-dir';
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from '../transcript-paths';

export type { Db };

const SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS events USING fts5(
  event_id UNINDEXED,
  session_id UNINDEXED,
  ts UNINDEXED,
  persona UNINDEXED,
  kind UNINDEXED,
  content,
  tokenize = 'porter unicode61'
);
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
  db.exec(SCHEMA);
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
