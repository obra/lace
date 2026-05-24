import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-probe-'));
process.env.LACE_DIR = laceDir;

const { Session } = await import('../../src/core/session.js');
const { appendDurableEvent, invalidatePersonaCache } = await import(
  '../../src/storage/event-log.js'
);
const { RecallTool } = await import('../../src/tools/implementations/recall.js');
const { closeRecallIndex } = await import('../../src/storage/recall/index-db.js');

const session = Session.create({ cwd: laceDir, persona: 'probe' });
invalidatePersonaCache(session.sessionDir);

let state = { nextEventSeq: 1, nextStreamSeq: 1 };
const r = appendDurableEvent(session.sessionDir, state, {
  type: 'prompt',
  data: { type: 'prompt', content: [{ type: 'text', text: 'hello world test' }] },
});
state = r.nextState;

const tool = new RecallTool();
const ctx = { signal: new AbortController().signal };

const queries = ['hello', '"unclosed', '-foo', 'AND', '!@#$%', '*', '   '];

for (const q of queries) {
  try {
    const result = await tool.execute({ action: 'search', query: q }, ctx as any);
    console.log('OK', JSON.stringify(q), '->', result.content[0].text.slice(0, 100));
  } catch (err) {
    console.log('THROW', JSON.stringify(q), '->', (err as Error).message);
  }
}

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
