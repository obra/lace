// ABOUTME: Exercises the internal memory index against a real loopback HTTP server.
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
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
type Request = {
  method: string;
  path: string;
  key?: string | string[];
  body: Record<string, unknown>;
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
    const incarnation = await first.ensure(signal());
    expect(incarnation).toMatch(/^[0-9a-f-]{36}$/);
    const [path, config] = [...server.collections.entries()][0];
    expect(config).toMatchObject({
      metadata: { ...owner, incarnation, format: expect.any(String) },
      params: { vectors: { size: 768, distance: 'Dot', datatype: 'float32', memory: 'cold' } },
      hnsw_config: { m: 16, ef_construct: 100, max_indexing_threads: 1, memory: 'cached' },
      optimizer_config: { max_optimization_threads: 1, prevent_unoptimized: false },
    });
    const reopened = new MemorySearchIndex({ url: server.url }, owner);
    expect(await reopened.ensure(signal())).toBe(incarnation);
    expect(server.requests.filter(({ method }) => method === 'PUT')).toHaveLength(1);
    server.collections.delete(path);
    expect(await reopened.ensure(signal())).not.toBe(incarnation);
    await new MemorySearchIndex({ url: server.url }, { ...owner, generation: 'other' }).ensure(
      signal()
    );
    await new MemorySearchIndex({ url: server.url }, { ...owner, instanceId: 'other' }).ensure(
      signal()
    );
    expect(server.collections.size).toBe(3);
  } finally {
    server.close();
  }
});

it('refuses foreign metadata and configuration without changing the collection', async () => {
  const server = await fixture();
  try {
    const original = new MemorySearchIndex({ url: server.url }, owner);
    await original.ensure(signal());
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
      await expect(client.ensure(signal())).rejects.toThrow(/collection/i);
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

it('queries an existing collection with exact Dot search and validates returned identities', async () => {
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
    await new MemorySearchIndex({ url: server.url }, owner).ensure(signal());
    const [path, config] = [...server.collections.entries()][0];
    server.requests.length = 0;
    expect(await reader.query(vector, 1, signal())).toEqual([{ identity: passage, score: 0.75 }]);
    expect(await reader.query(vector, 1, signal())).toHaveLength(1);
    expect(server.requests.map(({ method }) => method)).toEqual(['GET', 'POST', 'POST']);
    expect(server.requests[1].body).toEqual({
      query: vector,
      limit: 1,
      params: { exact: true },
      with_payload: true,
      with_vector: false,
    });
    for (const malformed of [
      [{ ...match, id: 'bad' }],
      [{ ...match, score: '0.75' }],
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
    await client.ensure(signal());
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

it('stops on ambiguous writes and rejects invalid vectors before sending them', async () => {
  let status = 'acknowledged';
  const server = await fixture((request, response) => {
    if (!request.path.endsWith('?wait=true')) return false;
    reply(response, { status });
    return true;
  });
  try {
    const client = new MemorySearchIndex({ url: server.url }, owner);
    await client.ensure(signal());
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
    await client.ensure(signal());
    server.requests.length = 0;
    const controller = new AbortController();
    const pending = client.query(vector, 1, controller.signal);
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
    const error = await client.ensure(signal()).catch((error: Error) => error);
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
    await expect(client.ensure(signal())).rejects.toThrow(/request failed/);
    expect(redirect.requests).toHaveLength(1);
    expect(target.requests).toHaveLength(0);
  } finally {
    redirect.close();
    target.close();
  }
});
