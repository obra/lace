// ABOUTME: Opens (and lazily creates) the SQLite FTS5 index used by the recall tool
// ABOUTME: One DB per lace instance; survives container rebuilds on the persistent state volume

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
  db.exec(SCHEMA);
  return db;
}
