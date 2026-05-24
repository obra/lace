import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const laceDir = mkdtempSync(join(tmpdir(), 'recall-probe-persona-'));
process.env.LACE_DIR = laceDir;

const { transcriptFilePath } = await import('../../src/storage/transcript-paths.js');

const personas = [
  '..hidden', // starts with .
  '../escape', // attempted traversal
  '-rf', // leading -
  '', // empty (already rejected)
  '.', // dot (rejected)
  '..', // dotdot (rejected)
  '   ', // whitespace only
  '\n\t', // control characters
  'CON', // Windows reserved
  'a/b', // slash (rejected)
  'a‮b', // bidirectional override (unicode)
  '*evil*', // shell glob
  ' ', // non-breaking space (looks like nothing)
  'persona\nname', // newline
];

for (const p of personas) {
  try {
    const path = transcriptFilePath({
      laceDir: '/tmp/x',
      persona: p,
      date: new Date('2026-05-23T00:00:00Z'),
      sessionId: 'sess_test',
    });
    console.log('OK', JSON.stringify(p), '->', path);
  } catch (err) {
    console.log('THROW', JSON.stringify(p), '->', (err as Error).message);
  }
}

rmSync(laceDir, { recursive: true, force: true });
