import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-probe-cache-'));
process.env.LACE_DIR = laceDir;

const { appendDurableEvent } = await import('../../src/storage/event-log.js');
const { closeRecallIndex } = await import('../../src/storage/recall/index-db.js');
const { writeSessionMeta } = await import('../../src/storage/session-store.js');

// Simulate: first append happens BEFORE meta.json is written
// (e.g. session created, first event appended, meta still being written)
const sessionId = `sess_${randomUUID()}`;
const sessionDir = join(laceDir, 'agent-sessions', sessionId);
mkdirSync(sessionDir, { recursive: true });

// Don't write meta.json yet
let state = { nextEventSeq: 1, nextStreamSeq: 1 };
const r1 = appendDurableEvent(sessionDir, state, {
  type: 'prompt',
  data: { type: 'prompt', content: [{ type: 'text', text: 'first' }] },
});
state = r1.nextState;

// Now write meta with a real persona
writeSessionMeta(sessionDir, {
  sessionId,
  workDir: laceDir,
  created: '2026-05-23T00:00:00Z',
  persona: 'ada',
});

// Second append - should use ada, but cache says null
const r2 = appendDurableEvent(sessionDir, state, {
  type: 'prompt',
  data: { type: 'prompt', content: [{ type: 'text', text: 'second' }] },
});

// Inspect filesystem
import { execSync } from 'node:child_process';
const tree = execSync(`find ${laceDir}/transcripts -type f`, { encoding: 'utf8' });
console.log('Files in transcripts tree:');
console.log(tree);

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
