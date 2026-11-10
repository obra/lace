// ABOUTME: Read-only SQLite oracle and local Qdrant operations for the memory search benchmark.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readSync } from 'node:fs';
import Database from 'better-sqlite3';

const DIMENSIONS = 768;
const PAGE_SIZE = 128;
export const TOP = 100;
export const HNSW_EF = 128;
export const SCORE_TIE = 1e-5;

type PassageIdentity = {
  sourceId: string;
  version: string;
  start: number;
  end: number;
  generation: string;
};
export type PointMapping = PassageIdentity & { id: string };
type VectorRow = PassageIdentity & { rowid: number; vector: string };
export type Match = { id: string; score: number };
type QueryVector = { id: string; vector: number[] };
export type PreparedQuery = QueryVector & { reference: Match[] };
export type Dataset = {
  runId: string;
  generation: string;
  points: number;
  digest: string;
  fileDigest: string;
};
export type Prepared = { dataset: Dataset; queries: PreparedQuery[] };
export type RecordEvent = (event: Record<string, unknown>) => void;

export function passagePointId({ sourceId, version, start, end, generation }: PassageIdentity) {
  const hash = createHash('sha256')
    .update(JSON.stringify(['lace-passage', sourceId, version, start, end, generation]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateVector(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== DIMENSIONS ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(Math.fround(n)))
  ) {
    throw new Error('Expected 768 finite Float32-representable vector elements');
  }
  return value as number[];
}

function decodeVector(json: string) {
  let vector: unknown;
  try {
    vector = JSON.parse(json);
  } catch {
    throw new Error('Invalid stored vector JSON');
  }
  return validateVector(vector);
}

function dot(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < DIMENSIONS; i++) sum += a[i] * b[i];
  return sum;
}

function keepTop(top: Match[], match: Match) {
  let low = 0;
  let high = top.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const previous = top[middle];
    if (
      previous.score > match.score ||
      (previous.score === match.score && previous.id < match.id)
    ) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  if (low < TOP) {
    top.splice(low, 0, match);
    if (top.length > TOP) top.pop();
  }
}

export function compareTop(
  reference: Match[],
  returned: Match[],
  k: number,
  independentlyScored: ReadonlyMap<string, number>
) {
  const expected = reference.slice(0, k);
  const cutoff = expected.at(-1)?.score;
  if (cutoff === undefined) throw new Error('Expected a nonempty reference');
  const expectedIds = new Set(expected.map(({ id }) => id));
  const strictlyBetter = new Set(
    expected.filter(({ score }) => score - cutoff > SCORE_TIE).map(({ id }) => id)
  );
  const scoreById = new Map(reference.map(({ id, score }) => [id, score]));
  const observed = returned.slice(0, k);
  let idHits = 0;
  let betterHits = 0;
  let boundaryHits = 0;
  let samePosition = 0;
  let positionsWithinTie = 0;
  let maxScoreError = 0;
  for (const [index, match] of observed.entries()) {
    if (expectedIds.has(match.id)) idHits++;
    const score = scoreById.get(match.id) ?? independentlyScored.get(match.id);
    if (score === undefined) throw new Error('Returned ID has no independent score');
    if (strictlyBetter.has(match.id)) betterHits++;
    else if (Math.abs(score - cutoff) <= SCORE_TIE) boundaryHits++;
    if (match.id === expected[index]?.id) samePosition++;
    if (Math.abs(score - (expected[index]?.score ?? Infinity)) <= SCORE_TIE) positionsWithinTie++;
    maxScoreError = Math.max(maxScoreError, Math.abs(score - match.score));
  }
  const boundarySlots = expected.length - strictlyBetter.size;
  return {
    k,
    expected: expected.length,
    returned: observed.length,
    idHits,
    samePosition,
    positionsWithinTie,
    tieAdjustedHits: betterHits + Math.min(boundarySlots, boundaryHits),
    cutoff,
    boundarySlots,
    maxScoreError,
  };
}

export function createOutput(directory: string) {
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Output path already exists');
    }
    throw error;
  }
}

function assertNoSidecars(file: string) {
  if (['-wal', '-shm', '-journal'].some((suffix) => existsSync(`${file}${suffix}`))) {
    throw new Error('Snapshot has a SQLite sidecar; use a standalone copy in DELETE journal mode');
  }
}

