// ABOUTME: Behavioral contracts for the private memory-search benchmark.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import {
  compareTop,
  createOutput,
  importSnapshot,
  passagePointId,
  prepareSnapshot,
  qdrantCollection,
  validateVector,
} from '../../../../../scripts/lib/memory-search-benchmark';

const passage = { sourceId: 'source', version: 'v1', start: 1, end: 3, generation: 'gen' };
const vector = (first: number) => [first, ...Array<number>(767).fill(0)];

it('keeps a deterministic UUID for every complete passage identity', () => {
  const id = passagePointId(passage);
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(passagePointId({ ...passage })).toBe(id);
  for (const revision of [
    { sourceId: 'other' },
    { version: 'v2' },
    { start: 0 },
    { end: 5 },
    { generation: 'other' },
  ]) {
    expect(passagePointId({ ...passage, ...revision })).not.toBe(id);
  }
});

it('accepts finite vectors with exactly 768 numeric dimensions', () => {
  expect(validateVector(vector(1))).toEqual(vector(1));
  for (const value of [
    [1],
    vector(1).concat(0),
    vector(NaN),
    vector(Infinity),
    vector(1e40),
    [null, ...vector(1).slice(1)],
  ]) {
    expect(() => validateVector(value)).toThrow(/768 finite/);
  }
});

function snapshot(file: string) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE memory_sources (id TEXT, version TEXT, reference TEXT, PRIMARY KEY(id,version));
    CREATE TABLE memory_passages (
      id TEXT, version TEXT, start INTEGER, end INTEGER, text TEXT, generation TEXT, vector TEXT,
      PRIMARY KEY(id,version,start)
    );
  `);
  db.prepare('INSERT INTO memory_sources VALUES (?,?,?)').run('source', 'v1', 'private reference');
  const insert = db.prepare('INSERT INTO memory_passages VALUES (?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (let start = 0; start < 130; start++) {
      insert.run(
        'source',
        'v1',
        start,
        start + 2,
        'private text',
        'gen',
        JSON.stringify(vector(start / 130))
      );
    }
    insert.run('source', 'v2', 0, 2, 'orphan', 'gen', 'malformed');
    insert.run('source', 'v1', 140, 142, 'other generation', 'old', 'malformed');
    insert.run('source', 'v1', 142, 144, 'unembedded', 'gen', null);
  })();
  db.close();
}

it('keeps only the highest 100 scores across SQLite pages for each query', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lace-search-benchmark-'));
  try {
    const file = join(directory, 'snapshot.sqlite');
    snapshot(file);
    const original = readFileSync(file);
    const mapping: Array<{ id: string; start: number }> = [];
    const prepared = prepareSnapshot(
      file,
      'gen',
      [
        { id: 'ascending', vector: vector(1) },
        { id: 'descending', vector: vector(-1) },
      ],
      (points) => mapping.push(...points)
    );
    const starts = new Map(mapping.map(({ id, start }) => [id, start]));
    expect(prepared.dataset.points).toBe(130);
    expect(prepared.dataset.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(mapping).toHaveLength(130);
    expect(
      prepared.queries.map(({ reference }) => reference.map(({ id }) => starts.get(id)))
    ).toEqual([
      Array.from({ length: 100 }, (_, i) => 129 - i),
      Array.from({ length: 100 }, (_, i) => i),
    ]);
    expect(prepared.queries[0].reference[0].score).toBeCloseTo(129 / 130, 7);
    expect(readFileSync(file)).toEqual(original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('credits boundary ties while requiring strictly better IDs and retaining raw disagreement', () => {
  const reference = [
    { id: 'above', score: 0.9 },
    { id: 'boundary', score: 0.5 },
  ];
  const alternate = { id: 'tied', score: 0.500005 };
  const oracle = new Map([
    ['tied', 0.5],
    ['lower', 0.4999],
  ]);
  expect(compareTop(reference, [reference[0], alternate], 2, oracle)).toMatchObject({
    idHits: 1,
    tieAdjustedHits: 2,
  });
  expect(compareTop(reference, [reference[1], alternate], 2, oracle)).toMatchObject({
    idHits: 1,
    tieAdjustedHits: 1,
  });
  expect(
    compareTop(reference, [reference[0], { id: 'lower', score: 0.5 }], 2, oracle)
  ).toMatchObject({
    idHits: 1,
    tieAdjustedHits: 1,
  });
});

it('refuses WAL sidecars even when SQLite could open the snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lace-search-benchmark-'));
  try {
    const file = join(directory, 'snapshot.sqlite');
    snapshot(file);
    writeFileSync(`${file}-wal`, 'leave this intact');
    expect(() => prepareSnapshot(file, 'gen', [{ id: 'q', vector: vector(1) }], () => {})).toThrow(
      /sidecar/
    );
    expect(readFileSync(`${file}-wal`, 'utf8')).toBe('leave this intact');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('uses a private fresh directory and preserves a previous result', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lace-search-benchmark-'));
  try {
    const run = join(directory, 'run');
    createOutput(run);
    writeFileSync(join(run, 'receipt'), 'previous result');
    expect(statSync(run).mode & 0o777).toBe(0o700);
    expect(() => createOutput(run)).toThrow(/already exists/);
    expect(readFileSync(join(run, 'receipt'), 'utf8')).toBe('previous result');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('refuses to write to an existing Qdrant collection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lace-search-benchmark-'));
  const file = join(directory, 'snapshot.sqlite');
  const requests: Array<{ method: string | undefined; key: string | string[] | undefined }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, key: request.headers['api-key'] });
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        status: 'ok',
        time: 0,
        result: { points_count: 1, config: { metadata: {} } },
      })
    );
  });
  try {
    snapshot(file);
    const prepared = prepareSnapshot(file, 'gen', [{ id: 'q', vector: vector(1) }], () => {});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const collection = qdrantCollection(
      `http://127.0.0.1:${address.port}`,
      'benchmark',
      'test-key'
    );
    await expect(importSnapshot(collection, file, prepared.dataset, () => {})).rejects.toThrow(
      /already exists/
    );
    expect(requests).toEqual([{ method: 'GET', key: 'test-key' }]);
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('rejects non-loopback Qdrant URLs before an HTTP request', () => {
  expect(() => qdrantCollection('https://example.com', 'benchmark')).toThrow(/loopback/);
});

