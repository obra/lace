// ABOUTME: Tests durable memory publication against SQLite writers and real loopback HTTP.
import type { HostMemoryBinding } from '@lace/ent-protocol';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  claimMemoryOwner,
  configureMemoryRoles,
  MemoryAccessDenied,
  openMemoryDatabase,
} from '../authority';
import { MemoryNotes } from '../notes';
import { MemoryPassages } from '../passages';
import { MemorySearchIndex, type MemorySearchIdentity } from '../search-index';
import { MemorySearchPublication } from '../search-publication';
import { MemorySources } from '../sources';
import { sourceHandle, type Note, type Source } from '../types';

const instanceId = 'memory-instance';
const generation = 'encoder-generation';
const grant = {
  producerId: 'persona:root',
  canRead: true,
  canMutate: true,
  collections: [],
  writableCollections: [],
};
const source: Source = {
  id: 'source',
  version: 'v1',
  reference: { kind: 'event', sessionId: 'sess_11111111-1111-4111-8111-111111111111', eventSeq: 1 },
};
const vector = (first: number) => [first, ...Array<number>(767).fill(0)];
const signal = () => new AbortController().signal;
type WirePoint = {
  id: string;
  payload: MemorySearchIdentity & { generation: string };
  vector: number[];
};
type Operation = {
  method: string;
  path: string;
  body: {
    points?: WirePoint[] | string[];
    vectors?: unknown;
    metadata?: unknown;
    hnsw_config?: unknown;
    optimizers_config?: unknown;
  };
};

function reply(response: ServerResponse, result: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'ok', result, time: 0 }));
}

async function engine() {
  const points = new Map<string, WirePoint>();
  const operations: Operation[] = [];
  let config: object | undefined;
  let hold:
    | { match: (op: Operation) => boolean; resolve: (finish: () => void) => void }
    | undefined;
  let writeStatus = 'completed';
  const server = createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const body: Operation['body'] = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : {};
    const op = { method: incoming.method!, path: incoming.url!, body };
    operations.push(op);
    let finish: () => void;
    if (op.method === 'GET') {
      const existing = config;
      finish = () => {
        if (existing) reply(response, { config: existing });
        else response.writeHead(404).end();
      };
    } else if (op.path.endsWith('/points?wait=true')) {
      for (const point of body.points as WirePoint[]) points.set(point.id, point);
      const status = writeStatus;
      finish = () => reply(response, { status });
    } else if (op.path.endsWith('/points/delete?wait=true')) {
      for (const id of body.points as string[]) points.delete(id);
      const status = writeStatus;
      finish = () => reply(response, { status });
    } else {
      config = {
        params: { vectors: body.vectors },
        metadata: body.metadata,
        hnsw_config: body.hnsw_config,
        optimizer_config: body.optimizers_config,
      };
      finish = () => reply(response, true);
    }
    if (hold?.match(op)) {
      const { resolve } = hold;
      hold = undefined;
      resolve(finish);
    } else finish();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return {
    url: `http://127.0.0.1:${address.port}`,
    points,
    writes: () => operations.filter(({ path }) => path.includes('/points')),
    operations,
    drop: () => {
      points.clear();
      config = undefined;
    },
    setWriteStatus: (status: string) => {
      writeStatus = status;
    },
    holdNext: (match: (op: Operation) => boolean) =>
      new Promise<() => void>((resolve) => {
        hold = { match, resolve };
      }),
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

let directory: string;
let path: string;
let notes: MemoryNotes;
let binding: HostMemoryBinding;
let server: Awaited<ReturnType<typeof engine>>;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lace-search-publication-'));
  path = join(directory, 'memory.sqlite');
  binding = {
    ...grant,
    instanceId,
    ownerGeneration: claimMemoryOwner(instanceId, path, 'root'),
    role: 'root',
    actorId: 'host',
    isRoot: true,
  };
  notes = new MemoryNotes(openMemoryDatabase(path, instanceId));
  configureMemoryRoles(notes.db, binding, { root: grant });
  new MemoryPassages(notes, new MemorySources(notes, { databasePath: path, binding }), true);
  notes.discover(source);
  server = await engine();
});

