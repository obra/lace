import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-bf-'));
process.env.LACE_DIR = laceDir;

// Set up legacy events: sess_X with eventSeq 1, 2, 3
const sessionId = 'sess_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const legacyDir = join(laceDir, 'agent-sessions', sessionId);
mkdirSync(legacyDir, { recursive: true });
writeFileSync(
  join(legacyDir, 'meta.json'),
  JSON.stringify({
    sessionId,
    workDir: laceDir,
    created: '2026-01-01T00:00:00Z',
    persona: 'ada',
  })
);
const legacyEvents = [1, 2, 3].map((seq) =>
  JSON.stringify({
    eventSeq: seq,
    timestamp: `2026-01-01T00:00:0${seq}Z`,
    type: 'prompt',
    data: { type: 'prompt', content: [{ type: 'text', text: `legacy-${seq}` }] },
  })
);
writeFileSync(join(legacyDir, 'events.jsonl'), legacyEvents.join('\n') + '\n');

// Set up new layout: same session, eventSeq 4, 5
const newDir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
mkdirSync(newDir, { recursive: true });
const newEvents = [4, 5].map((seq) =>
  JSON.stringify({
    eventSeq: seq,
    timestamp: `2026-05-23T00:00:0${seq}Z`,
    type: 'prompt',
    data: { type: 'prompt', content: [{ type: 'text', text: `new-${seq}` }] },
  })
);
writeFileSync(join(newDir, `${sessionId}.jsonl`), newEvents.join('\n') + '\n');

const { getRecallIndex, closeRecallIndex } = await import('../../src/storage/recall/index-db.js');
const { backfillIndex } = await import('../../src/storage/recall/backfill.js');

const db = getRecallIndex();
const stats = backfillIndex(db, laceDir);
console.log('backfill stats:', stats);

const rows = db
  .prepare(`SELECT event_id, content FROM events WHERE session_id = ? ORDER BY event_id`)
  .all(sessionId);
console.log('FTS rows:', JSON.stringify(rows, null, 2));

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
