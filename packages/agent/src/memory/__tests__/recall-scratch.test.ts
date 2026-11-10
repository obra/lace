// ABOUTME: Real SQLite ranking across spilled runs after the scratch pathname is removed.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { RecallScratch, RECALL_PAGE_SIZE, type RankedPassage } from '../recall-scratch';

it('pages FTS identities and clears failed semantic ranking while preserving matches and aliases', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recall-runs-'));
  const scratch = new RecallScratch(join(directory, 'memory.sqlite'));
  try {
    const eventMatches = Array.from({ length: 130 }, (_, i) => ({
      id: `event-${String(i).padStart(3, '0')}`,
      version: '',
    }));
    scratch.addMatches('event', eventMatches.toReversed());
    scratch.addMatches('original', [
      { id: 'doc', version: 'v2' },
      { id: 'doc', version: 'v1' },
      { id: 'doc', version: 'v2' },
    ]);
    scratch.addMatches('note', [{ id: 'note' }]);
    const pages = [...scratch.matchPages('event')];
    expect(pages.map((page) => page.length)).toEqual([RECALL_PAGE_SIZE, 2]);
    expect(pages.flat()).toEqual(eventMatches);
    expect([...scratch.matchPages('original')].flat()).toEqual([
      { id: 'doc', version: 'v1' },
      { id: 'doc', version: 'v2' },
    ]);
    expect([...scratch.matchPages('note')].flat()).toEqual([{ id: 'note', version: '' }]);

    const passage = { kind: 'passage', sourceId: 'doc', version: 'v1', start: 0, end: 3 } as const;
    expect(scratch.nominate(passage)).toBe(true);
    expect(
      scratch.nominate({ end: 3, start: 0, version: 'v1', sourceId: 'doc', kind: 'passage' })
    ).toBe(false);
    expect(scratch.nominate({ ...passage, end: 4 })).toBe(true);
    expect(scratch.nominate({ kind: 'note', noteId: 'doc', revision: 1 })).toBe(true);
    expect(scratch.nominate({ kind: 'note', noteId: 'doc', revision: 2 })).toBe(true);
    const semantic = {
      id: 'doc',
      version: 'v1',
      start: 0,
      end: 3,
      text: 'semantic',
      exact: false,
      score: 1,
      semantic: true,
      textual: false,
      ordinal: 0,
    };
    scratch.addRun([semantic]);
    scratch.addAlias('keep', 7);
    scratch.clearRanking();
    expect(scratch.nominate(passage)).toBe(true);
    const textual = { ...semantic, text: 'text only', score: 0, semantic: false, textual: true };
    scratch.addRun([textual]);
    expect([...(await scratch.ordered(() => {}))]).toEqual([textual]);
    expect(scratch.alias('keep')).toBe(7);
    expect(scratch.hasMatch('original', 'doc', 'v2')).toBe(true);
    expect([...scratch.matchPages('event')].flat()).toEqual(eventMatches);
  } finally {
    scratch.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

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