afterEach(() => {
  server.close();
  notes.db.close();
  rmSync(directory, { recursive: true, force: true });
});

function publisher(root = binding, encoder = generation) {
  const index = new MemorySearchIndex({ url: server.url }, { instanceId, generation: encoder });
  return new MemorySearchPublication(notes, index, root, encoder);
}

function rotateOwner() {
  binding = { ...binding, ownerGeneration: claimMemoryOwner(instanceId, path, 'root') };
}

function replacePassage(start: number, end: number) {
  notes.write(() =>
    notes.db
      .prepare(
        'INSERT OR REPLACE INTO memory_passages(id,version,start,end,text) VALUES(?,?,?,?,?)'
      )
      .run(source.id, source.version, start, end, 'private passage text')
  );
}

function cachePassage(start: number, first: number, encoder = generation) {
  notes.write(() =>
    notes.db
      .prepare(
        `UPDATE memory_passages SET generation=?,vector=? WHERE id=? AND version=? AND start=? AND text=?
    AND EXISTS (SELECT 1 FROM memory_sources WHERE id=memory_passages.id AND version=memory_passages.version)`
      )
      .run(
        encoder,
        JSON.stringify(vector(first)),
        source.id,
        source.version,
        start,
        'private passage text'
      )
  );
}

function acceptNote(workId: string, previous?: Note) {
  notes.db.prepare('INSERT OR REPLACE INTO memory_worker VALUES(1,?)').run('attempt');
  notes.accept(
    binding,
    'attempt',
    workId,
    [source],
    previous ? [previous] : [],
    {
      changes: [
        {
          text: 'private note text',
          sourceIds: [sourceHandle(source)],
          ...(previous ? { target: { noteId: previous.id, revision: previous.revision } } : {}),
        },
      ],
    },
    () => {},
    [source]
  );
  return notes.candidates()[0];
}

function published() {
  return [...server.points.values()];
}
function waitForUpsert() {
  return server.holdNext(({ path }) => path.endsWith('/points?wait=true'));
}

it('seeds stored vectors in bounded pages, reopens without reseeding, and publishes new writes', async () => {
  notes.write(() => {
    for (let start = 0; start < 130; start++) {
      replacePassage(start, start + 1);
      cachePassage(start, 0.25);
    }
  });
  replacePassage(130, 131);
  cachePassage(130, 0.25, 'old-generation');
  const current = acceptNote('initial');
  notes.cacheVector(current, generation, vector(0.5));
  const initial = publisher();
  expect(initial.partial()).toBe(true);
  await initial.run(signal());
  expect(initial.partial()).toBe(false);
  expect(published()).toHaveLength(131);
  expect(server.writes().map(({ body }) => body.points?.length)).toEqual([128, 2, 1]);
  expect(published().find(({ payload }) => payload.kind === 'note')?.payload).toEqual({
    kind: 'note',
    noteId: current.id,
    revision: 1,
    generation,
  });
  notes.db.close();
  notes = new MemoryNotes(openMemoryDatabase(path, instanceId), false);
  const reopened = publisher();
  expect(reopened.partial()).toBe(true);
  await reopened.run(signal());
  expect(server.writes()).toHaveLength(3);
  expect(reopened.partial()).toBe(false);
  cachePassage(0, 0.75);
  expect(reopened.partial()).toBe(true);
  await reopened.run(signal());
  expect(server.writes()).toHaveLength(4);
  expect(
    published().find(({ payload }) => payload.kind === 'passage' && payload.start === 0)?.vector[0]
  ).toBe(0.75);
});

