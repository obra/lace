// ABOUTME: Recalled originals remain inseparable from every directly linked current account.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostMemoryBinding } from '@lace/ent-protocol';
import { claimMemoryOwner, configureMemoryRoles, openMemoryDatabase } from '../authority';
import { MemoryNotes } from '../notes';
import { MemorySources } from '../sources';
import { createMemoryRuntime } from '../runtime';
import { sourceHandle } from '../types';
import { RecallTool } from '../../tools/implementations/recall';
import { getRecallIndex, closeRecallIndex } from '../../storage/recall/index-db';
import { registries, resetRegistriesForTest } from '../../plugins';
import { RECALL_EXTRACTOR_NAME } from '../../tools/implementations/recall-extractor';

const sessionId = 'sess_11111111-1111-4111-8111-111111111111';
const grant = {
  producerId: 'persona:root',
  canRead: true,
  canMutate: true,
  collections: [],
  writableCollections: [],
};
let dir: string;
let binding: HostMemoryBinding;
let runtime: ReturnType<typeof createMemoryRuntime>;
let db: ReturnType<typeof openMemoryDatabase>;
let notes: MemoryNotes;
let databasePath: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lace-current-accounts-'));
  vi.stubEnv('LACE_DIR', dir);
  vi.stubEnv('LACE_SESSION_DIR', join(dir, 'agent-sessions'));
  const session = join(dir, 'agent-sessions', sessionId);
  mkdirSync(session, { recursive: true });
  const lines = [
    'Alice owns routing and Bob owns billing.',
    'Alice left routing; Bea now owns routing.',
  ].map((content, index) =>
    JSON.stringify({
      type: 'message',
      eventSeq: index + 1,
      timestamp: `2026-10-${index + 1}T00:00:00Z`,
      data: { content },
    })
  );
  writeFileSync(join(session, 'events.jsonl'), lines.join('\n') + '\n');
  const index = getRecallIndex();
  for (const [offset, line] of lines.entries()) {
    index
      .prepare(
        'INSERT INTO events(event_id,session_id,ts,persona,kind,content,track) VALUES(?,?,?,?,?,?,?)'
      )
      .run(
        `${sessionId}:${offset + 1}`,
        sessionId,
        '2026-10-01T00:00:00Z',
        'root',
        'assistant',
        JSON.parse(line).data.content,
        null
      );
    index
      .prepare('INSERT INTO event_journal VALUES(?,?,?,?,?)')
      .run(sessionId, offset + 1, 'message', '2026-10-01T00:00:00Z', line);
  }
  databasePath = join(dir, 'memory.sqlite');
  binding = {
    ...grant,
    instanceId: 'instance',
    ownerGeneration: claimMemoryOwner('instance', databasePath, 'root'),
    actorId: 'host',
    role: 'root',
    isRoot: true,
  };
  db = openMemoryDatabase(databasePath, 'instance', false);
  configureMemoryRoles(db, binding, { root: grant });
  notes = new MemoryNotes(db);
  await new MemorySources(notes, { databasePath, binding }).discover();
  const sources = notes.pending();
  db.prepare('INSERT INTO memory_worker VALUES(1,?)').run('test');
  const first = notes.offer([sources[0]], [], 'fixture', [sources[0]]);
  notes.accept(
    binding,
    'test',
    first,
    [sources[0]],
    [],
    {
      changes: [
        { text: 'Alice owns routing.', sourceIds: [sourceHandle(sources[0])] },
        { text: 'Bob owns billing.', sourceIds: [sourceHandle(sources[0])] },
      ],
    },
    () => {},
    [sources[0]]
  );
  const routing = notes.candidates().find((note) => note.text.includes('Alice'))!;
  const second = notes.offer(sources, [routing], 'fixture2', [sources[1]]);
  notes.accept(
    binding,
    'test',
    second,
    sources,
    [routing],
    {
      changes: [
        {
          text: 'Bea now owns routing after Alice left.',
          sourceIds: [sourceHandle(sources[1])],
          target: { noteId: routing.id, revision: 1 },
        },
      ],
    },
    () => {},
    [sources[1]]
  );
  runtime = createMemoryRuntime({ databasePath, binding });
  resetRegistriesForTest();
  registries.recall.register(RECALL_EXTRACTOR_NAME, () => [1, 2], 'test');
});
afterEach(async () => {
  await runtime?.close();
  db.close();
  closeRecallIndex();
  resetRegistriesForTest();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
async function recall(args: any, configured = true) {
  return JSON.parse(
    (
      await new RecallTool().execute(args, {
        signal: new AbortController().signal,
        activeSessionId: sessionId,
        ...(configured ? { memory: runtime.reader(binding) } : {}),
      })
    ).content[0].text!
  );
}
it.each(['search', 'read', 'thread'])(
  'attaches changed and unchanged shared-source heads through %s, using compact expandable handles',
  async (action) => {
    const body = await recall(
      action === 'search'
        ? { action, query: 'Alice', order: 'recent' }
        : action === 'read'
          ? { action, event_id: `${sessionId}:2`, context: 1 }
          : { action, groupKey: 'opaque' }
    );
    const original = (body.hits ?? body.events).find(
      (event: any) => event.event_id === `${sessionId}:1`
    );
    expect(original.current_accounts.map((note: any) => note.text).sort()).toEqual([
      'Bea now owns routing after Alice left.',
      'Bob owns billing.',
    ]);
    expect(
      original.current_accounts.every(
        (note: any) =>
          note.attribution === 'persona:root' &&
          note.support.every((source: any) => typeof source.handle === 'string')
      )
    ).toBe(true);
    expect(JSON.stringify(original.current_accounts)).not.toContain('offset');
    expect(JSON.stringify(original.current_accounts)).not.toContain(dir);
    const handle = original.current_accounts[0].support[0].handle;
    expect((await recall({ action: 'read', event_id: handle, context: 0 })).events).toHaveLength(1);
  }
);
it('reads a note hit at its current head', async () => {
  const routing = notes.candidates().find((note) => note.text.includes('Bea'))!;
  const result = await recall({ action: 'read', event_id: `memory:${routing.id}` });
  expect(result).toMatchObject({ revision: 2, text: 'Bea now owns routing after Alice left.' });
  expect(result.support).toEqual([{ handle: `${sessionId}:2`, status: 'current' }]);
  const search = await recall({ action: 'search', query: 'Bea' });
  expect(search.memories[0].support).toEqual([{ handle: `${sessionId}:2`, status: 'current' }]);
});
it.each(['search', 'read', 'thread'])(
  'omits the whole original group when its required head loses support through %s',
  async (action) => {
    const path = join(dir, 'agent-sessions', sessionId, 'events.jsonl');
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const changed = JSON.parse(lines[1]);
    changed.data.content = 'tampered';
    lines[1] = JSON.stringify(changed);
    writeFileSync(path, lines.join('\n') + '\n');
    const body = await recall(
      action === 'search'
        ? { action, query: 'Alice' }
        : action === 'read'
          ? { action, event_id: `${sessionId}:1` }
          : { action, groupKey: 'opaque' }
    );
    expect(body.hits ?? body.events).toEqual([]);
    expect(
      body.omitted.some((group: any) => group.event_id === `${sessionId}:1` && group.reason)
    ).toBe(true);
  }
);
it('keeps unconfigured transcript recall unchanged when required memory support is gone', async () => {
  rmSync(join(dir, 'agent-sessions', sessionId, 'events.jsonl'));
  const body = await recall({ action: 'search', query: 'Alice' }, false);
  expect(body.hits).toHaveLength(2);
  expect(body.hits[0]).not.toHaveProperty('current_accounts');
});
it('omits an original when its required accounts exceed the attachment bound', async () => {
  const original = notes.candidates().find((note) => note.text.includes('Bob'))!.sources[0];
  for (let i = 0; i < 20; i++) {
    const work = notes.offer([original], [], `big-${i}`, []);
    notes.accept(
      binding,
      'test',
      work,
      [original],
      [],
      { changes: [{ text: 'x'.repeat(4096), sourceIds: [sourceHandle(original)] }] },
      () => {},
      []
    );
  }
  const body = await recall({ action: 'read', event_id: `${sessionId}:1`, context: 0 });
  expect(body.events).toEqual([]);
  expect(body.omitted[0].reason).toMatch(/budget/i);
});
it('revalidates current read authority after source reads', async () => {
  configureMemoryRoles(
    db,
    { ...binding, canMutate: false },
    { root: { ...grant, canMutate: false } }
  );
  expect(() => runtime.reader(binding)).toThrow();
});

it('omits affected groups when retained support changes during an awaited source read', async () => {
  const originalStatus = MemorySources.prototype.status;
  let changed = false;
  const spy = vi
    .spyOn(MemorySources.prototype, 'status')
    .mockImplementation(async function (source) {
      const status = await originalStatus.call(this, source);
      if (!changed && source.reference.kind === 'event' && source.reference.eventSeq === 2) {
        changed = true;
        const path = join(dir, 'agent-sessions', sessionId, 'events.jsonl');
        const lines = readFileSync(path, 'utf8').trim().split('\n');
        const event = JSON.parse(lines[1]);
        event.data.content = 'changed during read';
        lines[1] = JSON.stringify(event);
        writeFileSync(path, lines.join('\n') + '\n');
      }
      return status;
    });
  try {
    const result = await recall({ action: 'search', query: 'Alice' });
    expect(result.hits).toEqual([]);
    expect(result.omitted).toHaveLength(2);
  } finally {
    spy.mockRestore();
  }
});

it('does not surface originals after read grants change during awaited support reads', async () => {
  const reader = runtime.reader(binding);
  const originalStatus = MemorySources.prototype.status;
  let revoked = false;
  const spy = vi
    .spyOn(MemorySources.prototype, 'status')
    .mockImplementation(async function (source) {
      const status = await originalStatus.call(this, source);
      if (!revoked) {
        revoked = true;
        configureMemoryRoles(
          db,
          { ...binding, canMutate: false },
          { root: { ...grant, canMutate: false } }
        );
      }
      return status;
    });
  try {
    const result = await new RecallTool().execute(
      { action: 'read', event_id: `${sessionId}:1` },
      { signal: new AbortController().signal, memory: reader }
    );
    expect(JSON.parse(result.content[0].text!)).toMatchObject({
      error: expect.stringContaining('Memory access denied'),
    });
  } finally {
    spy.mockRestore();
  }
});

it('rejects an earlier search head revised while a later note support read is awaited', async () => {
  const originalStatus = MemorySources.prototype.status;
  let earlier: ReturnType<MemoryNotes['note']>;
  let reads = 0;
  const spy = vi
    .spyOn(MemorySources.prototype, 'status')
    .mockImplementation(async function (source) {
      const status = await originalStatus.call(this, source);
      reads++;
      if (reads === 1)
        earlier = notes
          .candidates()
          .find((note) => note.sources.some((ref) => sourceHandle(ref) === sourceHandle(source)));
      if (reads === 2) {
        const note = earlier!;
        const work = notes.offer(note.sources, [note], 'concurrent search revision', []);
        notes.accept(
          binding,
          'test',
          work,
          note.sources,
          [note],
          {
            changes: [
              {
                text: 'A newer current account.',
                sourceIds: note.sources.map(sourceHandle),
                target: { noteId: note.id, revision: note.revision },
              },
            ],
          },
          () => {},
          []
        );
      }
      return status;
    });
  try {
    await expect(runtime.reader(binding).search('owns', 10)).rejects.toThrow(
      'Current account revision changed'
    );
  } finally {
    spy.mockRestore();
  }
});

it('does not return a stale note search hit revised during later transcript-account reads', async () => {
  const originalStatus = MemorySources.prototype.status;
  let earlier: ReturnType<MemoryNotes['note']>;
  let reads = 0;
  const spy = vi
    .spyOn(MemorySources.prototype, 'status')
    .mockImplementation(async function (source) {
      const status = await originalStatus.call(this, source);
      reads++;
      if (reads === 1)
        earlier = notes
          .candidates()
          .find((note) => note.sources.some((ref) => sourceHandle(ref) === sourceHandle(source)));
      if (reads === 3) {
        const note = earlier!;
        const work = notes.offer(note.sources, [note], 'concurrent tool search revision', []);
        notes.accept(
          binding,
          'test',
          work,
          note.sources,
          [note],
          {
            changes: [
              {
                text: 'A newer current account.',
                sourceIds: note.sources.map(sourceHandle),
                target: { noteId: note.id, revision: note.revision },
              },
            ],
          },
          () => {},
          []
        );
      }
      return status;
    });
  try {
    const result = await recall({ action: 'search', query: 'owns' });
    expect(result).toMatchObject({
      error: expect.stringContaining('Current account revision changed'),
    });
    expect(result).not.toHaveProperty('memories');
  } finally {
    spy.mockRestore();
  }
});

it('counts the displayed redacted account representation against the attachment budget', async () => {
  const original = notes.candidates().find((note) => note.text.includes('Bob'))!.sources[0];
  for (let i = 0; i < 13; i++) {
    const work = notes.offer([original], [], `redacted-${i}`, []);
    notes.accept(
      binding,
      'test',
      work,
      [original],
      [],
      {
        changes: [
          { text: 'AKIAABCDEFGHIJKLMNOP '.repeat(195), sourceIds: [sourceHandle(original)] },
        ],
      },
      () => {},
      []
    );
  }
  const result = await recall({ action: 'read', event_id: `${sessionId}:1`, context: 0 });
  expect(result.events).toEqual([]);
  expect(result.omitted[0].reason).toMatch(/budget/i);
});
