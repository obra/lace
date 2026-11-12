// ABOUTME: Exercises the internal memory index against a real loopback HTTP server.
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { passagePointId } from '../../../../../scripts/lib/memory-search-benchmark';
import { MemorySearchIndex, type MemorySearchIdentity } from '../search-index';

const owner = { instanceId: 'memory-instance', generation: 'encoder-generation' };
const passage = { kind: 'passage', sourceId: 'source', version: 'v1', start: 2, end: 9 } as const;
const note = { kind: 'note', noteId: 'note', revision: 1 } as const;
const vector = [1, ...Array<number>(767).fill(0)];
const signal = () => new AbortController().signal;
const allowCreate = () => {};
type Request = {
  method: string;
  path: string;
  key?: string | string[];
  body: Record<string, unknown>;
  socket: Socket;
};

function reply(response: ServerResponse, result: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'ok', result, time: 0 }));
}

async function fixture(handle?: (request: Request, response: ServerResponse) => boolean) {
  const requests: Request[] = [];
  const collections = new Map<string, Record<string, unknown>>();
  const server = createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const request: Request = {
      method: incoming.method!,
      path: incoming.url!,
      key: incoming.headers['api-key'],
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {},
      socket: incoming.socket,
    };
    requests.push(request);
    if (handle?.(request, response)) return;
    const path = request.path.split('/').slice(0, 3).join('/');
    if (request.method === 'PUT' && path === request.path) {
      const { vectors, metadata, hnsw_config, optimizers_config } = request.body;
      collections.set(path, {
        params: { vectors },
        metadata,
        hnsw_config,
        optimizer_config: optimizers_config,
      });
      reply(response, true);
    } else if (!collections.has(path)) {
      response.writeHead(404).end();
    } else if (request.method === 'GET') {
      reply(response, { config: collections.get(path) });
    } else {
      reply(response, { status: 'completed', operation_id: 1 });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    collections,
    close: () => server.close(),
  };
}

it('creates and reopens a scoped collection with the measured settings and a durable incarnation', async () => {
  const server = await fixture();
  try {
    const first = new MemorySearchIndex({ url: server.url }, owner);
    const incarnation = await first.ensure(signal(), allowCreate);
    expect(incarnation).toMatch(/^[0-9a-f-]{36}$/);
    const [path, config] = [...server.collections.entries()][0];
    expect(config).toMatchObject({
      metadata: { ...owner, incarnation, format: expect.any(String) },
      params: { vectors: { size: 768, distance: 'Dot', datatype: 'float32', memory: 'cold' } },
      hnsw_config: { m: 16, ef_construct: 100, max_indexing_threads: 1, memory: 'cached' },
      optimizer_config: { max_optimization_threads: 1, prevent_unoptimized: false },
    });
    const reopened = new MemorySearchIndex({ url: server.url }, owner);
    expect(await reopened.ensure(signal(), allowCreate)).toBe(incarnation);
    expect(server.requests.filter(({ method }) => method === 'PUT')).toHaveLength(1);
    server.collections.delete(path);
    expect(await reopened.ensure(signal(), allowCreate)).not.toBe(incarnation);
    await new MemorySearchIndex({ url: server.url }, { ...owner, generation: 'other' }).ensure(
      signal(),
      allowCreate
    );
    await new MemorySearchIndex({ url: server.url }, { ...owner, instanceId: 'other' }).ensure(
      signal(),
      allowCreate
    );
    expect(server.collections.size).toBe(3);
  } finally {
    server.close();
  }
});

it('uses a fresh connection for each memory index request', async () => {
  const server = await fixture((request, response) => {
    if (!request.path.endsWith('/query')) return false;
    reply(response, { points: [] });
    return true;
  });
  try {
    const index = new MemorySearchIndex({ url: server.url }, owner);
    await index.ensure(signal(), allowCreate);
    await index.upsert([{ identity: passage, vector }], signal());
    expect(await index.query(vector, 1, signal())).toEqual([]);
    expect(server.requests.map(({ method }) => method)).toEqual([
      'GET',
      'PUT',
      'GET',
      'PUT',
      'POST',
    ]);
    expect(new Set(server.requests.map(({ socket }) => socket)).size).toBe(server.requests.length);
  } finally {
    server.close();
  }
});

