import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'recall-snip-'));
const dbPath = join(dir, 'idx.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(
  `CREATE VIRTUAL TABLE events USING fts5(event_id UNINDEXED, content, tokenize='porter unicode61');`
);
db.prepare(`INSERT INTO events VALUES (?, ?)`).run(
  'e1',
  'Bearer xoxb-1234567890-abcdefghij-abcdefghij here in the logs we see secrets'
);
const row = db
  .prepare(
    `SELECT snippet(events, 1, '<<', '>>', '...', 32) AS preview FROM events WHERE content MATCH 'logs'`
  )
  .get();
console.log('preview:', JSON.stringify(row));

// Now query for a piece of the token to see how it tokenizes
const r2 = db
  .prepare(
    `SELECT snippet(events, 1, '<<', '>>', '...', 8) AS preview FROM events WHERE content MATCH 'xoxb'`
  )
  .get();
console.log('preview xoxb match:', JSON.stringify(r2));

const r3 = db
  .prepare(
    `SELECT snippet(events, 1, '', '', '...', 32) AS preview FROM events WHERE content MATCH 'Bearer'`
  )
  .get();
console.log('preview bearer:', JSON.stringify(r3));

db.close();
rmSync(dir, { recursive: true, force: true });
