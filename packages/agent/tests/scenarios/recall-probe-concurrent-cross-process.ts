// ABOUTME: Cross-process probe demonstrating BEGIN IMMEDIATE prevents duplicate FTS rows
// ABOUTME: Spawns two child processes that both try to insert the same event_id concurrently.
//
// H2 cannot be reproduced from a single Node process because better-sqlite3 is
// fully synchronous: a contending writer blocks the event loop, so the second
// "concurrent" insertRow call can only run AFTER the first returns — at which
// point the row exists and the existence check skips. The race only manifests
// when two separate OS processes hold distinct SQLite connections and
// interleave their SELECT/INSERT.
//
// Run via: `npx tsx tests/scenarios/recall-probe-concurrent-cross-process.ts`
// Requires `cd packages/agent && npm run build` first (children import from dist/).

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', '..', 'dist', 'storage', 'recall');
const indexDbPath = join(distDir, 'index-db.js');
const indexWriterPath = join(distDir, 'index-writer.js');

const laceDir = mkdtempSync(join(tmpdir(), 'recall-xproc-'));
process.env.LACE_DIR = laceDir;

const INSERTS_PER_CHILD = 50;
// Multiple rounds, each with a FRESH event_id, to give every race a fresh
// chance to surface duplicates. Single-row tests can win the race in the
// racy-version by serializing on process startup; many rounds keep the
// contention window open while both processes are warm.
const ROUNDS = 30;

// Tiny driver each child runs. Both children open the SAME index.sqlite,
// fight over the same row 50 times each.
const driverPath = join(laceDir, 'insert-driver.mjs');
const driverSrc = `
import { openRecallIndex } from ${JSON.stringify(indexDbPath)};
import { insertRow } from ${JSON.stringify(indexWriterPath)};

const dbPath = process.argv[2];
const startTime = Number(process.argv[3]);
const db = openRecallIndex(dbPath);

// Block until the agreed start time so both children hit the loop
// simultaneously. Aligns the contention window across processes.
while (Date.now() < startTime) { /* spin */ }

for (let round = 0; round < ${ROUNDS}; round++) {
  const row = {
    event_id: 'evt_' + round,
    session_id: 'sess_xproc',
    ts: '2026-05-23T00:00:00Z',
    persona: 'ada',
    kind: 'user_message',
    content: 'round ' + round,
  };
  for (let i = 0; i < ${INSERTS_PER_CHILD}; i++) {
    insertRow(db, row);
  }
}
db.close();
console.log('done');
`;
writeFileSync(driverPath, driverSrc);

const dbPath = join(laceDir, 'index.sqlite');

interface ChildResult {
  pid: number;
  code: number | null;
  stderr: string;
  stdout: string;
}

function runChild(startTime: number): Promise<ChildResult> {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn('node', [driverPath, dbPath, String(startTime)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('exit', (code) => {
      resolveChild({ pid: child.pid ?? -1, code, stderr, stdout });
    });
    child.on('error', (err) => {
      rejectChild(err);
    });
  });
}

(async () => {
  let exitCode = 0;
  try {
    // Aligned start: 500ms in the future so both children finish their
    // module-load work, then spin-wait until the agreed moment. Without this
    // the children serialize at process-start and miss the race window.
    const startTime = Date.now() + 500;

    const results = await Promise.all([runChild(startTime), runChild(startTime)]);

    for (const r of results) {
      if (r.code !== 0) {
        throw new Error(
          `child pid=${r.pid} exited ${r.code}\nSTDERR: ${r.stderr}\nSTDOUT: ${r.stdout}`
        );
      }
    }

    // Verify: every contended event_id should have exactly one row.
    const { openRecallIndex } = (await import(
      indexDbPath
    )) as typeof import('../../dist/storage/recall/index-db.js');
    const db = openRecallIndex(dbPath);
    const rows = db
      .prepare(`SELECT event_id, COUNT(*) c FROM events GROUP BY event_id ORDER BY event_id`)
      .all() as Array<{ event_id: string; c: number }>;
    db.close();

    assert.equal(rows.length, ROUNDS, `expected ${ROUNDS} distinct event_ids, got ${rows.length}`);
    const dupes = rows.filter((r) => r.c !== 1);
    if (dupes.length > 0) {
      throw new Error(
        `duplicate rows found in ${dupes.length}/${ROUNDS} rounds: ${dupes
          .map((d) => `${d.event_id}=${d.c}`)
          .join(', ')}`
      );
    }

    console.log(
      `SUMMARY: OK (${ROUNDS} rounds, ${INSERTS_PER_CHILD * 2} concurrent inserts per round from 2 processes, all single-row)`
    );
  } catch (err) {
    console.error('SUMMARY: FAIL', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    exitCode = 1;
  } finally {
    rmSync(laceDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
})();
