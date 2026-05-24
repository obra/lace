import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-leak-'));
process.env.LACE_DIR = laceDir;

const { getSessionDir, writeSessionMeta, writeSessionState, ensureSessionFiles } = await import(
  '../../src/storage/session-store.js'
);
const { appendDurableEvent, invalidatePersonaCache } = await import(
  '../../src/storage/event-log.js'
);
const { closeRecallIndex } = await import('../../src/storage/recall/index-db.js');
const { RecallTool } = await import('../../src/tools/implementations/recall.js');

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

// Build content where the secret is far from any common match
// 32 tokens before the secret + the secret
const before = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
const secret = 'xoxb-1234567890-abcdefghijklmnop-qrstuvwxyz';
const after = Array.from({ length: 60 }, (_, i) => `tail${i}`).join(' ');
const text = `${before} START ${secret} END ${after}`;

const r = appendDurableEvent(session.sessionDir, state, {
  type: 'prompt',
  data: { type: 'prompt', content: [{ type: 'text', text }] },
});

// Search for "word5" — secret is many tokens away
const tool = new RecallTool();
const ctx = { signal: new AbortController().signal };
const result = await tool.execute({ action: 'search', query: 'word5' }, ctx as any);
const parsed = JSON.parse(result.content[0].text);
console.log('preview for word5:', JSON.stringify(parsed.hits[0]?.preview));

// Search for the END marker which should be on the OTHER side of the secret
const r2 = await tool.execute({ action: 'search', query: 'tail0' }, ctx as any);
const p2 = JSON.parse(r2.content[0].text);
console.log('preview for tail0:', JSON.stringify(p2.hits[0]?.preview));

// What about searching for the secret prefix?
const r3 = await tool.execute({ action: 'search', query: 'xoxb' }, ctx as any);
const p3 = JSON.parse(r3.content[0].text);
console.log('preview for xoxb:', JSON.stringify(p3.hits[0]?.preview));

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
