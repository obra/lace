// ABOUTME: Reconciliation uses old related heads and complete originals under bounded budgets.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { HostMemoryBinding } from '@lace/ent-protocol';
import { claimMemoryOwner, configureMemoryRoles, openMemoryDatabase } from '../authority';
import { MemoryNotes } from '../notes';
import { createMemoryRuntime } from '../runtime';
import { sourceHandle, type Source } from '../types';

const sessionId = 'sess_11111111-1111-4111-8111-111111111111';
const grant = {
  producerId: 'persona:root',
  canRead: true,
  canMutate: true,
  collections: [],
  writableCollections: [],
};
let dir: string;
let databasePath: string;
let binding: HostMemoryBinding;
let runtime: ReturnType<typeof createMemoryRuntime>;
let db: ReturnType<typeof openMemoryDatabase>;
let notes: MemoryNotes;
function event(seq: number, text: string, timestamp = '2026-10-30T00:00:00Z'): Source {
  const file = join(dir, 'agent-sessions', sessionId, 'events.jsonl');
  mkdirSync(join(file, '..'), { recursive: true });
  const line = JSON.stringify({
    eventSeq: seq,
    type: 'message',
    timestamp,
    data: { content: text },
  });
  const content = [
    {
      type: 'text',
      text: `Transcript event type=message; session=${sessionId}; seq=${seq}\n${text}`,
    },
  ];
  const offset = (() => {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  })();
  writeFileSync(file, line + '\n', { flag: 'a' });
  return {
    id: `event:${sessionId}:${seq}`,
    version: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    reference: {
      kind: 'event',
      sessionId,
      eventSeq: seq,
      file,
      offset,
      bytes: Buffer.byteLength(line),
    },
  };
}
function seed(id: string, text: string, sources: Source[]) {
  for (const source of sources) {
    notes.discover(source);
    notes.status(source, 'completed');
  }
  const refs = JSON.stringify(sources);
  db.prepare('INSERT INTO memory_notes VALUES(?,1,?,?,?)').run(id, text, 'persona:root', refs);
  db.prepare('INSERT INTO memory_revisions VALUES(?,1,?,?,?,?)').run(
    id,
    text,
    'persona:root',
    refs,
    `seed-${id}`
  );
  db.prepare('INSERT INTO memory_fts(id,content) VALUES(?,?)').run(id, text);
}
const empty = { text: '{"changes":[]}', stopReason: 'end_turn' as const, toolCalls: [] };
function open(
  query: any,
  encoder: any = {
    generation: 'fake-v1',
    async encode(texts: string[]) {
      return texts.map((t) => (t.includes('fruit') || t.includes('apples') ? [1, 0] : [0, 1]));
    },
  }
) {
  runtime = createMemoryRuntime(
    { databasePath, binding, extraction: { connectionId: 'fake', modelId: 'fake' } },
    { query, supportsImages: async () => false, encoder } as any
  );
  return runtime;
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lace-changed-facts-'));
  vi.stubEnv('LACE_DIR', dir);
  vi.stubEnv('LACE_SESSION_DIR', join(dir, 'agent-sessions'));
  mkdirSync(join(dir, 'agent-sessions'), { recursive: true });
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
});
afterEach(async () => {
  await runtime?.close();
  db.close();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

it('finds an old paraphrased head beyond sixteen distractors and reserves its original before a sixteen-event backlog', async () => {
  seed('fruit', 'Jesse prefers fruit.', [event(1, 'Jesse likes apples.')]);
  for (let n = 2; n <= 20; n++)
    seed(`distractor-${n}`, `Unrelated road ${n}`, [event(n, `Unrelated road ${n}`)]);
  for (let n = 21; n <= 36; n++) event(n, 'Jesse no longer likes apples.');
  const batches: any[] = [];
  open((request: any) => {
    batches.push(JSON.parse(request.messages[0].content[0].text));
    return empty;
  });
  await runtime.wake();
  expect(batches.length).toBeGreaterThan(1);
  expect(batches[0].candidates.map((n: any) => n.id)).toContain('fruit');
  expect(batches[0].sources.some((s: any) => s.id === sourceHandle(eventSource(1)))).toBe(true);
  expect(batches.every((b) => b.sources.length <= 16)).toBe(true);
  expect(
    batches[0].withheld.some(
      (entry: any) => entry.id.startsWith('memory:') && entry.reason.includes('budget')
    )
  ).toBe(true);
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM memory_sources WHERE status='completed'").get()
  ).toEqual({ n: 36 });
});
function eventSource(seq: number): Source {
  return notes
    .note('fruit')!
    .sources.find((s) => s.reference.kind === 'event' && s.reference.eventSeq === seq)!;
}

it('supplies recorded time separately while retaining the existing event content identity', async () => {
  const original = event(1, 'Jesse has left the team.', '2026-09-01T11:12:13Z');
  let body: any;
  open((request: any) => {
    body = JSON.parse(request.messages[0].content[0].text);
    return empty;
  });
  await runtime.wake();
  expect(body.sources[0].recordedAt).toBe('2026-09-01T11:12:13Z');
  expect(body.sources[0].id).toBe(sourceHandle(original));
  expect(
    JSON.parse(
      (db.prepare('SELECT manifest FROM memory_offers').get() as { manifest: string }).manifest
    ).sources[0].recordedAt
  ).toBe('2026-09-01T11:12:13Z');
  expect(db.prepare('SELECT version FROM memory_sources').get()).toEqual({
    version: original.version,
  });
});

it('records visible text fallback and treats FTS operators in originals as literal terms', async () => {
  seed('operator', 'OR departure', [event(1, 'Original account')]);
  event(2, 'OR " : - *');
  let body: any;
  open(
    (request: any) => {
      body = JSON.parse(request.messages[0].content[0].text);
      return empty;
    },
    {
      generation: 'broken',
      async encode() {
        throw new Error('assets absent');
      },
    }
  );
  await runtime.wake();
  expect(body.candidates.map((n: any) => n.id)).toContain('operator');
  expect(
    body.withheld.some(
      (w: any) => w.reason.includes('text-only') && w.reason.includes('assets absent')
    )
  ).toBe(true);
  const manifest = JSON.parse(
    (db.prepare('SELECT manifest FROM memory_offers').get() as any).manifest
  );
  expect(manifest.withheld).toEqual(body.withheld);
});

it('reuses exact revision vectors and rebuilds a changed head without promoting identifiers', async () => {
  seed('fruit', 'Jesse prefers fruit.', [event(1, 'Jesse likes apples.')]);
  event(2, 'Jesse no longer likes apples.');
  const encoded: string[] = [];
  open(() => empty, {
    generation: 'cache-v1',
    async encode(texts: string[], kind: string) {
      if (kind === 'document') encoded.push(...texts);
      return texts.map(() => [1, 0]);
    },
  });
  await runtime.wake();
  event(3, 'Jesse likes apples again.');
  await runtime.wake();
  expect(encoded).toEqual(['Jesse prefers fruit.']);
  db.prepare('UPDATE memory_notes SET revision=2,text=? WHERE id=?').run(
    'Jesse has returned to fruit.',
    'fruit'
  );
  event(4, 'Jesse likes apples today.');
  await runtime.wake();
  expect(encoded).toEqual(['Jesse prefers fruit.', 'Jesse has returned to fruit.']);
  expect(
    db.prepare('SELECT revision,generation FROM memory_vectors WHERE note_id=?').get('fruit')
  ).toEqual({ revision: 2, generation: 'cache-v1' });
});

it('rejects unavailable candidate support atomically so a later complete candidate still fits', async () => {
  const shared = event(1, 'First readable support');
  const gone = event(2, 'Missing support');
  gone.reference = { ...gone.reference, eventSeq: 999 } as Source['reference'];
  seed('unsupported', 'Jesse prefers fruit.', [shared, gone]);
  seed('supported', 'Jesse prefers apples.', [event(3, 'x'.repeat(31_000))]);
  event(4, 'Jesse likes apples. ' + 'y'.repeat(31_000));
  let body: any;
  open((request: any) => {
    body = JSON.parse(request.messages[0].content[0].text);
    return empty;
  });
  await runtime.wake();
  expect(body.candidates.map((n: any) => n.id)).toEqual(['supported']);
  expect(body.sources).toHaveLength(2);
  expect(body.withheld.some((w: any) => w.id === 'memory:unsupported')).toBe(true);
});

it.each(['close', 'replace'])(
  'fences vector publication and extraction after asynchronous encoder %s',
  async (mode) => {
    seed('fruit', 'Jesse prefers fruit.', [event(1, 'Jesse likes apples.')]);
    event(2, 'Jesse no longer likes apples.');
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let extracted = false;
    open(
      () => {
        extracted = true;
        return empty;
      },
      {
        generation: 'held',
        async encode() {
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return [[1, 0]];
        },
      }
    );
    const work = runtime.wake();
    await started;
    if (mode === 'close') await runtime.close();
    else db.prepare('UPDATE memory_worker SET attempt=?').run('replacement');
    release();
    await work;
    expect(extracted).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_vectors').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_receipts').get()).toEqual({ n: 0 });
  }
);

