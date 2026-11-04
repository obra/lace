// ABOUTME: Real-store regressions for reviewed automatic recall grouping, authority and topic boundaries.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { claimMemoryOwner, configureMemoryRoles, openMemoryDatabase } from '../authority';
import { createMemoryRuntime } from '../runtime';
import { MemoryNotes } from '../notes';
import { MemorySources } from '../sources';
import { MemoryPassages, originalReference } from '../passages';
import { automaticRecall } from '../automatic';
import {
  originalHandle,
  sourceHandle,
  type AutomaticRecallInput,
  type MemoryRuntime,
  type Source,
  type Note,
} from '../types';
import { sessionMemory } from '../session';
import { RecallTool } from '../../tools/implementations/recall';
import { closeRecallIndex, getRecallIndex } from '../../storage/recall/index-db';
import { loadTurnEntryProjection } from '../../message-building/turn-entry-projection';
const sessionId = 'sess_11111111-1111-4111-8111-111111111111';
const grant = {
  producerId: 'root',
  canRead: true,
  canMutate: true,
  collections: [],
  writableCollections: [],
};
let dir: string;
let seq: number;
let work: number;
let runtimes: MemoryRuntime[];
let db: ReturnType<typeof openMemoryDatabase>;
let notes: MemoryNotes;
let configuration: MemoryRuntime['configuration'];
let vector: (text: string, kind: 'query' | 'document') => number[];
let queries: number;
const file = () => join(dir, 'agent-sessions', sessionId, 'events.jsonl');
function record(type: string, data: Record<string, unknown>) {
  writeFileSync(
    file(),
    JSON.stringify({ type, eventSeq: ++seq, timestamp: '2026-10-30T00:00:00Z', data }) + '\n',
    { flag: 'a' }
  );
}
function event(text: string) {
  record('message', { content: text });
}
function sources(): Source[] {
  return (
    db.prepare('SELECT id,version,reference FROM memory_sources ORDER BY rowid').all() as Array<{
      id: string;
      version: string;
      reference: string;
    }>
  ).map((row) => ({ ...row, reference: JSON.parse(row.reference) }));
}
function accept(text: string, support: Source[], target?: Note): Note {
  const candidates = target ? [target] : [];
  db.prepare('INSERT OR REPLACE INTO memory_worker VALUES(1,?)').run('fixture');
  const offer = notes.offer(support, candidates, `fixture-${++work}`, support);
  notes.accept(
    configuration.binding,
    'fixture',
    offer,
    support,
    candidates,
    {
      changes: [
        {
          text,
          sourceIds: support.map(sourceHandle),
          ...(target ? { target: { noteId: target.id, revision: target.revision } } : {}),
        },
      ],
    },
    () => {},
    support
  );
  return target ? notes.note(target.id)! : notes.candidates().find((note) => note.text === text)!;
}
function start(textual = true, child = false) {
  const runtime = createMemoryRuntime(
    child
      ? {
          databasePath: configuration.databasePath,
          binding: runtimes[0].bindingForRole('child', 'child'),
          recall: configuration.recall,
        }
      : configuration,
    {
      semanticFloor: 0.7,
      textual,
      encoder: {
        generation: 'review-controlled',
        async encode(texts, kind) {
          if (kind === 'query') queries++;
          return texts.map((text) => vector(text, kind));
        },
      },
    }
  );
  runtimes.push(runtime);
  return runtime;
}
const input = (query: string, extra: Partial<AutomaticRecallInput> = {}): AutomaticRecallInput => ({
  query,
  cueIds: [],
  represented: [],
  signal: new AbortController().signal,
  maxTokens: 2000,
  ...extra,
});
async function recall(
  runtime: MemoryRuntime,
  query: string,
  extra: Partial<AutomaticRecallInput> = {}
) {
  return runtime.reader(runtime.configuration.binding).automatic(input(query, extra));
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'automatic-review-'));
  seq = 0;
  work = 0;
  queries = 0;
  runtimes = [];
  vector = () => [1, 0];
  vi.stubEnv('LACE_DIR', dir);
  vi.stubEnv('LACE_SESSION_DIR', join(dir, 'agent-sessions'));
  mkdirSync(join(dir, 'agent-sessions', sessionId), { recursive: true });
  const databasePath = join(dir, 'memory.sqlite');
  const binding = {
    ...grant,
    instanceId: 'instance',
    actorId: 'root',
    role: 'root',
    isRoot: true,
    ownerGeneration: claimMemoryOwner('instance', databasePath, 'root'),
  };
  configuration = { databasePath, binding, recall: { modelDirectory: '/unused' } };
  db = openMemoryDatabase(databasePath, 'instance', false);
  configureMemoryRoles(db, binding, { root: grant });
  notes = new MemoryNotes(db);
});
afterEach(async () => {
  for (const runtime of runtimes) await runtime.close();
  db.close();
  closeRecallIndex();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function projectedOriginals(count: number) {
  event('The bicycle queue is violet.');
  event('The bicycle route is green.');
  for (let index = 2; index < count; index++) event(`Unrelated harbor record ${index}.`);
  const originals = new MemorySources(notes, configuration);
  await originals.discover();
  const passages = new MemoryPassages(notes, originals, true);
  await passages.index(() => {});
  const selected = (await passages.all('fixture', () => {})).slice(0, 2);
  const selection: AutomaticRecallInput['selection'] = {
    mode: 'text-only',
    groups: selected.map((passage) => ({
      originals: [
        {
          handle: passage.handle,
          source: originalReference(passage.source),
          start: passage.start,
          end: passage.end,
          text: passage.text,
        },
      ],
      accounts: [],
    })),
  };
  return { originals, passages, selection };
}

it.each([8, 16])(
  'bounds source-list reconstruction while revalidating fixed evidence among %i originals',
  async (count) => {
    const { originals, passages, selection } = await projectedOriginals(count);
    const admitted = vi.spyOn(passages, 'admitted');
    const validate = vi.spyOn(originals, 'validateAtAcceptance');
    const result = await automaticRecall(input('bicycle', { selection }), {
      notes,
      sources: originals,
      passages,
      encoder: {
        generation: 'fixture',
        async encode() {
          throw new Error('Reused selection must not encode a query');
        },
      },
      floor: 0.7,
      check: () => {},
      accountsFor: async () => [{ accounts: [] }],
      indexing: () => true,
    });
    expect(result.groups.map((group) => group.originals[0].source)).toEqual([
      { kind: 'event', sessionId, eventSeq: 1 },
      { kind: 'event', sessionId, eventSeq: 2 },
    ]);
    expect(result.groups.map((group) => group.originals[0].text)).toEqual([
      expect.stringContaining('The bicycle queue is violet.'),
      expect.stringContaining('The bicycle route is green.'),
    ]);
    expect(
      validate.mock.calls.flatMap(([expected]) => expected.map((source) => source.id))
    ).toEqual([
      `event:${sessionId}:1`,
      `event:${sessionId}:2`,
      `event:${sessionId}:1`,
      `event:${sessionId}:2`,
    ]);
    expect(
      admitted.mock.calls.length,
      'full source-list reads per preparation'
    ).toBeLessThanOrEqual(3);
  }
);

it.each([8, 16])(
  'joins matching events to %i admitted originals with linear identity reads',
  async (count) => {
    const { passages } = await projectedOriginals(count);
    const admitted = passages.admitted.bind(passages);
    const expected = admitted().map(sourceHandle);
    for (let index = 1; index <= count; index++)
      getRecallIndex()
        .prepare('INSERT INTO events(event_id,content) VALUES(?,?)')
        .run(`${sessionId}:${index}`, 'needle');
    getRecallIndex()
      .prepare('INSERT INTO events(event_id,content) VALUES(?,?)')
      .run(`${sessionId}:999`, 'needle');
    let identities = 0;
    vi.spyOn(passages, 'admitted').mockImplementation(() =>
      admitted().map((source) => {
        const id = source.id;
        return {
          ...source,
          get id() {
            identities++;
            return id;
          },
        };
      })
    );
    expect([...passages.textMatches('needle')].sort()).toEqual(expected.sort());
    expect(identities, 'source identity reads for all matching events').toBeLessThanOrEqual(
      count * 3
    );
  }
);

it('keeps every admitted version of a matching event and deduplicates repeated FTS hits', async () => {
  const { passages } = await projectedOriginals(8);
  const first = passages.admitted()[0];
  notes.discover({ ...first, version: 'retained-version' });
  const insert = getRecallIndex().prepare('INSERT INTO events(event_id,content) VALUES(?,?)');
  insert.run(`${sessionId}:1`, 'needle');
  insert.run(`${sessionId}:1`, 'needle');
  expect([...passages.textMatches('needle')].sort()).toEqual(
    [sourceHandle(first), `${first.id}@retained-version`].sort()
  );
});

it('omits a selected original withdrawn during an awaited account read', async () => {
  const { originals, passages, selection } = await projectedOriginals(8);
  const result = await automaticRecall(input('bicycle', { selection }), {
    notes,
    sources: originals,
    passages,
    encoder: {
      generation: 'fixture',
      async encode() {
        return [];
      },
    },
    floor: 0.7,
    check: () => {},
    accountsFor: async () => {
      db.prepare('DELETE FROM memory_sources WHERE id=?').run(`event:${sessionId}:1`);
      return [{ accounts: [] }];
    },
    indexing: () => true,
  });
  expect(result.groups.map((group) => group.originals[0].source)).toEqual([
    { kind: 'event', sessionId, eventSeq: 2 },
  ]);
});

it('expands an old opaque original with its revised account, or omits the whole unsupported original', async () => {
  event('2025: Alice owns the bicycle queue.');
  event('2026: Bea owns the bicycle queue after Alice left.');
  const runtime = start();
  await runtime.wake();
  const originals = sources();
  const first = accept('Alice owns the bicycle queue.', [originals[0]]);
  accept('Bea now owns the bicycle queue after Alice left.', [originals[1]], first);
  const reader = runtime.reader(configuration.binding);
  const expand = async () =>
    JSON.parse(
      (
        await new RecallTool().execute(
          { action: 'read', event_id: originalHandle(originals[0]) },
          { signal: new AbortController().signal, memory: reader }
        )
      ).content[0].text!
    );
  const expanded = await expand();
  expect(expanded.text).toContain('Alice');
  expect(expanded.current_accounts[0].text).toContain('Bea');
  const lines = readFileSync(file(), 'utf8').trim().split('\n');
  const changed = JSON.parse(lines[1]);
  changed.data.content = 'replaced support';
  lines[1] = JSON.stringify(changed);
  writeFileSync(file(), lines.join('\n') + '\n');
  const unavailable = await expand();
  expect(unavailable.text).toBeUndefined();
  expect(unavailable.omitted).toBeTruthy();
});
it.each(['event', 'document'] as const)(
  'retains a current %s with its latest corrected account and readable superseded support',
  async (kind) => {
    const repo = join(dir, 'documents');
    mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    git('init');
    const commit = () => {
      git('add', 'handbook.md', 'signs.md');
      git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'fixture'
      );
    };
    writeFileSync(join(repo, 'handbook.md'), 'Distribute packet A.');
    writeFileSync(join(repo, 'signs.md'), 'Bicycle rationale: leave incomplete forms at the desk.');
    commit();
    configuration.documentSources = { gitRoot: repo, paths: ['handbook.md', 'signs.md'] };
    event('2025: Alice owns the bicycle queue.');
    event('Bicycle rationale: Bea now owns routing because Alice left.');
    vector = (text) => (text.toLowerCase().includes('rationale') ? [1, 0] : [0, 1]);
    const runtime = start();
    await runtime.wake();
    const originals = sources();
    const old = originals.find(
      (source) => source.reference.kind === 'event' && source.reference.eventSeq === 1
    )!;
    const correction = originals.find(
      (source) => source.reference.kind === 'event' && source.reference.eventSeq === 2
    )!;
    const handbook = originals.find((source) => source.id.endsWith('handbook.md'))!;
    const signs = originals.find((source) => source.id.endsWith('signs.md'))!;
    const first = accept('Alice owns the bicycle queue.', [old]);
    const latest = accept(
      'Bea owns routing after Alice left. The supplied handbook says to distribute packet A.',
      [correction, handbook, signs],
      first
    );
    writeFileSync(join(repo, 'handbook.md'), 'Distribute packet B.');
    commit();
    await runtime.wake();
    const reader = runtime.reader(configuration.binding);
    const target = kind === 'event' ? correction : signs;
    const expanded = await reader.readOriginal(originalHandle(target));
    expect(expanded).toMatchObject({
      status: 'current',
      text: expect.stringContaining('rationale'),
      current_accounts: [{ id: latest.id, revision: 2, text: latest.text }],
    });
    const account = expanded!.current_accounts![0];
    expect(account.support).toEqual([
      { handle: `${sessionId}:2`, status: 'current' },
      { handle: originalHandle(handbook), status: 'superseded' },
      { handle: originalHandle(signs), status: 'current' },
    ]);
    expect((await reader.readOriginal(originalHandle(old)))?.current_accounts).toEqual([account]);
    expect(await reader.readOriginal(originalHandle(handbook))).toMatchObject({
      status: 'superseded',
      text: 'Distribute packet A.',
      current_accounts: [account],
    });
    const automatic = await recall(runtime, 'bicycle rationale');
    expect(
      automatic.groups.find((group) =>
        group.originals.some((original) => original.handle === originalHandle(target))
      )?.accounts
    ).toEqual([account]);
    expect(
      automatic.groups.flatMap((group) => group.originals.map((original) => original.handle))
    ).not.toContain(originalHandle(handbook));

    // A superseded tree entry alone does not prove the retained blob is readable.
    if (handbook.reference.kind !== 'document') throw new Error('Expected document support');
    rmSync(
      join(
        repo,
        '.git',
        'objects',
        handbook.reference.blob.slice(0, 2),
        handbook.reference.blob.slice(2)
      )
    );
    expect(await reader.readOriginal(originalHandle(target))).toMatchObject({
      status: 'current',
      omitted: expect.any(String),
    });
    expect((await reader.readOriginal(originalHandle(target)))?.text).toBeUndefined();
    const unavailable = await recall(runtime, 'bicycle rationale');
    expect(
      unavailable.groups.flatMap((group) => group.originals.map((original) => original.handle))
    ).not.toContain(originalHandle(target));
  }
);
it.each([false, true])(
  'drops an earlier original when a later read adds a linked account (existing: %s)',
  async (existing) => {
    event('2025: Alice owns the bicycle queue.');
    event('2026: Bea owns the bicycle queue.');
    const runtime = start();
    await runtime.wake();
    const originals = sources();
    if (existing) accept('An already known bicycle account.', [originals[0]]);
    const load = MemorySources.prototype.load;
    let changed = false;
    const spy = vi
      .spyOn(MemorySources.prototype, 'load')
      .mockImplementation(async function (source, images) {
        const result = await load.call(this, source, images);
        if (!changed && source.reference.kind === 'event' && source.reference.eventSeq === 2) {
          changed = true;
          accept('Bea is the current owner.', originals);
        }
        return result;
      });
    try {
      const result = await recall(runtime, 'bicycle queue');
      expect(
        result.groups.some((group) =>
          group.originals.some(
            (original) => original.source.kind === 'event' && original.source.eventSeq === 1
          )
        )
      ).toBe(false);
      expect(
        result.groups.some((group) =>
          group.accounts.some((account) => account.text.includes('Bea'))
        )
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  }
);
it('keeps a useful long-source excerpt with all corrections inside the normal budget', async () => {
  event(
    'bicycle violet useful fact.\n' +
      Array.from(
        { length: 32 },
        (_, index) => `bicycle supporting detail ${index} ${'x'.repeat(350)}`
      ).join('\n')
  );
  const runtime = start();
  await runtime.wake();
  accept('The current bicycle finish is violet.', [sources()[0]]);
  await runtime.wake();
  const result = await recall(runtime, 'bicycle violet');
  expect(
    result.groups.some(
      (group) =>
        group.originals.some((original) => original.text.includes('useful fact')) &&
        group.accounts.some((account) => account.text.includes('current bicycle'))
    )
  ).toBe(true);
  expect(result.tokens).toBeLessThanOrEqual(2000);
  expect(result.selected[0].originals.length).toBe(result.groups[0].originals.length);
});
it('deduplicates account IDs when one source bridges earlier groups while preserving distinct periods', async () => {
  event('2024 bicycle routing was handled by Alice.');
  event('2025 bicycle billing was handled by Bob.');
  event('2026 bicycle routing and billing now use the shared queue.');
  const runtime = start();
  await runtime.wake();
  const originals = sources();
  const routing = accept('2024 Alice handled routing.', [originals[0]]);
  const billing = accept('2025 Bob handled billing.', [originals[1]]);
  accept('2026 routing uses the shared queue.', [originals[2]], routing);
  accept('2026 billing uses the shared queue.', [originals[2]], billing);
  await runtime.wake();
  const result = await recall(runtime, 'bicycle routing billing history');
  const ids = result.groups.flatMap((group) => group.accounts.map((account) => account.id));
  expect(ids.length).toBe(new Set(ids).size);
  const periods = result.groups.flatMap((group) =>
    group.originals.map((original) =>
      original.source.kind === 'event' ? original.source.eventSeq : 0
    )
  );
  expect(periods).toContain(1);
  expect(periods).toContain(2);
});
it('admits an above-floor exact identifier beyond 24 higher-cosine topic groups', async () => {
  vector = (text, kind) =>
    kind === 'document' && text.includes('lower-cosine') ? [0.8, 0.6] : [1, 0];
  for (let index = 0; index < 26; index++) event(`bicycle common topic ${index}`);
  event('bicycle TICKET-73 lower-cosine exact fact');
  const runtime = start();
  await runtime.wake();
  const result = await recall(runtime, 'bicycle TICKET-73');
  expect(result.groups[0].originals[0].text).toContain('TICKET-73');
});
it('preserves an exact identifier carried by a note-nominated original rather than the note prose', async () => {
  vector = (text, kind) =>
    kind === 'document' && text === 'TICKET-73 retained original' ? [0, 1] : [1, 0];
  for (let index = 0; index < 7; index++) event(`bicycle topic ${index}`);
  event('TICKET-73 retained original');
  const runtime = start();
  await runtime.wake();
  accept('The bicycle current account is relevant.', [sources().at(-1)!]);
  await runtime.wake();
  const result = await recall(runtime, 'bicycle TICKET-73');
  expect(result.groups[0].originals[0].text).toContain('TICKET-73');
});
it('recognizes an unquoted absolute path without favoring its relative interior', async () => {
  event('bicycle etc/config.json relative config uses blue');
  event('bicycle /etc/config.json absolute config uses violet');
  const runtime = start();
  await runtime.wake();
  const result = await recall(runtime, 'bicycle /etc/config.json');
  expect(result.groups[0].originals[0].text).toContain('absolute config');
});
it('clears real session evidence for a new empty textual cue and keeps the empty continuation', async () => {
  event('bicycle violet');
  const runtime = start();
  await runtime.wake();
  const state = { memory: runtime } as Parameters<typeof sessionMemory>[0];
  const session = {
    meta: { sessionId, persona: 'root' },
    state: { memoryInstanceId: 'instance' },
  } as Parameters<typeof sessionMemory>[1];
  const prepare = sessionMemory(state, session)!.prepareAutomaticRecall!;
  expect((await prepare(input('bicycle', { cueIds: ['text-topic'] }))).groups).toHaveLength(1);
  const empty = input('', { cueIds: ['image-topic'], tail: 'bicycle conversation' });
  expect((await prepare(empty)).groups).toHaveLength(0);
  expect((await prepare(empty)).groups).toHaveLength(0);
  expect(queries).toBe(1);
});
it('excludes a short complete tool call/result already represented by required history', async () => {
  record('tool_use', {
    name: 'bash',
    input: { command: 'report' },
    toolCallId: 'complete',
    result: { outcome: 'completed', content: [{ type: 'text', text: 'bicycle violet' }] },
  });
  const runtime = start();
  await runtime.wake();
  const projection = loadTurnEntryProjection(join(dir, 'agent-sessions', sessionId), dir);
  const result = await recall(runtime, 'bicycle', {
    represented: projection.retainedOriginals.map((original) => ({
      kind: 'event',
      sessionId,
      ...original,
    })),
  });
  expect(result.groups).toHaveLength(0);
});
it('reports and reuses semantic-only when both FTS surfaces fail', async () => {
  event('bicycle violet');
  const runtime = start();
  await runtime.wake();
  db.exec('DROP TABLE memory_original_fts; DROP TABLE memory_fts');
  const result = await recall(runtime, 'bicycle');
  expect(result.mode).toBe('semantic-only');
  expect(result.groups).toHaveLength(1);
  const reused = await recall(runtime, 'bicycle', { selection: result });
  expect(reused.mode).toBe('semantic-only');
  expect(reused.reason).toBe(result.reason);
});
it('internal semantic-only dependency keeps cosine order without exact identifier preference', async () => {
  vector = (text, kind) =>
    kind === 'document' && text.includes('TICKET-73') ? [0.8, 0.6] : [1, 0];
  event('bicycle highest cosine');
  event('bicycle TICKET-73 lower cosine');
  const root = start();
  await root.wake();
  expect((await recall(root, 'bicycle TICKET-73')).groups[0].originals[0].text).toContain(
    'TICKET-73'
  );
  const semantic = start(false, true);
  const result = await recall(semantic, 'bicycle TICKET-73');
  expect(result.mode).toBe('semantic-only');
  expect(result.groups[0].originals[0].text).toContain('highest cosine');
});

it('preserves exact preference when distinct historical originals merge into their current account', async () => {
  vector = (text, kind) =>
    kind === 'query'
      ? [1, 0]
      : text.includes('lower-cosine')
        ? [0.8, 0.6]
        : text.includes('mid-cosine')
          ? [0.95, Math.sqrt(1 - 0.95 ** 2)]
          : [1, 0];
  event('2026 mid-cosine bicycle current source');
  event('2025 lower-cosine bicycle TICKET-73 historical source');
  event('bicycle unrelated highest cosine');
  const runtime = start();
  await runtime.wake();
  const originals = sources();
  const old = accept('lower-cosine bicycle old account', [originals[1]]);
  accept('mid-cosine bicycle current account', [originals[0]], old);
  await runtime.wake();
  const result = await recall(runtime, 'bicycle TICKET-73');
  expect(result.groups[0].originals.some((original) => original.text.includes('TICKET-73'))).toBe(
    true
  );
  expect(result.groups[0].originals.some((original) => original.text.includes('2026'))).toBe(true);
});
it('keeps partial hybrid when one text surface remains available', async () => {
  event('bicycle violet');
  const root = start();
  await root.wake();
  db.exec('DROP TABLE memory_fts');
  const child = start(true, true);
  const result = await recall(child, 'bicycle');
  expect(result.mode).toBe('hybrid');
  expect(result.coverage.partial).toBe(true);
  expect(result.groups).toHaveLength(1);
});
function bicycleSiblings() {
  event('bicycle violet useful fact.');
  for (let index = 0; index < 3; index++)
    event(`bicycle supporting detail ${index} ${'x'.repeat(310)}.`);
}
it('packs a later group with its full required account before expanding earlier siblings', async () => {
  vector = (text, kind) =>
    kind === 'document' && text.includes('reservation') ? [0.8, 0.6] : [1, 0];
  bicycleSiblings();
  event('bicycle reservation: the remaining stands are held pending approval.');
  const runtime = start();
  await runtime.wake();
  const originals = sources();
  const finish = accept('The current bicycle finish is violet.', originals.slice(0, 4));
  const approval = accept(
    'For the bicycle reservation, ask Mara before releasing the remaining stands if payment is late.',
    [originals[4]]
  );
  await runtime.wake();
  const result = await recall(runtime, 'bicycle', { maxTokens: 1100 });
  expect(result.selected).toHaveLength(2);
  expect(result.selected[0].originals).toHaveLength(4);
  expect(result.groups.map((group) => group.accounts.map((account) => account.id))).toEqual([
    [finish.id],
    [approval.id],
  ]);
  expect(result.groups[1].accounts[0]).toMatchObject({
    revision: approval.revision,
    text: approval.text,
    support: [{ handle: `${sessionId}:5`, status: 'current' }],
  });
  expect(result.groups[1].originals[0].source).toEqual({
    kind: 'event',
    sessionId,
    eventSeq: 5,
  });
  expect(result.groups[0].originals.length).toBeLessThan(result.selected[0].originals.length);
  expect(result.tokens).toBeLessThanOrEqual(1100);
  expect(result.block).toContain(approval.text);
});
it('packs fitting ranked sibling passages at a reduced allowance without trimming current accounts', async () => {
  bicycleSiblings();
  const runtime = start();
  await runtime.wake();
  accept('The current bicycle finish is violet.', sources());
  await runtime.wake();
  const full = await recall(runtime, 'bicycle violet');
  expect(full.tokens).toBeGreaterThan(1000);
  expect(full.selected[0].originals.length).toBe(full.groups[0].originals.length);
  const reduced = await recall(runtime, 'bicycle violet', { maxTokens: 1000 });
  expect(reduced.groups).toHaveLength(1);
  expect(reduced.tokens).toBeLessThanOrEqual(1000);
  expect(reduced.groups[0].accounts).toEqual(full.groups[0].accounts);
  expect(reduced.groups[0].originals[0].text).toContain('useful fact');
  expect(reduced.groups[0].originals.length).toBeLessThan(reduced.selected[0].originals.length);
  expect(reduced.groups[0].originals).toEqual(
    full.selected[0].originals.slice(0, reduced.groups[0].originals.length)
  );
});
it('repackages a session selection from 2000 to 1000 to 2000 without losing reusable siblings', async () => {
  bicycleSiblings();
  const runtime = start();
  await runtime.wake();
  accept('The current bicycle finish is violet.', sources());
  await runtime.wake();
  const state = { memory: runtime } as Parameters<typeof sessionMemory>[0];
  const session = {
    meta: { sessionId, persona: 'root' },
    state: { memoryInstanceId: 'instance' },
  } as Parameters<typeof sessionMemory>[1];
  const prepare = sessionMemory(state, session)!.prepareAutomaticRecall!;
  const request = input('bicycle violet', { cueIds: ['current-topic'] });
  const full = await prepare(request);
  expect(full.tokens).toBeGreaterThan(1000);
  const queryCount = queries;
  const reduced = await prepare({ ...request, maxTokens: 1000 });
  expect(reduced.groups).toHaveLength(1);
  expect(reduced.tokens).toBeLessThanOrEqual(1000);
  expect(reduced.groups[0].accounts).toEqual(full.groups[0].accounts);
  expect(reduced.selected).toEqual(full.selected);
  const restored = await prepare(request);
  expect(restored.groups).toEqual(full.groups);
  expect(restored.selected).toEqual(full.selected);
  expect(queries).toBe(queryCount);
});
it('honors the configured directory when the native encoder is supplied as the internal dependency', async () => {
  const { localMemoryEncoder, configureMemoryEncoderDirectory } = await import('../encoder');
  runtimes.push(createMemoryRuntime(configuration, { encoder: localMemoryEncoder }));
  expect(() => configureMemoryEncoderDirectory('/different/model-directory')).toThrow(
    'Conflicting local memory model directories'
  );
});
