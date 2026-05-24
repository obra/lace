import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-empty-'));
process.env.LACE_DIR = laceDir;

const { Session } = await import('../../src/core/session.js');
const { appendDurableEvent, invalidatePersonaCache } = await import(
  '../../src/storage/event-log.js'
);
const { closeRecallIndex, getRecallIndex } = await import('../../src/storage/recall/index-db.js');

const session = Session.create({ cwd: laceDir, persona: 'x' });
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