it('removes replaced passage identities and publishes only newly valid vectors', async () => {
  const publication = publisher();
  replacePassage(0, 1);
  cachePassage(0, 0.25);
  await publication.run(signal());
  const oldId = published()[0].id;
  replacePassage(0, 3);
  await publication.run(signal());
  expect(server.points.has(oldId)).toBe(false);
  cachePassage(0, 0.75);
  await publication.run(signal());
  expect(published()).toMatchObject([
    { payload: { kind: 'passage', start: 0, end: 3 }, vector: vector(0.75) },
  ]);
  cachePassage(0, 0.5, 'wrong-generation');
  await publication.run(signal());
  expect(published()).toHaveLength(0);
  cachePassage(0, 0.75);
  await publication.run(signal());
  expect(published()).toHaveLength(1);
  notes.write(() => notes.db.prepare('DELETE FROM memory_passages WHERE id=?').run(source.id));
  await publication.run(signal());
  expect(published()).toHaveLength(0);
});

it('invalidates the previous note revision using the real note-head and cache replacements', async () => {
  const first = acceptNote('initial');
  const publication = publisher();
  notes.cacheVector(first, generation, vector(0.25));
  await publication.run(signal());
  const oldId = published()[0].id;
  const revised = acceptNote('revision', first);
  expect(publication.partial()).toBe(true);
  await publication.run(signal());
  expect(server.points.has(oldId)).toBe(false);
  expect(notes.vector(first, generation)).toEqual(vector(0.25));
  notes.cacheVector(revised, generation, vector(0.5));
  await publication.run(signal());
  expect(published()).toMatchObject([
    { payload: { kind: 'note', noteId: first.id, revision: 2 }, vector: vector(0.5) },
  ]);
  expect(notes.db.prepare('SELECT revision FROM memory_revisions ORDER BY revision').all()).toEqual(
    [{ revision: 1 }, { revision: 2 }]
  );
});

it('preserves same-identity writes enqueued while an older upsert is held', async () => {
  const publication = publisher();
  await publication.run(signal());
  const current = acceptNote('initial');
  notes.cacheVector(current, generation, vector(0.25));
  const upsert = waitForUpsert();
  const lifetime = signal();
  const run = publication.run(lifetime);
  const concurrent = publication.run(lifetime);
  const finish = await upsert;
  notes.cacheVector(current, generation, vector(0.75));
  expect(publication.partial()).toBe(true);
  finish();
  await Promise.all([run, concurrent]);
  expect(server.writes()).toHaveLength(2);
  expect(published()).toMatchObject([{ vector: vector(0.75) }]);
  expect(publication.partial()).toBe(false);
});

it('replays remotely applied seed work after cancellation loses its acknowledgment', async () => {
  notes.write(() => {
    for (let start = 0; start < 129; start++) {
      replacePassage(start, start + 1);
      cachePassage(start, 0.25);
    }
  });
  const initial = publisher();
  const controller = new AbortController();
  const upsert = waitForUpsert();
  const running = initial.run(controller.signal);
  const finish = await upsert;
  expect(server.points.size).toBe(128);
  controller.abort();
  await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  finish();
  expect(initial.partial()).toBe(true);
  expect(server.writes()).toHaveLength(1);
  notes.db.close();
  notes = new MemoryNotes(openMemoryDatabase(path, instanceId), false);
  const reopened = publisher();
  await reopened.run(signal());
  expect(server.writes().map(({ body }) => body.points?.length)).toEqual([128, 128, 1]);
  expect(server.writes()[0].body.points).toEqual(server.writes()[1].body.points);
  expect(server.points.size).toBe(129);
  expect(reopened.partial()).toBe(false);
});

it('retains a mixed page when deletion acknowledgment is ambiguous', async () => {
  const publication = publisher();
  replacePassage(0, 1);
  cachePassage(0, 0.25);
  await publication.run(signal());
  replacePassage(0, 3);
  cachePassage(0, 0.75);
  const upsert = waitForUpsert();
  const running = publication.run(signal());
  const finish = await upsert;
  server.setWriteStatus('wait_timeout');
  finish();
  await expect(running).rejects.toThrow(/completed/);
  expect(publication.partial()).toBe(true);
  server.setWriteStatus('completed');
  await publication.run(signal());
  expect(server.writes().map(({ method }) => method)).toEqual([
    'PUT',
    'PUT',
    'POST',
    'PUT',
    'POST',
  ]);
  expect(published()).toMatchObject([{ payload: { kind: 'passage', end: 3 } }]);
  expect(publication.partial()).toBe(false);
});

