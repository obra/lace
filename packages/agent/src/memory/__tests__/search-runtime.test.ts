// ABOUTME: Real runtime and loopback HTTP coverage for persistent memory search lifetime.
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeRecallIndex } from '../../storage/recall/index-db';
import { claimMemoryOwner, configureMemoryRoles, openMemoryDatabase } from '../authority';
import type { MemoryEncoder } from '../encoder';
import { MemoryNotes } from '../notes';
import { MemoryPassages } from '../passages';
import { createMemoryRuntime } from '../runtime';
import type { PassageSearchIdentity } from '../search-index';
import { MemorySources } from '../sources';
import { originalHandle, type MemoryConfiguration, type MemoryRuntime } from '../types';

const sessionId = 'sess_11111111-1111-4111-8111-111111111111';
const generation = 'fixture-search-runtime';
const embedding = [1, ...Array<number>(767).fill(0)];
const grant = {
  producerId: 'root',
  canRead: true,
  canMutate: true,
  collections: [],
  writableCollections: [],
};
let directory: string;
let configuration: MemoryConfiguration;
let sequence: number;
let runtime: MemoryRuntime | undefined;
let server: Awaited<ReturnType<typeof engine>> | undefined;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function engine(
  onQuery?: (response: ServerResponse) => void,
  onWrite?: (response: ServerResponse) => boolean | void
) {
  const points = new Map<string, PassageSearchIdentity>();
  const methods: string[] = [];
  let config: object | undefined;
  const listener = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const path = request.url!;
    const reply = (result: unknown) =>
      response.end(JSON.stringify({ status: 'ok', result, time: 0 }));
    methods.push(`${request.method} ${path.split('/').slice(3).join('/')}`);
    if (request.method === 'GET') {
      if (config) reply({ config });
      else response.writeHead(404).end();
    } else if (path.endsWith('/points?wait=true')) {
      for (const point of body.points as Array<{ id: string; payload: PassageSearchIdentity }>)
        points.set(point.id, point.payload);
      if (!onWrite?.(response)) reply({ status: 'completed', operation_id: 1 });
    } else if (path.endsWith('/points/query')) {
      if (onQuery) onQuery(response);
      else reply({ points: [] });
    } else {
      config = {
        params: { vectors: body.vectors },
        metadata: body.metadata,
        hnsw_config: body.hnsw_config,
        optimizer_config: body.optimizers_config,
      };
      reply(true);
    }
  });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return {
    url: `http://127.0.0.1:${address.port}`,
    points,
    methods,
    close: () => {
      listener.close();
      listener.closeAllConnections();
    },
  };
}

function event(text: string) {
  writeFileSync(
    join(directory, 'agent-sessions', sessionId, 'events.jsonl'),
    JSON.stringify({ type: 'message', eventSeq: ++sequence, data: { content: text } }) + '\n',
    { flag: 'a' }
  );
}

async function projectStoredVector() {
  const db = openMemoryDatabase(
    configuration.databasePath,
    configuration.binding.instanceId,
    false
  );
  try {
    const notes = new MemoryNotes(db);
    const sources = new MemorySources(notes, configuration);
    const passages = new MemoryPassages(notes, sources, true);
    await sources.discover();
    await passages.index(() => {});
    db.prepare('UPDATE memory_passages SET generation=?,vector=?').run(
      generation,
      JSON.stringify(embedding)
    );
    return notes.pending()[0];
  } finally {
    db.close();
  }
}

function start(encoder: MemoryEncoder, search?: { url: string; apiKeyFile?: string }) {
  runtime = createMemoryRuntime(
    { ...configuration, recall: { modelDirectory: '/unused', search } },
    { encoder }
  );
  return runtime;
}

function recall(worker: MemoryRuntime) {
  return worker.reader(configuration.binding).automatic({
    query: 'bicycle',
    cueIds: [],
    represented: [],
    maxTokens: 2000,
    signal: new AbortController().signal,
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'search-runtime-'));
  sequence = 0;
  runtime = undefined;
  server = undefined;
  vi.stubEnv('LACE_DIR', directory);
  vi.stubEnv('LACE_SESSION_DIR', join(directory, 'agent-sessions'));
  mkdirSync(join(directory, 'agent-sessions', sessionId), { recursive: true });
  const databasePath = join(directory, 'memory.sqlite');
  const binding = {
    ...grant,
    instanceId: 'instance',
    role: 'root',
    actorId: 'root',
    isRoot: true,
    ownerGeneration: claimMemoryOwner('instance', databasePath, 'root'),
  };
  configuration = { databasePath, binding };
  const db = openMemoryDatabase(databasePath, 'instance', false);
  configureMemoryRoles(db, binding, { root: grant });
  db.close();
});

