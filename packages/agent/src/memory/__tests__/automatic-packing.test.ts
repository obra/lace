// ABOUTME: Evidence packing preserves group bounds, account atomicity and reusable selections.
import { expect, it } from 'vitest';
import { packEvidence } from '../automatic';
import type { AutomaticEvidence } from '../types';

function group(id: number, texts = ['A retained fact.']): AutomaticEvidence {
  return {
    originals: texts.map((text, index) => ({
      handle: `session:${id + index}`,
      source: { kind: 'event', sessionId: 'session', eventSeq: id + index },
      start: 0,
      end: text.length,
      text,
    })),
    accounts: [],
  };
}
const evidence = (groups: AutomaticEvidence[]) => ({
  mode: 'hybrid' as const,
  coverage: {
    sources: groups.length,
    passages: groups.length,
    vectors: groups.length,
    partial: false,
  },
  groups,
});

it('admits at most six groups and uses spare space for their ranked siblings', () => {
  const first = group(1, ['First retained fact.', 'Second retained fact.']);
  const result = packEvidence(
    evidence([first, ...Array.from({ length: 7 }, (_, i) => group(i + 3))]),
    8000
  );
  expect(result.groups.map((entry) => entry.originals[0].handle)).toEqual([
    'session:1',
    'session:3',
    'session:4',
    'session:5',
    'session:6',
    'session:7',
  ]);
  expect(result.groups[0].originals).toEqual(first.originals);
  expect(result.tokens).toBeLessThanOrEqual(2000);
});

it('omits a required account above the hard cap without trimming it and continues to a fitting group', () => {
  const oversized = group(1);
  oversized.accounts = [
    {
      id: 'approval',
      revision: 2,
      text: 'Ask Mara before releasing the stands. '.repeat(200),
      attribution: 'root',
      support: [{ handle: 'session:1', status: 'current' }],
    },
  ];
  const fitting = group(2);
  const input = evidence([oversized, fitting]);
  const snapshot = structuredClone(input);
  const result = packEvidence(input, 8000);
  expect(result.groups).toEqual([fitting]);
  expect(result.selected).toEqual(snapshot.groups);
  expect(input).toEqual(snapshot);
  expect(result.tokens).toBeLessThanOrEqual(2000);
  expect(packEvidence(input, 0)).toMatchObject({ groups: [], block: null, tokens: 0 });
});

it('redacts first originals, sibling expansions and accounts while keeping the selection reusable', () => {
  const secret = 'xoxb-1234567890123456789012345';
  const selected = group(1, [`First fact ${secret}`, `Sibling fact ${secret}`]);
  selected.accounts = [
    {
      id: 'account',
      revision: 1,
      text: `Current account ${secret}`,
      attribution: 'root',
      support: [{ handle: 'session:1', status: 'current' }],
    },
  ];
  const input = evidence([selected]);
  const snapshot = structuredClone(input);
  const full = packEvidence(input, 2000);
  expect(full.groups[0].originals.map((original) => original.text)).toEqual([
    'First fact <REDACTED:slack>',
    'Sibling fact <REDACTED:slack>',
  ]);
  expect(full.groups[0].accounts[0].text).toBe('Current account <REDACTED:slack>');
  expect(full.block).not.toContain(secret);
  expect(full.tokens).toBe(Math.ceil(Buffer.byteLength(full.block!) / 3));
  packEvidence(input, 500);
  expect(input).toEqual(snapshot);
  expect(full.selected).toEqual(snapshot.groups);
  expect(packEvidence(input, 2000).groups).toEqual(full.groups);
});