it('refuses foreign metadata and configuration without changing the collection', async () => {
  const server = await fixture();
  try {
    const original = new MemorySearchIndex({ url: server.url }, owner);
    await original.ensure(signal(), allowCreate);
    const [path, config] = [...server.collections.entries()][0];
    const metadata = config.metadata as object;
    for (const changed of [
      { ...config, metadata: { ...metadata, instanceId: 'foreign' } },
      { ...config, metadata: { ...metadata, generation: 'foreign' } },
      { ...config, metadata: { ...metadata, format: 'foreign' } },
      { ...config, metadata: { ...metadata, incarnation: 'invalid' } },
      { ...config, params: { vectors: { size: 2, distance: 'Cosine' } } },
    ]) {
      server.collections.set(path, changed);
      const client = new MemorySearchIndex({ url: server.url }, owner);
      await expect(client.ensure(signal(), allowCreate)).rejects.toThrow(/collection/i);
      await expect(client.query(vector, 1, signal())).rejects.toThrow(/collection/i);
      await expect(client.upsert([{ identity: passage, vector }], signal())).rejects.toThrow(
        /ensure/i
      );
      await expect(client.remove([passage], signal())).rejects.toThrow(/ensure/i);
      expect(server.collections.get(path)).toBe(changed);
    }
    expect(server.requests.filter(({ method }) => method !== 'GET')).toHaveLength(1);
  } finally {
    server.close();
  }
});

it('queries an existing collection and validates returned identities', async () => {
  const id = passagePointId({ ...passage, generation: owner.generation });
  const match = { id, score: 0.75, payload: { ...passage, generation: owner.generation } };
  let points: unknown[] = [match];
  const server = await fixture((request, response) => {
    if (!request.path.endsWith('/query')) return false;
    if (!server.collections.size) response.writeHead(404).end();
    else reply(response, { points });
    return true;
  });
  try {
    const reader = new MemorySearchIndex({ url: server.url }, owner);
    await expect(reader.query(vector, 1, signal())).rejects.toThrow(/404/);
    expect(server.requests.map(({ method }) => method)).toEqual(['GET']);
    await new MemorySearchIndex({ url: server.url }, owner).ensure(signal(), allowCreate);
    const [path, config] = [...server.collections.entries()][0];
    server.requests.length = 0;
    expect(await reader.query(vector, 1, signal())).toEqual([{ identity: passage, score: 0.75 }]);
    expect(await reader.query(vector, 1, signal())).toHaveLength(1);
    expect(server.requests.map(({ method }) => method)).toEqual(['GET', 'POST', 'POST']);
    for (const malformed of [
      [{ ...match, id: 'bad' }],
      [{ ...match, score: '0.75' }],
      [{ ...match, score: 1e40 }],
      [{ ...match, payload: { ...match.payload, generation: 'other' } }],
      [{ ...match, payload: { ...match.payload, end: 1 } }],
      [match, match],
    ]) {
      points = malformed;
      await expect(reader.query(vector, 2, signal())).rejects.toThrow(/invalid|duplicate/i);
    }
    points = [
      match,
      {
        ...match,
        id: passagePointId({ ...passage, start: 0, generation: owner.generation }),
        payload: { ...match.payload, start: 0 },
      },
    ];
    await expect(reader.query(vector, 1, signal())).rejects.toThrow(/limit/i);
    server.collections.clear();
    server.requests.length = 0;
    await expect(reader.query(vector, 1, signal())).rejects.toThrow(/404/);
    expect(server.collections.size).toBe(0);
    expect(server.requests.map(({ method }) => method)).toEqual(['POST']);

    server.collections.set(path, {
      ...config,
      metadata: { ...(config.metadata as object), instanceId: 'foreign' },
    });
    points = [match];
    await expect(reader.query(vector, 1, signal())).rejects.toThrow(/collection identity/i);
    expect(server.requests.map(({ method }) => method)).toEqual(['POST', 'GET']);
  } finally {
    server.close();
  }
});

