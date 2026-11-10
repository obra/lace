// ABOUTME: Owns the loopback Qdrant protocol for Lace's derived memory search index.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const DIMENSIONS = 768;
const WRITE_BATCH_SIZE = 128;
const PROJECTION_FORMAT = 'lace-memory-search-v1';
const vectorConfig = { size: DIMENSIONS, distance: 'Dot', datatype: 'float32', memory: 'cold' };
const graphConfig = { m: 16, ef_construct: 100, max_indexing_threads: 1, memory: 'cached' };
const optimizerConfig = { max_optimization_threads: 1, prevent_unoptimized: false };

const passageSchema = z.object({
  kind: z.literal('passage'),
  sourceId: z.string().min(1),
  version: z.string().min(1),
  start: z.number().int().nonnegative().safe(),
  end: z.number().int().positive().safe(),
});
const noteSchema = z.object({
  kind: z.literal('note'),
  noteId: z.string().min(1),
  revision: z.number().int().positive().safe(),
});
const identitySchema = z.discriminatedUnion('kind', [passageSchema, noteSchema]);
const matchSchema = z.object({
  id: z.string(),
  score: z.number().finite(),
  payload: z.object({ generation: z.string() }).passthrough(),
});

export type PassageSearchIdentity = z.infer<typeof passageSchema>;
export type NoteSearchIdentity = z.infer<typeof noteSchema>;
export type MemorySearchIdentity = z.infer<typeof identitySchema>;
export type MemorySearchPoint = { identity: MemorySearchIdentity; vector: number[] };
export type MemorySearchHit = { identity: MemorySearchIdentity; score: number };

type Owner = { instanceId: string; generation: string };
type CollectionInfo = {
  config?: {
    metadata?: {
      instanceId?: unknown;
      generation?: unknown;
      format?: unknown;
      incarnation?: unknown;
    };
    params?: {
      vectors?: Record<string, unknown>;
      sparse_vectors?: Record<string, unknown>;
    };
    hnsw_config?: Record<string, unknown>;
    optimizer_config?: Record<string, unknown>;
    quantization_config?: unknown;
  };
};

function parseIdentity(value: unknown): MemorySearchIdentity {
  const parsed = identitySchema.safeParse(value);
  if (!parsed.success || (parsed.data.kind === 'passage' && parsed.data.start >= parsed.data.end)) {
    throw new Error('Invalid memory search identity');
  }
  return parsed.data;
}