afterEach(async () => {
  await runtime?.close();
  server?.close();
  closeRecallIndex();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it('publishes stored vectors while embedding is held and drains successful writes after a later encoder failure', async () => {
  event('bicycle stored');
  const original = await projectStoredVector();
  for (let i = 0; i < 5; i++) event(`bicycle new ${i}`);
  const encoded = deferred();
  const release = deferred();
  const firstWrite = deferred();
  server = await engine(undefined, firstWrite.resolve);
  let batches = 0;
  const worker = start(
    {
      generation,
      async encode(texts) {
        if (++batches > 1) throw new Error('fixture late encoder failure');
        encoded.resolve();
        await release.promise;
        return texts.map(() => embedding);
      },
    },
    { url: server.url }
  );
  const waking = worker.wake();
  try {
    await Promise.all([firstWrite.promise, encoded.promise]);
    expect([...server.points.values()].map(({ sourceId }) => sourceId)).toEqual([original.id]);
  } finally {
    release.resolve();
    await waking;
  }
  expect(server.points.size).toBe(5);
  expect(batches).toBe(2);
});

it('cancels an in-flight HTTP search when the runtime closes', async () => {
  event('bicycle stored');
  await projectStoredVector();
  const searching = deferred();
  const disconnected = deferred();
  server = await engine((response) => {
    response.once('close', disconnected.resolve);
    searching.resolve();
  });
  const worker = start(
    {
      generation,
      async encode(texts) {
        return texts.map(() => embedding);
      },
    },
    { url: server.url }
  );
  await worker.wake();
  const prepared = recall(worker).catch((error: unknown) => error);
  await searching.promise;
  await worker.close();
  expect(await prepared).toMatchObject({ message: 'Memory runtime closed' });
  await disconnected.promise;
  expect(server.methods.filter((method) => method === 'POST points/query')).toHaveLength(1);
});

it('reports complete coverage once a writable root has settled local and remote publication', async () => {
  event('bicycle stored');
  await projectStoredVector();
  server = await engine((response) => {
    const points = [...server!.points].map(([id, identity]) => ({
      id,
      score: 1,
      payload: { ...identity, generation },
    }));
    response.end(JSON.stringify({ status: 'ok', result: { points } }));
  });
  const worker = start(
    {
      generation,
      async encode(texts) {
        return texts.map(() => embedding);
      },
    },
    { url: server.url }
  );
  await worker.wake();
  expect(server.points.size).toBe(1);

  const result = await recall(worker);
  expect(result.mode).toBe('hybrid');
  expect(result.coverage).toEqual({ sources: 1, passages: 1, vectors: 1, partial: false });
  expect(result.block).toContain('"partial":false');
});

it('cancels a held publication on close and leaves its SQLite acknowledgment pending', async () => {
  event('bicycle stored');
  await projectStoredVector();
  const writing = deferred();
  const disconnected = deferred();
  server = await engine(undefined, (response) => {
    response.once('close', disconnected.resolve);
    writing.resolve();
    return true;
  });
  const worker = start(
    {
      generation,
      async encode(texts) {
        return texts.map(() => embedding);
      },
    },
    { url: server.url }
  );
  const waking = Promise.allSettled([worker.wake()]);
  await writing.promise;
  await worker.close();
  await disconnected.promise;
  await waking;
  const db = openMemoryDatabase(
    configuration.databasePath,
    configuration.binding.instanceId,
    false
  );
  try {
    expect(db.prepare('SELECT count(*) AS count FROM memory_search_pending').get()).toEqual({
      count: 1,
    });
    expect(server.points.size).toBe(1);
  } finally {
    db.close();
  }
});

it.each([false, true])(
  'retains text-only recall and explicit reads without usable search (configured=%s)',
  async (configured) => {
    event('bicycle stored');
    const original = await projectStoredVector();
    const worker = start(
      {
        generation,
        async encode() {
          throw new Error('Unconfigured search must not encode a query');
        },
      },
      configured
        ? { url: 'http://127.0.0.1:6333', apiKeyFile: join(directory, 'missing.key') }
        : undefined
    );
    const result = await recall(worker);
    expect(result.mode).toBe('text-only');
    expect(result.reason).toContain('Search index');
    expect(result.selected[0].originals[0].text).toContain('bicycle stored');
    expect(
      (await worker.reader(configuration.binding).readOriginal(originalHandle(original)))?.text
    ).toContain('bicycle stored');
  }
);
