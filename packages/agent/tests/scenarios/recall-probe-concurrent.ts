// Validates C5: openRecallIndex sets busy_timeout > 0. Cross-process
// contention is hard to set up deterministically from a single Node process
// (better-sqlite3 is fully synchronous so a contending writer blocks the
// event loop — the timer that would release the lock never fires). What we
// can verify here is that the pragma is set on every connection from the
// shared opener; the existing index-db.test.ts test covers the value.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex } from '../../src/storage/recall/index-db.js';

const dir = mkdtempSync(join(tmpdir(), 'recall-concurrent-'));
const dbPath = join(dir, 'idx.sqlite');

const db1 = openRecallIndex(dbPath);
const db2 = openRecallIndex(dbPath);

const t1 = db1.pragma('busy_timeout', { simple: true });
const t2 = db2.pragma('busy_timeout', { simple: true });
console.log('db1 busy_timeout =', t1, 'ms');
console.log('db2 busy_timeout =', t2, 'ms');
if (typeof t1 === 'number' && t1 > 0 && typeof t2 === 'number' && t2 > 0) {
  console.log('C5: PASS — both connections have a non-zero busy_timeout');
} else {
  console.log('C5: FAIL — busy_timeout missing');
}

db1.close();
db2.close();
rmSync(dir, { recursive: true, force: true });