function snapshotDigest(file: string) {
  assertNoSidecars(file);
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = readSync(fd, buffer);
    if (bytes < 100 || buffer[18] !== 1 || buffer[19] !== 1) {
      throw new Error('Expected a standalone SQLite snapshot in DELETE journal mode');
    }
    const hash = createHash('sha256');
    while (bytes > 0) {
      hash.update(buffer.subarray(0, bytes));
      bytes = readSync(fd, buffer);
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function openSnapshot(file: string) {
  assertNoSidecars(file);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  db.exec('BEGIN');
  return db;
}

function* vectorPages(db: Database.Database, generation: string) {
  // Match MemoryPassages.pages admission, without reading text or original references.
  const page = db.prepare<[number, string, number], VectorRow>(`
    SELECT p.rowid, p.id AS sourceId, p.version, p.start, p.end, p.generation, p.vector
    FROM memory_passages AS p JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
    WHERE p.rowid>? AND p.generation=? AND p.vector IS NOT NULL
    ORDER BY p.rowid LIMIT ?
  `);
  let after = 0;
  while (true) {
    const rows = page.all(after, generation, PAGE_SIZE);
    if (!rows.length) return;
    after = rows[rows.length - 1].rowid;
    yield rows;
  }
}

export function prepareSnapshot(
  file: string,
  generation: string,
  vectors: QueryVector[],
  saveMapping: (points: PointMapping[]) => void
): Prepared {
  const fileDigest = snapshotDigest(file);
  const queries = vectors.map(({ id, vector }) => ({
    id,
    vector: validateVector(vector),
    reference: [] as Match[],
  }));
  const digest = createHash('sha256');
  let points = 0;
  const db = openSnapshot(file);
  try {
    for (const rows of vectorPages(db, generation)) {
      const mapping = rows.map(({ rowid: _rowid, vector, ...identity }) => {
        const id = passagePointId(identity);
        digest.update(JSON.stringify([id, vector])).update('\n');
        const embedding = decodeVector(vector);
        for (const query of queries) {
          const score = dot(query.vector, embedding);
          keepTop(query.reference, { id, score });
        }
        points++;
        return { ...identity, id };
      });
      saveMapping(mapping);
    }
  } finally {
    db.close();
    if (snapshotDigest(file) !== fileDigest)
      throw new Error('SQLite snapshot changed during preparation');
  }
  if (points === 0) throw new Error('Snapshot has no vectors for the encoder generation');
  return {
    dataset: { runId: randomUUID(), generation, points, digest: digest.digest('hex'), fileDigest },
    queries,
  };
}

type QdrantReply<T> = { result: T; time: number };
type Collection = ReturnType<typeof qdrantCollection>;
type Point = { id: string; vector: number[]; payload: PassageIdentity };
type SearchMatch = Match & { payload: PassageIdentity };
type CollectionInfo = {
  config?: {
    metadata?: Record<string, unknown>;
    params?: { vectors?: { size?: number; distance?: string; datatype?: string; memory?: string } };
    hnsw_config?: Record<string, unknown>;
    optimizer_config?: Record<string, unknown>;
    quantization_config?: unknown;
  };
};
const vectorConfig = { size: DIMENSIONS, distance: 'Dot', datatype: 'float32', memory: 'cold' };
const graphConfig = { m: 16, ef_construct: 100, max_indexing_threads: 1, memory: 'cached' };
const optimizerConfig = { max_optimization_threads: 1, prevent_unoptimized: false };

function qdrantErrorReason(envelope: unknown) {
  const reason = (envelope as { status?: { error?: unknown } } | null)?.status?.error;
  return typeof reason === 'string' ? reason : undefined;
}

async function readErrorReason(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 16_384) {
      await reader.cancel();
      return 'Error response exceeded the diagnostic size limit';
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return qdrantErrorReason(JSON.parse(text));
  } catch {
    if (response.headers.get('content-type')?.startsWith('text/plain')) return text;
  }
}

export function qdrantCollection(
  address: string,
  name: string,
  key?: string,
  record?: RecordEvent
) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error('Expected a loopback Qdrant URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Expected a loopback Qdrant URL with no credentials or path');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name)) throw new Error('Invalid benchmark collection name');
  const redact = (value: string) =>
    key
      ? value
          .replaceAll(key, '[redacted]')
          .replaceAll(JSON.stringify(key).slice(1, -1), '[redacted]')
      : value;
  return {
    name,
    path: `/collections/${name}`,
    async request<T>(method: string, path: string, body?: object, allowNotFound = false) {
      const route = { method, path: redact(path) };
      function transportFailure(error: unknown, status?: number) {
        const exception =
          error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)
            ? redact(error.name)
            : 'Unknown';
        const cause =
          error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
        const code = cause?.code;
        const causeCode =
          typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(code)
            ? redact(code)
            : undefined;
        record?.({ event: 'qdrant-transport-error', ...route, status, exception, causeCode });
      }
      function responseFailure(status: number, reason: string) {
        record?.({
          event: 'qdrant-response-error',
          ...route,
          status,
          reason: redact(reason).trim().slice(0, 512),
        });
      }
      const headers = new Headers();
      if (key) headers.set('api-key', key);
      if (body) headers.set('content-type', 'application/json');
      let response: Response;
      try {
        response = await fetch(`${url.origin}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          redirect: 'error',
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        transportFailure(error);
        throw new Error(`Qdrant ${method} request failed before a response`);
      }
      if (response.status === 404 && allowNotFound) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok) {
        let reason: string | undefined;
        try {
          reason = await readErrorReason(response);
        } catch (error) {
          transportFailure(error, response.status);
        }
        responseFailure(response.status, reason || 'No readable Qdrant error reason');
        throw new Error(`Qdrant ${method} request returned HTTP ${response.status}`);
      }
      let envelope: QdrantReply<T> & { status: unknown };
      try {
        envelope = (await response.json()) as typeof envelope;
      } catch (error) {
        if (!(error instanceof SyntaxError)) transportFailure(error, response.status);
        responseFailure(response.status, 'Invalid Qdrant JSON response');
        throw new Error(`Qdrant ${method} returned invalid JSON`);
      }
      if (envelope?.status !== 'ok' || envelope.result == null || !Number.isFinite(envelope.time)) {
        responseFailure(
          response.status,
          qdrantErrorReason(envelope) ?? 'Invalid Qdrant result envelope'
        );
        throw new Error(`Qdrant ${method} returned an invalid result envelope`);
      }
      return envelope;
    },
  };
}

function matchesConfig(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>
) {
  return Object.entries(expected).every(([name, value]) => actual?.[name] === value);
}

async function exactCount(collection: Collection) {
  const reply = await collection.request<{ count: number }>(
    'POST',
    `${collection.path}/points/count`,
    { exact: true }
  );
  const count = reply?.result.count;
  if (count === undefined || !Number.isSafeInteger(count) || count < 0)
    throw new Error('Invalid exact point count');
  return count;
}

async function assertCollection(collection: Collection, dataset: Dataset, expectedCount: number) {
  const info = (await collection.request<CollectionInfo>('GET', collection.path))!.result;
  const config = info.config;
  if (
    !matchesConfig(config?.metadata, dataset) ||
    !matchesConfig(config?.params?.vectors, vectorConfig) ||
    !matchesConfig(config?.hnsw_config, graphConfig) ||
    !matchesConfig(config?.optimizer_config, optimizerConfig) ||
    config?.quantization_config != null
  )
    throw new Error(
      'Qdrant collection configuration or dataset identity differs from the benchmark'
    );
  if ((await exactCount(collection)) !== expectedCount)
    throw new Error('Qdrant collection has an unexpected exact point count');
  return info;
}

async function updatePoints(
  collection: Collection,
  operation: 'upsert' | 'delete',
  items: Point[] | string[],
  record: RecordEvent
) {
  const method = operation === 'upsert' ? 'PUT' : 'POST';
  const suffix = operation === 'upsert' ? '' : '/delete';
  const reply = (await collection.request<{ operation_id?: number; status: string }>(
    method,
    `${collection.path}/points${suffix}?wait=true`,
    { points: items }
  ))!;
  if (reply.result.status !== 'completed') {
    record({ event: 'write-not-completed', operation, qdrant: reply });
    throw new Error(`Qdrant ${operation} did not report completed`);
  }
  return reply;
}

export async function importSnapshot(
  collection: Collection,
  file: string,
  dataset: Dataset,
  record: RecordEvent
) {
  if (await collection.request<CollectionInfo>('GET', collection.path, undefined, true)) {
    throw new Error('Qdrant collection already exists; choose a fresh collection name');
  }
  const before = snapshotDigest(file);
  if (before !== dataset.fileDigest) throw new Error('SQLite snapshot differs from preparation');
  const db = openSnapshot(file);
  const started = performance.now();
  let points = 0;
  try {
    const creation = await collection.request<boolean>('PUT', collection.path, {
      vectors: vectorConfig,
      hnsw_config: graphConfig,
      optimizers_config: optimizerConfig,
      metadata: dataset,
    });
    if (creation?.result !== true) throw new Error('Qdrant did not confirm collection creation');
    record({ event: 'created', info: await assertCollection(collection, dataset, 0) });
    for (const rows of vectorPages(db, dataset.generation)) {
      const batch = rows.map(({ rowid: _rowid, vector, ...payload }) => ({
        id: passagePointId(payload),
        vector: decodeVector(vector),
        payload,
      }));
      const reply = await updatePoints(collection, 'upsert', batch, record);
      points += batch.length;
      record({ event: 'batch-completed', points, batchSize: batch.length, qdrant: reply });
    }
  } finally {
    db.close();
    if (snapshotDigest(file) !== before) throw new Error('SQLite snapshot changed during import');
  }
  const info = await assertCollection(collection, dataset, dataset.points);
  if (points !== dataset.points) throw new Error('Imported row count differs from preparation');
  return { dataset, points, elapsedMs: performance.now() - started, info };
}

async function search(collection: Collection, vector: number[], exact: boolean, filter?: object) {
  const started = performance.now();
  const { result, time } = (await collection.request<{ points: SearchMatch[] }>(
    'POST',
    `${collection.path}/points/query`,
    {
      query: vector,
      limit: filter ? 1 : TOP,
      params: exact ? { exact: true } : { exact: false, hnsw_ef: HNSW_EF },
      with_payload: true,
      with_vector: false,
      filter,
    }
  ))!;
  const wallMs = performance.now() - started;
  if (
    !Array.isArray(result.points) ||
    result.points.some(({ id, score }) => typeof id !== 'string' || !Number.isFinite(score))
  ) {
    throw new Error('Qdrant returned invalid point IDs or scores');
  }
  if (new Set(result.points.map(({ id }) => id)).size !== result.points.length) {
    throw new Error('Qdrant returned duplicate point IDs');
  }
  return { matches: result.points, serverMs: time * 1000, wallMs };
}

function independentScores(
  db: Database.Database,
  generation: string,
  query: PreparedQuery,
  matches: SearchMatch[]
) {
  const lookup = db.prepare<[string, string, number, number, string], { vector: string }>(`
    SELECT p.vector FROM memory_passages AS p
    JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
    WHERE p.id=? AND p.version=? AND p.start=? AND p.end=? AND p.generation=? AND p.vector IS NOT NULL
  `);
  const known = new Set(query.reference.map(({ id }) => id));
  const scores = new Map<string, number>();
  for (const { id, payload } of matches) {
    if (!payload || payload.generation !== generation || passagePointId(payload) !== id) {
      throw new Error('Qdrant returned a point with a mismatched passage identity');
    }
    if (known.has(id)) continue;
    const row = lookup.get(
      payload.sourceId,
      payload.version,
      payload.start,
      payload.end,
      generation
    );
    if (!row) throw new Error('Qdrant returned an ID outside the prepared dataset');
    scores.set(id, dot(query.vector, decodeVector(row.vector)));
  }
  return scores;
}

const counterNames = ['unfiltered_hnsw', 'unfiltered_plain', 'unfiltered_exact'] as const;
type CounterName = (typeof counterNames)[number];
type SearchCounters = Partial<Record<CounterName, { count: number }>>;
type Telemetry = {
  collections?: {
    collections?: Array<{
      id: string;
      shards?: Array<{
        local?: { segments?: Array<{ vector_index_searches?: SearchCounters[] }> };
      }>;
    }>;
  };
};

async function telemetry(collection: Collection, record: RecordEvent, phase: string) {
  let data: Telemetry | undefined;
  try {
    data = (await collection.request<Telemetry>('GET', '/telemetry?details_level=4'))?.result;
  } catch (error) {
    record({ event: 'telemetry-unavailable', phase, error: (error as Error).message });
    return;
  }
  record({ event: 'telemetry', phase, data });
  const segments = data?.collections?.collections
    ?.find(({ id }) => id === collection.name)
    ?.shards?.flatMap(({ local }) => local?.segments ?? []);
  const indexes = segments?.flatMap(({ vector_index_searches }) => vector_index_searches ?? []);
  if (!indexes?.length) return;
  return {
    segments: segments!.length,
    counts: Object.fromEntries(
      counterNames.map((key) => [
        key,
        indexes.reduce((total, index) => total + (index[key]?.count ?? 0), 0),
      ])
    ),
  };
}

export async function querySnapshot(
  collection: Collection,
  file: string,
  prepared: Prepared,
  modes: Array<'exact' | 'hnsw'>,
  record: RecordEvent
) {
  const { dataset, queries } = prepared;
  if (snapshotDigest(file) !== dataset.fileDigest)
    throw new Error('SQLite snapshot differs from preparation');
  record({
    event: 'collection-before-query',
    info: await assertCollection(collection, dataset, dataset.points),
  });
  const db = openSnapshot(file);
  try {
    for (const mode of modes) {
      const before = await telemetry(collection, record, `${mode}-before`);
      const observations = [];
      for (const query of queries) {
        const observation = await search(collection, query.vector, mode === 'exact');
        record({ event: 'query', mode, queryId: query.id, ...observation });
        observations.push({ query, observation });
      }
      const after = await telemetry(collection, record, `${mode}-after`);
      const delta =
        before &&
        after &&
        before.segments === after.segments &&
        counterNames.every((name) => after.counts[name] >= before.counts[name])
          ? Object.fromEntries(
              counterNames.map((name) => [name, after.counts[name] - before.counts[name]])
            )
          : undefined;
      record({
        event: 'search-path',
        mode,
        indexUsage: delta?.unfiltered_hnsw ? 'observed' : 'unknown',
        delta,
      });
      for (const { query, observation } of observations) {
        const scores = independentScores(db, dataset.generation, query, observation.matches);
        record({
          event: 'comparison',
          mode,
          queryId: query.id,
          top: [1, 5, 10, 25, 50, TOP].map((k) =>
            compareTop(query.reference, observation.matches, k, scores)
          ),
        });
      }
    }
  } finally {
    db.close();
    if (snapshotDigest(file) !== dataset.fileDigest)
      throw new Error('SQLite snapshot changed during query comparison');
  }
  return { dataset, queries: queries.length, modes, hnswEf: HNSW_EF, scoreTie: SCORE_TIE };
}

export async function exerciseMutations(
  collection: Collection,
  dataset: Dataset,
  verifyOnly: boolean,
  record: RecordEvent
) {
  const basis = [1, ...Array<number>(DIMENSIONS - 1).fill(0)];
  const sentinel = (name: string, version: string, first: number): Point => {
    const payload = {
      sourceId: `benchmark-sentinel:${dataset.runId}:${name}`,
      version,
      start: 0,
      end: 1,
      generation: dataset.generation,
    };
    return { id: passagePointId(payload), vector: [first, ...basis.slice(1)], payload };
  };
  const old = sentinel('revised', 'v1', 0.25);
  const revised = sentinel('revised', 'v2', 0.75);
  const deleted = sentinel('deleted', 'v1', -0.5);

  async function verify(phase: string, live: Point[], absent: Point[]) {
    const ids = [...live, ...absent].map(({ id }) => id);
    const reply = (await collection.request<Point[]>('POST', `${collection.path}/points`, {
      ids,
      with_payload: true,
      with_vector: true,
    }))!;
    record({
      event: 'sentinel-retrieval',
      phase,
      expected: live.map(({ id }) => id),
      observed: reply.result.map(({ id, payload, vector }) => ({ id, payload, vector })),
    });
    const byId = new Map(reply.result.map((point) => [point.id, point]));
    if (
      reply.result.length !== live.length ||
      live.some((point) => {
        const actual = byId.get(point.id);
        return (
          !actual?.payload ||
          passagePointId(actual.payload) !== point.id ||
          validateVector(actual.vector).some((value, index) => value !== point.vector[index])
        );
      })
    )
      throw new Error(`Sentinel state mismatch during ${phase}`);
    for (const point of live) {
      const result = await search(collection, basis, true, { must: [{ has_id: [point.id] }] });
      record({ event: 'sentinel-search', phase, expectedId: point.id, ...result });
      if (
        result.matches.length !== 1 ||
        result.matches[0].id !== point.id ||
        Math.abs(result.matches[0].score - point.vector[0]) > SCORE_TIE
      ) {
        throw new Error(`Sentinel not visible to search during ${phase}`);
      }
    }
    if ((await exactCount(collection)) !== dataset.points + live.length) {
      throw new Error(`Point count mismatch during ${phase}`);
    }
  }

  record({
    event: 'collection-before-mutations',
    info: await assertCollection(collection, dataset, dataset.points + Number(verifyOnly)),
  });
  if (verifyOnly) {
    await verify('persisted', [revised], [old, deleted]);
  } else {
    await verify('before', [], [old, revised, deleted]);
    record({
      event: 'initial-upsert-completed',
      qdrant: await updatePoints(collection, 'upsert', [old, deleted], record),
    });
    await verify('initial-upsert', [old, deleted], [revised]);
    for (const phase of ['revision-and-delete', 'replay']) {
      record({
        event: 'revision-upsert-completed',
        phase,
        qdrant: await updatePoints(collection, 'upsert', [revised], record),
      });
      record({
        event: 'delete-completed',
        phase,
        qdrant: await updatePoints(collection, 'delete', [old.id, deleted.id], record),
      });
      await verify(phase, [revised], [old, deleted]);
    }
  }
  return { dataset, verifyOnly, live: revised.id, absent: [old.id, deleted.id] };
}
