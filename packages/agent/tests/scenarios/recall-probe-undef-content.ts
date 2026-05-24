import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-undef-'));
process.env.LACE_DIR = laceDir;

const { getSessionDir, writeSessionMeta, writeSessionState, ensureSessionFiles } = await import(
  '../../src/storage/session-store.js'
);
const { appendDurableEvent, invalidatePersonaCache } = await import(
  '../../src/storage/event-log.js'
);
const { closeRecallIndex } = await import('../../src/storage/recall/index-db.js');

const sessionId = `sess_${randomUUID()}`;
const sessionDir = getSessionDir(sessionId);
writeSessionMeta(sessionDir, {
  sessionId,
  workDir: laceDir,
  created: new Date().toISOString(),
  persona: 'x',
});
writeSessionState(sessionDir, { nextEventSeq: 1, nextStreamSeq: 1, config: {} });
ensureSessionFiles(sessionDir);
const session = { sessionId, sessionDir };
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
