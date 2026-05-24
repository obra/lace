import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-bfcrash-'));
process.env.LACE_DIR = laceDir;

const sessionId = 'sess_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionDir = join(laceDir, 'agent-sessions', sessionId);
mkdirSync(sessionDir, { recursive: true });
writeFileSync(
  join(sessionDir, 'meta.json'),
  JSON.stringify({
    sessionId,
    workDir: laceDir,
    created: 'x',
    persona: 'ada',
  })
);

const events = [
  JSON.stringify({
    eventSeq: 1,
    timestamp: 'x',
    type: 'prompt',
    data: { type: 'prompt', content: [{ type: 'text', text: 'good 1' }] },
  }),
  // BAD event: message with no content
  JSON.stringify({ eventSeq: 2, timestamp: 'x', type: 'message', data: { role: 'assistant' } }),
  JSON.stringify({
    eventSeq: 3,
    timestamp: 'x',
    type: 'prompt',
    data: { type: 'prompt', content: [{ type: 'text', text: 'good 3' }] },
  }),
];
writeFileSync(join(sessionDir, 'events.jsonl'), events.join('\n') + '\n');

const { getRecallIndex, closeRecallIndex } = await import('../../src/storage/recall/index-db.js');
const { backfillIndex } = await import('../../src/storage/recall/backfill.js');

const db = getRecallIndex();
try {
  const stats = backfillIndex(db, laceDir);
  console.log('stats:', stats);
} catch (err) {
  console.log('backfill THREW:', (err as Error).message);
}

const rows = db.prepare(`SELECT event_id, content FROM events ORDER BY event_id`).all();
console.log('FTS rows:', JSON.stringify(rows, null, 2));

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
