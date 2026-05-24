import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'recall-snip2-'));
const dbPath = join(dir, 'idx.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`CREATE VIRTUAL TABLE events USING fts5(event_id UNINDEXED, content);`);
const longText =
  'one two three four five six seven eight nine ten Bearer xoxb-1234567890-abcdefghijxxxx-yyyy and more text';
db.prepare(`INSERT INTO events VALUES (?, ?)`).run('e1', longText);
// Search for 'three' — match is far from the secret
const row = db
  .prepare(
    `SELECT snippet(events, 1, '', '', '...', 8) AS preview FROM events WHERE content MATCH 'three'`
  )
  .get();
console.log('preview:', JSON.stringify(row));
// Search for 'one' — match at the start, snippet cuts off before the secret
const row2 = db
  .prepare(
    `SELECT snippet(events, 1, '', '', '...', 6) AS preview FROM events WHERE content MATCH 'one'`
  )
  .get();
console.log('preview2:', JSON.stringify(row2));
// Search where token preceding 'xoxb...' is the match, snippet only includes part of the token
const row3 = db
  .prepare(
    `SELECT snippet(events, 1, '', '', '...', 3) AS preview FROM events WHERE content MATCH 'Bearer'`
  )
  .get();
console.log('preview3:', JSON.stringify(row3));

// Try to get a partial-token snippet
const row4 = db
  .prepare(
    `SELECT snippet(events, 1, '', '', '...', 4) AS preview FROM events WHERE content MATCH 'Bearer'`
  )
  .get();
console.log('preview4:', JSON.stringify(row4));

db.close();
rmSync(dir, { recursive: true, force: true });