it('sends bounded waited writes and stable revision-aware point deletions', async () => {
  const server = await fixture();
  try {
    const client = new MemorySearchIndex({ url: server.url }, owner);
    await client.ensure(signal(), allowCreate);
    const secondRevision = { ...note, revision: 2 };
    const identities: MemorySearchIdentity[] = [
      { ...passage, ...{ text: 'private passage prose' } },
      note,
      secondRevision,
      ...Array.from({ length: 126 }, (_, i) => ({ ...note, noteId: `note-${i}` })),
    ];
    await client.upsert(
      identities.map((identity) => ({ identity, vector })),
      signal()
    );
    await client.remove(identities, signal());
    const writes = server.requests.filter(({ path }) => path.includes('/points'));
    expect(
      writes.map(({ method, path, body }) => [
        method,
        path.split('/').pop(),
        (body.points as unknown[]).length,
      ])
    ).toEqual([
      ['PUT', 'points?wait=true', 128],
      ['PUT', 'points?wait=true', 1],
      ['POST', 'delete?wait=true', 128],
      ['POST', 'delete?wait=true', 1],
    ]);
    const firstBatch = writes[0].body.points as Array<{
      id: string;
      payload: unknown;
      vector: unknown;
    }>;
    expect(firstBatch[0]).toEqual({
      id: passagePointId({ ...passage, generation: owner.generation }),
      payload: { ...passage, generation: owner.generation },
      vector,
    });
    expect(firstBatch[1].payload).toEqual({ ...note, generation: owner.generation });
    expect(firstBatch[1].id).not.toBe(firstBatch[2].id);
    expect(writes[2].body.points).toEqual(firstBatch.map(({ id }) => id));
  } finally {
    server.close();
  }
});

it('requests a bounded approximate shortlist with a score threshold', async () => {
  const identities = [passage, { ...passage, start: 3 }, { ...passage, start: 4 }];
  const hits = identities.map((identity, index) => ({
    id: passagePointId({ ...identity, generation: owner.generation }),
    payload: { ...identity, generation: owner.generation },
    score: [0.9, 0.8, 0.1][index],
  }));
  const server = await fixture((request, response) => {
    if (!request.path.endsWith('/query')) return false;
    const { score_threshold = -Infinity, limit } = request.body;
    reply(response, {
      points: hits
        .filter(({ score }) => Math.fround(score) > Math.fround(Number(score_threshold)))
        .slice(0, Number(limit)),
    });
    return true;
  });
  try {
    const index = new MemorySearchIndex({ url: server.url }, owner);
    await index.ensure(signal(), allowCreate);
    server.requests.length = 0;
    expect(await index.query(vector, 1, signal(), { minScore: 0.5 })).toEqual([
      { identity: identities[0], score: Math.fround(0.9) },
    ]);
    expect(server.requests.map(({ body }) => body)).toEqual([
      {
        query: vector,
        limit: 1,
        score_threshold: 0.4999999701976776,
        params: { exact: false, hnsw_ef: 1024 },
        with_payload: true,
        with_vector: false,
      },
    ]);
    await expect(index.query(vector, 1, signal(), { minScore: Infinity })).rejects.toThrow(
      /threshold/
    );
    await expect(index.query(vector, 1025, signal())).rejects.toThrow(/limit/);
    expect(server.requests).toHaveLength(1);
  } finally {
    server.close();
  }
});