function pointId(identity: MemorySearchIdentity, generation: string): string {
  // Keep passage IDs aligned with the qualification corpus and namespace note revisions separately.
  const key =
    identity.kind === 'passage'
      ? [
          'lace-passage',
          identity.sourceId,
          identity.version,
          identity.start,
          identity.end,
          generation,
        ]
      : ['lace-note', identity.noteId, identity.revision, generation];
  const bytes = createHash('sha256').update(JSON.stringify(key)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateVector(vector: number[]) {
  if (Array.isArray(vector) && vector.length === DIMENSIONS) {
    // Array iteration includes holes, which JSON would silently turn into null values.
    for (const value of vector) {
      if (typeof value !== 'number' || !Number.isFinite(Math.fround(value))) {
        throw new Error('Expected 768 finite Float32-representable vector elements');
      }
    }
    return;
  }
  throw new Error('Expected 768 finite Float32-representable vector elements');
}

function matchesSettings(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>
) {
  return Object.entries(expected).every(([key, value]) => actual?.[key] === value);
}

async function errorDetail(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 16_384) {
      await reader.cancel();
      return 'error response exceeds the diagnostic size limit';
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  if (response.headers.get('content-type')?.startsWith('text/plain')) return text;
  const body = JSON.parse(text) as { status?: { error?: unknown } } | null;
  if (typeof body?.status?.error === 'string') return body.status.error;
}

export class MemorySearchIndex {
  private readonly origin: string;
  private readonly collection: string;
  private readonly owner: Owner;
  private readonly key?: string;
  private validation: 'unchecked' | 'read' | 'ensured' = 'unchecked';

  constructor(
    { url, apiKeyFile }: { url: string; apiKeyFile?: string },
    { instanceId, generation }: Owner
  ) {
    let endpoint: URL;
    try {
      endpoint = new URL(url);
    } catch {
      throw new Error('Expected a literal loopback memory search URL');
    }
    if (
      !/^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(url) ||
      endpoint.username ||
      endpoint.password
    ) {
      throw new Error('Expected a literal loopback memory search URL');
    }
    if (!instanceId || !generation)
      throw new Error('Memory search instance and generation are required');
    this.origin = endpoint.origin;
    this.owner = { instanceId, generation };
    const scope = createHash('sha256')
      .update(JSON.stringify([instanceId, generation]))
      .digest('hex');
    this.collection = `/collections/lace-memory-${scope}`;
    if (apiKeyFile !== undefined) {
      try {
        this.key = readFileSync(apiKeyFile, 'utf8').trim();
      } catch {
        throw new Error('Unable to read the memory search API key file');
      }
      if (!/^[\x21-\x7e]+$/.test(this.key)) throw new Error('Invalid memory search API key file');
    }
  }

  async ensure(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    this.validation = 'unchecked';
    let info = await this.request<CollectionInfo>('GET', '', signal, undefined, true);
    let createdIncarnation: string | undefined;
    if (info === undefined) {
      createdIncarnation = randomUUID();
      const created = await this.request<boolean>('PUT', '', signal, {
        vectors: vectorConfig,
        hnsw_config: graphConfig,
        optimizers_config: optimizerConfig,
        metadata: { ...this.owner, format: PROJECTION_FORMAT, incarnation: createdIncarnation },
      });
      if (created !== true)
        throw new Error('Qdrant did not confirm memory search collection creation');
      info = await this.request<CollectionInfo>('GET', '', signal);
    }
    const incarnation = this.validateCollection(info);
    if (createdIncarnation !== undefined && createdIncarnation !== incarnation) {
      throw new Error('Memory search collection incarnation changed during creation');
    }
    this.validation = 'ensured';
    return incarnation;
  }

  async upsert(points: MemorySearchPoint[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.requireEnsure();
    const items = points.map(({ identity, vector }) => {
      validateVector(vector);
      const parsed = parseIdentity(identity);
      return {
        id: pointId(parsed, this.owner.generation),
        vector,
        payload: { ...parsed, generation: this.owner.generation },
      };
    });
    await this.write('PUT', '/points?wait=true', items, signal);
  }

  async remove(identities: MemorySearchIdentity[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.requireEnsure();
    const ids = identities.map((identity) =>
      pointId(parseIdentity(identity), this.owner.generation)
    );
    await this.write('POST', '/points/delete?wait=true', ids, signal);
  }

  async query(vector: number[], limit: number, signal: AbortSignal): Promise<MemorySearchHit[]> {
    signal.throwIfAborted();
    validateVector(vector);
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error('Invalid memory search query limit');
    if (this.validation === 'unchecked') {
      this.validateCollection(await this.request<CollectionInfo>('GET', '', signal));
      if (this.validation === 'unchecked') this.validation = 'read';
    }
    const result = await this.request<{ points?: unknown }>('POST', '/points/query', signal, {
      query: vector,
      limit,
      params: { exact: true },
      with_payload: true,
      with_vector: false,
    });
    if (!Array.isArray(result?.points)) throw new Error('Invalid Qdrant memory search results');
    if (result.points.length > limit)
      throw new Error('Qdrant memory search exceeded the query limit');
    const ids = new Set<string>();
    return result.points.map((point: unknown) => {
      const match = matchSchema.safeParse(point);
      if (!match.success || match.data.payload.generation !== this.owner.generation) {
        throw new Error('Invalid Qdrant memory search hit');
      }
      const { id, payload, score } = match.data;
      const identity = parseIdentity(payload);
      if (id !== pointId(identity, this.owner.generation))
        throw new Error('Invalid Qdrant memory search point ID');
      if (ids.has(id)) throw new Error('Duplicate Qdrant memory search point ID');
      ids.add(id);
      return { identity, score };
    });
  }

  private validateCollection(info: CollectionInfo | undefined): string {
    const config = info?.config;
    const metadata = config?.metadata;
    if (
      !metadata ||
      metadata.instanceId !== this.owner.instanceId ||
      metadata.generation !== this.owner.generation ||
      metadata.format !== PROJECTION_FORMAT ||
      typeof metadata.incarnation !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        metadata.incarnation
      )
    ) {
      throw new Error('Memory search collection identity does not match the requested projection');
    }
    const vectors = config?.params?.vectors;
    if (
      !matchesSettings(vectors, vectorConfig) ||
      !matchesSettings(config?.hnsw_config, graphConfig) ||
      !matchesSettings(config?.optimizer_config, optimizerConfig) ||
      config?.quantization_config != null ||
      vectors?.quantization_config != null ||
      vectors?.hnsw_config != null ||
      vectors?.multivector_config != null ||
      Object.keys(config?.params?.sparse_vectors ?? {}).length
    ) {
      throw new Error('Memory search collection settings do not match the requested projection');
    }
    return metadata.incarnation;
  }

  private requireEnsure() {
    if (this.validation !== 'ensured')
      throw new Error('Ensure the memory search collection before writing');
  }

  private async write<T>(method: 'PUT' | 'POST', path: string, items: T[], signal: AbortSignal) {
    for (let start = 0; start < items.length; start += WRITE_BATCH_SIZE) {
      const result = await this.request<{ status?: unknown }>(method, path, signal, {
        points: items.slice(start, start + WRITE_BATCH_SIZE),
      });
      if (result?.status !== 'completed')
        throw new Error('Qdrant memory search write did not report completed');
    }
  }

  private async request<T>(
    method: 'GET' | 'PUT' | 'POST',
    path: string,
    signal: AbortSignal,
    body?: object,
    allowMissing = false
  ): Promise<T | undefined> {
    signal.throwIfAborted();
    const headers = new Headers();
    if (this.key) headers.set('api-key', this.key);
    if (body) headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${this.origin}${this.collection}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal,
        redirect: 'error',
      });
    } catch (error) {
      signal.throwIfAborted();
      const code =
        error instanceof Error ? (error.cause as { code?: unknown } | undefined)?.code : undefined;
      const cause =
        typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(code)
          ? ` (${this.redact(code)})`
          : '';
      throw new Error(`Qdrant memory search ${method} request failed${cause}`);
    }
    if (response.status === 404 && allowMissing) {
      await response.body?.cancel();
      signal.throwIfAborted();
      return undefined;
    }
    if (!response.ok) {
      let detail: string | undefined;
      try {
        detail = await errorDetail(response);
      } catch {
        signal.throwIfAborted();
      }
      const reason = detail ? this.redact(detail).trim().slice(0, 512) : '';
      throw new Error(
        `Qdrant memory search ${method} returned HTTP ${response.status}${reason ? `: ${reason}` : ''}`
      );
    }
    let reply: { status?: unknown; result?: T } | null;
    try {
      reply = (await response.json()) as typeof reply;
    } catch {
      signal.throwIfAborted();
      throw new Error('Invalid Qdrant memory search JSON response');
    }
    signal.throwIfAborted();
    if (reply?.status !== 'ok' || reply.result == null)
      throw new Error('Invalid Qdrant memory search response');
    return reply.result;
  }

  private redact(value: string) {
    if (!this.key) return value;
    return value
      .replaceAll(JSON.stringify(this.key).slice(1, -1), '[redacted]')
      .replaceAll(this.key, '[redacted]');
  }
}
