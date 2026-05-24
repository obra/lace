import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'recall-concurrent2-'));
const dbPath = join(dir, 'idx.sqlite');

const create = () => {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS events USING fts5(event_id UNINDEXED, content);`);
  return db;
};

// Process A backfill (long write txn)
const db1 = create();
db1.prepare(`BEGIN IMMEDIATE`).run();
for (let i = 0; i < 100; i++) {
  db1.prepare(`INSERT INTO events VALUES (?, ?)`).run(`e${i}`, 'hello world');
}

// Process B read (should be fine in WAL mode)
const db2 = create();
try {
  const rows = db2.prepare(`SELECT count(*) c FROM events`).all();
  console.log('read OK', JSON.stringify(rows));
} catch (err) {
  console.log('read BUSY:', (err as Error).message);
}

// Process B WRITE during A's open txn → BUSY
try {
  db2.prepare(`INSERT INTO events VALUES (?, ?)`).run('eNEW', 'hello');
  console.log('write OK');
} catch (err) {
  console.log('write BUSY:', (err as Error).message);
}

db1.prepare(`COMMIT`).run();
db1.close();
db2.close();
rmSync(dir, { recursive: true, force: true });
