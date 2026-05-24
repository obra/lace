import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-rdcrash-'));
process.env.LACE_DIR = laceDir;

const sessionId = 'sess_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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

// Write a partial-shape message event
writeFileSync(
  join(sessionDir, 'events.jsonl'),
  JSON.stringify({ eventSeq: 1, timestamp: 'x', type: 'message', data: { role: 'assistant' } }) +
    '\n'
);

const { RecallTool } = await import('../../src/tools/implementations/recall.js');
const { closeRecallIndex } = await import('../../src/storage/recall/index-db.js');

const tool = new RecallTool();
const ctx = { signal: new AbortController().signal };
try {
  const result = await tool.execute({ action: 'read', event_id: `${sessionId}:1` }, ctx as any);
  console.log('result:', result.content[0].text);
} catch (err) {
  console.log('READ THREW:', (err as Error).message);
}

closeRecallIndex();
rmSync(laceDir, { recursive: true, force: true });
