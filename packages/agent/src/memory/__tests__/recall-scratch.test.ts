// ABOUTME: Real SQLite ranking across spilled runs after the scratch pathname is removed.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { RecallScratch, RECALL_PAGE_SIZE, type RankedPassage } from '../recall-scratch';

it('merges runs larger than the page cache after unlink while preserving locale order and ties', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recall-runs-'));
  const scratch = new RecallScratch(join(directory, 'memory.sqlite'));
  try {
    expect(readdirSync(directory)).toEqual([]);
    const ids = ['archive:ä', 'archive:A', 'archive:a', 'archive:z', 'archive:é', 'archive:e'];
    const candidates: RankedPassage[] = Array.from({ length: 4097 }, (_, ordinal) => ({
      id: ids[ordinal % ids.length],
      version: String(ordinal),
      start: ordinal % 5,
      end: 384 + (ordinal % 5),
      text: 'passage '.repeat(48),
      exact: ordinal % 7 === 0,
      score: (ordinal % 11) / 10,
      semantic: true,
      textual: ordinal % 3 === 0,
      ordinal,
    }));
    for (let start = 0; start < candidates.length; start += RECALL_PAGE_SIZE)
      scratch.addRun(candidates.slice(start, start + RECALL_PAGE_SIZE));
    scratch.addAlias('from a merged group', 1);
    scratch.moveAliases(1, 0);
    expect(scratch.alias('from a merged group')).toBe(0);
    const result = [...(await scratch.ordered(() => {}))];
    expect(result).toEqual(
      candidates.sort(
        (a, b) =>
          Number(b.exact) - Number(a.exact) ||
          b.score - a.score ||
          a.id.localeCompare(b.id) ||
          a.start - b.start
      )
    );
  } finally {
    scratch.close();
    rmSync(directory, { recursive: true, force: true });
  }
  expect(() => scratch.alias('from a merged group')).toThrow();
});
