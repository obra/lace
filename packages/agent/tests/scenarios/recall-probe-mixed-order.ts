import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-mo-'));
process.env.LACE_DIR = laceDir;

// Make 'ada' BEFORE '_unknown' in readdir order — depends on FS but check on mac
mkdirSync(join(laceDir, 'transcripts', 'ada'), { recursive: true });
mkdirSync(join(laceDir, 'transcripts', '_unknown'), { recursive: true });
console.log('readdir order:', readdirSync(join(laceDir, 'transcripts')));

// Use 'zz_dummy' so it iterates LAST and ada iterates first
const sessionId = 'sess_22222222-3333-4444-5555-666666666666';
mkdirSync(join(laceDir, 'agent-sessions', sessionId), { recursive: true });
writeFileSync(
  join(laceDir, 'agent-sessions', sessionId, 'meta.json'),
  JSON.stringify({ sessionId, workDir: laceDir, created: 'x', persona: 'ada' })
);

mkdirSync(join(laceDir, 'transcripts', 'ada', '2026-05-23'), { recursive: true });
writeFileSync(
  join(laceDir, 'transcripts', 'ada', '2026-05-23', `${sessionId}.jsonl`),
  // Higher eventSeq (later events) in 'ada'
  [10, 11, 12]
    .map((s) =>
      JSON.stringify({
        eventSeq: s,
        timestamp: `2026-05-23T10:0${s}:00Z`,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: `later ${s}` }] },
      })
    )
    .join('\n') + '\n'
);

mkdirSync(join(laceDir, 'transcripts', '_unknown', '2026-05-23'), { recursive: true });
writeFileSync(
  join(laceDir, 'transcripts', '_unknown', '2026-05-23', `${sessionId}.jsonl`),
  // Lower eventSeq (earlier events) in '_unknown'
  [1, 2, 3]
    .map((s) =>
      JSON.stringify({
        eventSeq: s,
        timestamp: `2026-05-23T01:0${s}:00Z`,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: `earlier ${s}` }] },
      })
    )
    .join('\n') + '\n'
);

console.log('After write, readdir order:', readdirSync(join(laceDir, 'transcripts')));

const { getRecallIndex, closeRecallIndex } = await import('../../src/storage/recall/index-db.js');
const { backfillIndex } = await import('../../src/storage/recall/backfill.js');

const db = getRecallIndex();
const stats = backfillIndex(db, laceDir);
console.log('stats:', stats);

const rows = db
  .prepare(`SELECT event_id, persona FROM events WHERE session_id = ? ORDER BY event_id`)
  .all(sessionId);
console.log('FTS rows (expected 6, eventSeq 1,2,3,10,11,12):');
for (const r of rows) console.log('  ', JSON.stringify(r));

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
