import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-empty-'));
process.env.LACE_DIR = laceDir;

const { getSessionDir, writeSessionMeta, writeSessionState, ensureSessionFiles } = await import(
  '../../src/storage/session-store.js'
);
const { appendDurableEvent, invalidatePersonaCache } = await import(
  '../../src/storage/event-log.js'
);
const { closeRecallIndex, getRecallIndex } = await import('../../src/storage/recall/index-db.js');

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

// Empty content blocks — production scenario when no assistant text but tool calls exist
const r = appendDurableEvent(session.sessionDir, state, {
  type: 'message',
  data: { content: [] },
});
console.log('appended OK', r.written.eventSeq);

// Now query
const db = getRecallIndex();
const rows = db
  .prepare(`SELECT event_id, content, kind FROM events WHERE session_id = ?`)
  .all(session.sessionId);
console.log('FTS rows:', JSON.stringify(rows));

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