it('includes native Float32 scores at the floor through Qdrant’s strict threshold', async () => {
  const payload = { ...passage, generation: owner.generation };
  const id = passagePointId(payload);
  let score = 0;
  const server = await fixture((request, response) => {
    if (!request.path.endsWith('/query')) return false;
    const threshold = request.body.score_threshold;
    const points =
      threshold === undefined || Math.fround(score) > Math.fround(Number(threshold))
        ? [{ id, payload, score }]
        : [];
    reply(response, { points });
    return true;
  });
  try {
    const index = new MemorySearchIndex({ url: server.url }, owner);
    await index.ensure(signal(), allowCreate);
    for (const [floor, wireScore, threshold] of [
      [0.8279641135636632, 0.8279641, 0.8279640674591064],
      [0.50000001, 0.50000006, 0.5],
      [0, 0, -1.401298464324817e-45],
      [-1, -1, -1.0000001192092896],
      [-3.4028234663852886e38, -3.4028235e38, undefined],
    ] as const) {
      score = wireScore;
      const hits = await index.query(vector, 1, signal(), { minScore: floor });
      expect(hits).toEqual([{ identity: passage, score: Math.fround(wireScore) }]);
      expect(hits[0].score).toBeGreaterThanOrEqual(floor);
      expect(server.requests.at(-1)?.body.score_threshold).toBe(threshold);
    }
  } finally {
    server.close();
  }
});

it('scores explicit identities below the semantic floor and rejects unrequested or duplicate results', async () => {
  const missing = { ...passage, start: 3 };
  const foreign = { ...passage, start: 4 };
  const match = (identity: typeof missing) => ({
    id: passagePointId({ ...identity, generation: owner.generation }),
    payload: { ...identity, generation: owner.generation },
    score: 0.15,
  });
  let points = [match(passage)];
  let fail = false;
  const server = await fixture((request, response) => {
    if (!request.path.endsWith('/query')) return false;
    if (fail) response.writeHead(503).end();
    else reply(response, { points });
    return true;
  });
  try {
    const index = new MemorySearchIndex({ url: server.url }, owner);
    await index.ensure(signal(), allowCreate);
    server.requests.length = 0;
    expect(await index.scores(vector, [], signal())).toEqual([]);
    expect(await index.scores(vector, [passage, missing, passage], signal())).toEqual([
      { identity: passage, score: Math.fround(0.15) },
    ]);
    expect(server.requests[0].body).toEqual({
      query: vector,
      limit: 2,
      params: { exact: true },
      with_payload: true,
      with_vector: false,
      filter: { must: [{ has_id: [match(passage).id, match(missing).id] }] },
    });
    points = [match(foreign)];
    await expect(index.scores(vector, [passage, missing], signal())).rejects.toThrow(
      /unrequested/i
    );
    points = [match(passage), match(passage)];
    await expect(index.scores(vector, [passage, missing], signal())).rejects.toThrow(/duplicate/i);
    await expect(
      index.scores(vector, Array<MemorySearchIdentity>(1025).fill(passage), signal())
    ).rejects.toThrow(/limit/);
    fail = true;
    await expect(index.scores(vector, [passage], signal())).rejects.toThrow(/503/);
    expect(server.requests).toHaveLength(4);
  } finally {
    server.close();
  }
});

it('stops on ambiguous writes and rejects invalid vectors before sending them', async () => {
  let status = 'acknowledged';
  const server = await fixture((request, response) => {
    if (!request.path.endsWith('?wait=true')) return false;
    reply(response, { status });
    return true;
  });
  try {
    const client = new MemorySearchIndex({ url: server.url }, owner);
    await client.ensure(signal(), allowCreate);
    server.requests.length = 0;
    const points = Array.from({ length: 129 }, (_, i) => ({
      identity: { ...note, noteId: `note-${i}` },
      vector,
    }));
    await expect(client.upsert(points, signal())).rejects.toThrow(/completed/);
    expect(server.requests).toHaveLength(1);
    status = 'wait_timeout';
    await expect(client.remove([note], signal())).rejects.toThrow(/completed/);
    expect(server.requests).toHaveLength(2);
    for (const invalid of [
      [1],
      [NaN, ...vector.slice(1)],
      [1e40, ...vector.slice(1)],
      Array<number>(768),
    ]) {
      await expect(client.query(invalid, 1, signal())).rejects.toThrow(/768 finite/);
      await expect(client.upsert([{ identity: note, vector: invalid }], signal())).rejects.toThrow(
        /768 finite/
      );
    }
    await expect(client.query(vector, 0, signal())).rejects.toThrow(/limit/);
    expect(server.requests).toHaveLength(2);
  } finally {
    server.close();
  }
});