it('fences collection creation after an awaited lookup and rejects child initialization', async () => {
  expect(() => publisher({ ...binding, isRoot: false })).toThrow(MemoryAccessDenied);
  expect(
    notes.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'memory_search_%'").all()
  ).toEqual([]);
  const publication = publisher();
  const lookup = server.holdNext(({ method }) => method === 'GET');
  const running = publication.run(signal());
  const finish = await lookup;
  rotateOwner();
  finish();
  await expect(running).rejects.toThrow(MemoryAccessDenied);
  expect(server.operations.map(({ method }) => method)).toEqual(['GET']);
  expect(publication.partial()).toBe(true);
});

it('fences deletion and acknowledgment after the owner rotates during a completed upsert', async () => {
  const publication = publisher();
  replacePassage(0, 1);
  cachePassage(0, 0.25);
  await publication.run(signal());
  const oldId = published()[0].id;
  replacePassage(0, 3);
  cachePassage(0, 0.75);
  const upsert = waitForUpsert();
  const running = publication.run(signal());
  const finish = await upsert;
  rotateOwner();
  finish();
  await expect(running).rejects.toThrow(MemoryAccessDenied);
  expect(server.writes().map(({ method }) => method)).toEqual(['PUT', 'PUT']);
  expect(server.points.has(oldId)).toBe(true);
  expect(publication.partial()).toBe(true);
  const reopened = publisher();
  await reopened.run(signal());
  expect(server.writes().map(({ method }) => method)).toEqual(['PUT', 'PUT', 'PUT', 'POST']);
  expect(server.points.has(oldId)).toBe(false);
  expect(reopened.partial()).toBe(false);
});

it('fences local acknowledgment when ownership changes after the final mutation was sent', async () => {
  const publication = publisher();
  await publication.run(signal());
  const current = acceptNote('initial');
  notes.cacheVector(current, generation, vector(0.25));
  const upsert = waitForUpsert();
  const running = publication.run(signal());
  const finish = await upsert;
  rotateOwner();
  finish();
  await expect(running).rejects.toThrow(MemoryAccessDenied);
  expect(server.points.size).toBe(1);
  const reopened = publisher();
  await reopened.run(signal());
  expect(server.writes().map(({ body }) => body.points?.length)).toEqual([1, 1]);
  expect(server.writes()[0].body.points).toEqual(server.writes()[1].body.points);
  expect(reopened.partial()).toBe(false);
});

it('marks readiness partial during ensure and reseeds a recreated collection', async () => {
  const publication = publisher();
  replacePassage(0, 1);
  cachePassage(0, 0.25);
  await publication.run(signal());
  expect(publication.partial()).toBe(false);
  server.drop();
  const lookup = server.holdNext(({ method }) => method === 'GET');
  const running = publication.run(signal());
  const finish = await lookup;
  expect(publication.partial()).toBe(true);
  finish();
  await running;
  expect(server.writes()).toHaveLength(2);
  expect(server.points.size).toBe(1);
  expect(publication.partial()).toBe(false);
});

it('retains pending identities across a generation change and resolves only current vectors', async () => {
  const initial = publisher();
  replacePassage(0, 1);
  cachePassage(0, 0.25);
  await initial.run(signal());
  cachePassage(0, 0.5);
  replacePassage(2, 3);
  cachePassage(2, 0.75, 'next-generation');
  server.drop();
  const next = publisher(binding, 'next-generation');
  await next.run(signal());
  expect(server.writes().map(({ method }) => method)).toEqual(['PUT', 'PUT', 'POST']);
  expect(published()).toMatchObject([
    { payload: { kind: 'passage', generation: 'next-generation', start: 2 }, vector: vector(0.75) },
  ]);
  expect(next.partial()).toBe(false);
});
