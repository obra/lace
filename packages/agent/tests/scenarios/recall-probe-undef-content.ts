import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-undef-'));
process.env.LACE_DIR = laceDir;

const { Session } = await import('../../src/core/session.js');
const { appendDurableEvent, invalidatePersonaCache } = await import(
  '../../src/storage/event-log.js'
);
const { closeRecallIndex } = await import('../../src/storage/recall/index-db.js');

const session = Session.create({ cwd: laceDir, persona: 'x' });
invalidatePersonaCache(session.sessionDir);
let state = { nextEventSeq: 1, nextStreamSeq: 1 };

// Pass message event without content (matches what test cases do)
const r = appendDurableEvent(session.sessionDir, state, {
  type: 'message',
  data: { role: 'assistant' } as any,
});
console.log('appended OK:', r.written);

// Verify JSONL has the line
const { readFileSync, readdirSync } = await import('node:fs');
const { execSync } = await import('node:child_process');
const file = execSync(`find ${laceDir}/transcripts -type f`, { encoding: 'utf8' }).trim();
console.log('contents:', readFileSync(file, 'utf8'));

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