it('preserves a noncompleted waited write without counting the batch as imported', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lace-search-benchmark-'));
  const file = join(directory, 'snapshot.sqlite');
  const batches: Array<{ url: string | undefined; points: Array<{ payload: object }> }> = [];
  const events: Array<Record<string, unknown>> = [];
  let config: object | undefined;
  const server = createServer(async (request, response) => {
    const reply = (result: unknown) =>
      response.end(JSON.stringify({ status: 'ok', time: 0, result }));
    if (request.method === 'GET') {
      if (config) reply({ config });
      else response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url === '/collections/benchmark') {
      config = {
        params: { vectors: body.vectors },
        metadata: body.metadata,
        hnsw_config: body.hnsw_config,
        optimizer_config: body.optimizers_config,
      };
      reply(true);
    } else if (request.url?.endsWith('/count')) {
      reply({ count: 0 });
    } else {
      batches.push({ url: request.url, points: body.points });
      reply({
        operation_id: batches.length,
        status: batches.length === 1 ? 'completed' : 'wait_timeout',
      });
    }
  });
  try {
    snapshot(file);
    const prepared = prepareSnapshot(file, 'gen', [{ id: 'q', vector: vector(1) }], () => {});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const collection = qdrantCollection(`http://127.0.0.1:${address.port}`, 'benchmark');
    await expect(
      importSnapshot(collection, file, prepared.dataset, (event) => events.push(event))
    ).rejects.toThrow(/did not report completed/);
    expect(batches.map(({ url, points }) => [url, points.length])).toEqual([
      ['/collections/benchmark/points?wait=true', 128],
      ['/collections/benchmark/points?wait=true', 2],
    ]);
    expect(batches[0].points[0].payload).toEqual({
      sourceId: 'source',
      version: 'v1',
      start: 0,
      end: 2,
      generation: 'gen',
    });
    expect(events.filter(({ event }) => event === 'batch-completed')).toMatchObject([
      { points: 128 },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'write-not-completed',
        qdrant: expect.objectContaining({ result: { operation_id: 2, status: 'wait_timeout' } }),
      })
    );
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