it('preserves departure, reassignment and return as sequential accepted revisions with competing accounts intact', async () => {
  const original = event(1, 'On October 1 Alice owns routing. Bob owns billing.');
  seed('routing', 'Alice owns routing as of October 1.', [original]);
  seed('billing', 'Bob owns billing.', [original]);
  const history = [
    {
      text: 'On October 2 Alice left; no successor was named.',
      note: 'Alice formerly owned routing. She left October 2; the current owner is unknown.',
    },
    {
      text: 'On October 3 Bea took over routing.',
      note: 'Bea owns routing since October 3, after Alice left October 2.',
    },
    {
      text: 'On October 4 Alice returned and took routing back from Bea.',
      note: 'Alice owns routing again since October 4; Bea held it October 3–4 after Alice left October 2.',
    },
  ];
  let current = history[0];
  open(
    (request: any) => {
      const body = JSON.parse(request.messages[0].content[0].text);
      const candidate = body.candidates.find((note: any) => note.id === 'routing');
      const fresh = body.sources.find((source: any) => source.text.includes(current.text));
      expect(candidate).toBeDefined();
      expect(fresh).toBeDefined();
      return {
        ...empty,
        text: JSON.stringify({
          changes: [
            {
              text: current.note,
              sourceIds: [fresh.id],
              target: { noteId: candidate.id, revision: candidate.revision },
            },
          ],
        }),
      };
    },
    {
      generation: 'sequential',
      async encode(texts: string[]) {
        return texts.map(() => [1, 0]);
      },
    }
  );
  for (const [index, step] of history.entries()) {
    current = step;
    event(index + 2, step.text);
    await runtime.wake();
  }
  expect(notes.note('routing')).toMatchObject({ revision: 4, text: history[2].note });
  expect(notes.note('billing')).toMatchObject({ revision: 1, text: 'Bob owns billing.' });
  expect(
    db
      .prepare('SELECT revision FROM memory_revisions WHERE note_id=? ORDER BY revision')
      .all('routing')
  ).toEqual([{ revision: 1 }, { revision: 2 }, { revision: 3 }, { revision: 4 }]);
});

