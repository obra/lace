// ABOUTME: Opens (and lazily creates) the SQLite FTS5 index used by the recall tool
// ABOUTME: One DB per lace instance; survives container rebuilds on the persistent state volume

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getLaceDir } from '../../config/lace-dir';

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

export function openRecallIndex(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // Multi-process subagent containers share LACE_DIR and contend on this
  // file. WAL allows concurrent readers + one writer, but contending writers
  // still get SQLITE_BUSY immediately without a timeout. 5 seconds is long
  // enough for any single-row insert to complete, short enough to avoid
  // unbounded blocking of the event-write path on a true deadlock.
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
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