it('propagates caller cancellation without retrying a request', async () => {
  let received: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    received = resolve;
  });
  const server = await fixture((request) => {
    if (!request.path.endsWith('/query')) return false;
    received();
    return true;
  });
  try {
    const client = new MemorySearchIndex({ url: server.url }, owner);
    await client.ensure(signal(), allowCreate);
    server.requests.length = 0;
    const controller = new AbortController();
    const pending = client.scores(vector, [passage], controller.signal);
    await requested;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.query(vector, 1, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(server.requests.map(({ method }) => method)).toEqual(['POST']);
  } finally {
    server.close();
  }
});

it('rejects a write acknowledgment when the response body is interrupted', async () => {
  const server = await fixture((request, response) => {
    if (!request.path.endsWith('?wait=true')) return false;
    const body = JSON.stringify({ status: 'ok', result: { status: 'completed' } });
    response
      .writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body) + 1,
      })
      .write(body);
    response.socket!.end();
    return true;
  });
  try {
    const index = new MemorySearchIndex({ url: server.url }, owner);
    await index.ensure(signal(), allowCreate);
    server.requests.length = 0;
    await expect(index.upsert([{ identity: passage, vector }], signal())).rejects.toThrow(
      /Invalid Qdrant memory search JSON response/
    );
    expect(server.requests.map(({ method }) => method)).toEqual(['PUT']);
  } finally {
    server.close();
  }
});

it('uses the key file once and keeps bounded, redacted diagnostics', async () => {
  const key = 'test-"secret"-key';
  const directory = mkdtempSync(join(tmpdir(), 'lace-search-index-'));
  const keyFile = join(directory, 'key');
  writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  const server = await fixture((request, response) => {
    response.writeHead(403, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        status: { error: `Rejected key ${request.key}. ${'x'.repeat(700)}` },
        result: 'private response data',
      })
    );
    return true;
  });
  try {
    const client = new MemorySearchIndex({ url: server.url, apiKeyFile: keyFile }, owner);
    writeFileSync(keyFile, 'replacement');
    const error = await client.ensure(signal(), allowCreate).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('HTTP 403');
    expect(message).toContain('Rejected key [redacted]');
    expect(message).not.toContain('secret');
    expect(message).not.toContain('private response data');
    expect(message.length).toBeLessThan(650);
    expect(server.requests.map(({ key }) => key)).toEqual([key]);
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('refuses non-loopback endpoints and redirects', async () => {
  expect(() => new MemorySearchIndex({ url: 'http://localhost:6333' }, owner)).toThrow(/loopback/);
  expect(() => new MemorySearchIndex({ url: 'https://192.0.2.10' }, owner)).toThrow(/loopback/);
  const target = await fixture();
  const redirect = await fixture((_request, response) => {
    response.writeHead(307, { location: `${target.url}/redirected` }).end();
    return true;
  });
  try {
    const client = new MemorySearchIndex({ url: redirect.url }, owner);
    await expect(client.ensure(signal(), allowCreate)).rejects.toThrow(/request failed/);
    expect(redirect.requests).toHaveLength(1);
    expect(target.requests).toHaveLength(0);
  } finally {
    redirect.close();
    target.close();
  }
});