it('does not cache an old revision when a note changes during awaited document encoding', async () => {
  seed('fruit', 'Jesse prefers fruit.', [event(1, 'Jesse likes apples.')]);
  event(2, 'Jesse no longer likes apples.');
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  open(() => empty, {
    generation: 'stale',
    async encode(texts: string[], kind: string) {
      if (kind === 'document') {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return texts.map(() => [1, 0]);
    },
  });
  const work = runtime.wake();
  await started;
  db.prepare('UPDATE memory_notes SET revision=2,text=? WHERE id=?').run(
    'Jesse prefers pears.',
    'fruit'
  );
  release();
  await work;
  expect(db.prepare('SELECT COUNT(*) AS n FROM memory_vectors').get()).toEqual({ n: 0 });
  expect(notes.note('fruit')?.revision).toBe(2);
});

it.each(['prompt', 'context_injected', 'tool_use'])(
  'supplies the durable timestamp for %s without adding it to hashed event content',
  async (type) => {
    event(1, 'placeholder');
    const path = join(dir, 'agent-sessions', sessionId, 'events.jsonl');
    const timestamp = '2026-08-01T09:10:11Z';
    const data =
      type === 'tool_use'
        ? {
            name: 'file_read',
            toolCallId: 't1',
            input: {},
            result: {
              outcome: 'completed',
              content: [{ type: 'text', text: 'complete original' }],
            },
          }
        : { content: 'complete original' };
    writeFileSync(path, JSON.stringify({ eventSeq: 1, type, timestamp, data }) + '\n');
    let body: any;
    open((request: any) => {
      body = JSON.parse(request.messages[0].content[0].text);
      return empty;
    });
    await runtime.wake();
    expect(body.sources[0].recordedAt).toBe(timestamp);
    const content =
      type === 'tool_use'
        ? [
            { type: 'text', text: 'tool=file_read\ninput={}' },
            { type: 'text', text: 'complete original' },
          ]
        : [
            {
              type: 'text',
              text: `Transcript event type=${type}; session=${sessionId}; seq=1\ncomplete original`,
            },
          ];
    expect(body.sources[0].version).toBe(
      createHash('sha256').update(JSON.stringify(content)).digest('hex')
    );
  }
);
