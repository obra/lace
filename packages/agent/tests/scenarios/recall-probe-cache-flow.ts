import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-probe-flow-'));
process.env.LACE_DIR = laceDir;

const { getSessionDir, writeSessionMeta, writeSessionState, ensureSessionFiles } = await import(
  '../../src/storage/session-store.js'
);
const { appendDurableEvent } = await import('../../src/storage/event-log.js');
const { closeRecallIndex } = await import('../../src/storage/recall/index-db.js');

// No invalidatePersonaCache — simulate fresh-process behavior
const sessionId = `sess_${randomUUID()}`;
const sessionDir = getSessionDir(sessionId);
writeSessionMeta(sessionDir, {
  sessionId,
  workDir: laceDir,
  created: new Date().toISOString(),
  persona: 'ada',
});
writeSessionState(sessionDir, { nextEventSeq: 1, nextStreamSeq: 1, config: {} });
ensureSessionFiles(sessionDir);
const session = { sessionId, sessionDir };
let state = { nextEventSeq: 1, nextStreamSeq: 1 };
const r = appendDurableEvent(session.sessionDir, state, {
  type: 'prompt',
  data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
});

console.log('sessionDir:', session.sessionDir);
console.log('Tree:');
console.log(execSync(`find ${laceDir}/transcripts -type f`, { encoding: 'utf8' }));

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
