import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-mp-'));
process.env.LACE_DIR = laceDir;

const sessionId = 'sess_11111111-2222-3333-4444-555555555555';
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

// Split events: 1,2 in _unknown (cache poisoning artifact); 3,4 in ada (cache fixed)
mkdirSync(join(laceDir, 'transcripts', '_unknown', '2026-05-23'), { recursive: true });
writeFileSync(
  join(laceDir, 'transcripts', '_unknown', '2026-05-23', `${sessionId}.jsonl`),
  [1, 2]
    .map((s) =>
      JSON.stringify({
        eventSeq: s,
        timestamp: `2026-05-23T0${s}:00:00Z`,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: `first ${s}` }] },
      })
    )
    .join('\n') + '\n'
);
mkdirSync(join(laceDir, 'transcripts', 'ada', '2026-05-23'), { recursive: true });
writeFileSync(
  join(laceDir, 'transcripts', 'ada', '2026-05-23', `${sessionId}.jsonl`),
  [3, 4]
    .map((s) =>
      JSON.stringify({
        eventSeq: s,
        timestamp: `2026-05-23T0${s}:00:00Z`,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: `second ${s}` }] },
      })
    )
    .join('\n') + '\n'
);

const { getRecallIndex, closeRecallIndex } = await import('../../src/storage/recall/index-db.js');
const { backfillIndex } = await import('../../src/storage/recall/backfill.js');

const db = getRecallIndex();
const stats = backfillIndex(db, laceDir);
console.log('stats:', stats);

const rows = db
  .prepare(`SELECT event_id, persona, content FROM events WHERE session_id = ? ORDER BY event_id`)
  .all(sessionId);
console.log('FTS rows:');
for (const r of rows) console.log('  ', JSON.stringify(r));

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
