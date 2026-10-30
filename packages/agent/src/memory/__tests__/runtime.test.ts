import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SessionPromptRequestSchema, type HostMemoryBinding } from '@lace/ent-protocol';
import { appendDurableEvent } from '../../storage/event-log';
import { getSessionDir, writeSessionMeta } from '../../storage/session-store';
import { claimMemoryOwner, configureMemoryRoles, openMemoryDatabase } from '../authority';
import { createMemoryRuntime } from '../runtime';
import { RecallTool } from '../../tools/implementations/recall';
import { logger } from '../../utils/logger';
import { closeRecallIndex } from '../../storage/recall/index-db';

const sessionId = 'sess_11111111-1111-4111-8111-111111111111';
const grant = {
  producerId: 'persona:root',
  canRead: true,
  canMutate: true,
  collections: [],
  writableCollections: [],
};

describe('configured automatic memory', () => {
  let dir: string;
  let binding: HostMemoryBinding;
  let databasePath: string;
  let runtimes: ReturnType<typeof createMemoryRuntime>[];
  function git(...args: string[]) {
    return execFileSync('git', ['-C', join(dir, 'git'), ...args], { encoding: 'utf8' }).trim();
  }
  function commit(text: string) {
    writeFileSync(join(dir, 'git/knowledge.md'), text);
    git('add', 'knowledge.md');
    git(
      '-c',
      'user.name=Memory Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'fixture'
    );
  }
  function event(seq: number, text: string, extra = {}) {
    const path = join(dir, 'state/agent-sessions', sessionId);
    mkdirSync(path, { recursive: true });
    writeFileSync(
      join(path, 'events.jsonl'),
      JSON.stringify({
        eventSeq: seq,
        type: 'message',
        timestamp: '2026-10-29T00:00:00Z',
        data: { content: text },
        ...extra,
      }) + '\n',
      { flag: 'a' }
    );
  }
  function open(query: any) {
    const runtime = createMemoryRuntime(
      {
        databasePath,
        binding,
        extraction: { connectionId: 'fake', modelId: 'fake' },
        documentSources: { gitRoot: join(dir, 'git'), paths: ['knowledge.md'] },
      },
      { query, supportsImages: async () => true }
    );
    runtimes.push(runtime);
    return runtime;
  }
  function proposals(opts: any) {
    const body = JSON.parse(opts.messages[0].content[0].text);
    return {
      text: JSON.stringify({
        changes: [
          { text: 'Jesse prefers compact rows.', sourceIds: body.sources.map((s: any) => s.id) },
        ],
      }),
      stopReason: 'end_turn' as const,
      toolCalls: [],
    };
  }
  async function read(runtime: ReturnType<typeof createMemoryRuntime>, query = 'compact') {
    const tool = new RecallTool();
    const context = { signal: new AbortController().signal, memory: runtime.reader(binding) };
    const result = await tool.execute({ action: 'search', query }, context);
    const body = JSON.parse(result.content[0].text!);
    if (!body.memories?.length) return body;
    const expanded = await tool.execute(
      { action: 'read', event_id: body.memories[0].event_id },
      context
    );
    return JSON.parse(expanded.content[0].text!);
  }
  beforeEach(() => {
    logger.configure('warn', undefined, true);
    dir = mkdtempSync(join(tmpdir(), 'lace-auto-memory-'));
    runtimes = [];
    vi.stubEnv('LACE_DIR', join(dir, 'state'));
    vi.stubEnv('LACE_SESSION_DIR', join(dir, 'state/agent-sessions'));
    mkdirSync(join(dir, 'git'));
    git('init');
    commit('Jesse likes compact rows.');
    databasePath = join(dir, 'memory.sqlite');
    binding = {
      ...grant,
      instanceId: 'instance',
      ownerGeneration: claimMemoryOwner('instance', databasePath, 'root'),
      actorId: 'host',
      role: 'root',
      isRoot: true,
    };
    const db = openMemoryDatabase(databasePath, 'instance', false);
    configureMemoryRoles(db, binding, { root: grant });
    db.close();
  });
  afterEach(async () => {
    for (const runtime of runtimes) await runtime.close();
    closeRecallIndex();
    logger.configure('info', undefined, false);
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts retained events and pinned documents, then recalls the attributed current note after restart without replay', async () => {
    event(1, 'Use compact rows.');
    const runtime = open(proposals);
    await runtime.wake();
    const note = await read(runtime);
    expect(note.text).toBe('Jesse prefers compact rows.');
    expect(note.revision).toBe(1);
    expect(note.support).toHaveLength(2);
    expect(note.support.every((s: any) => s.status === 'current')).toBe(true);
    await runtime.close();
    const restarted = open(() => {
      throw new Error('already processed sources must not be submitted');
    });
    await restarted.wake();
    expect((await read(restarted)).text).toBe(note.text);
  });

  it('records empty success only for offered inputs and leaves oversize input explicitly omitted', async () => {
    event(1, 'x'.repeat(70_000));
    event(2, 'Useful fresh event');
    const runtime = open(() => ({ text: '{"changes":[]}', stopReason: 'end_turn', toolCalls: [] }));
    await runtime.wake();
    const db = openMemoryDatabase(databasePath, 'instance', false);
    const states = db.prepare('SELECT status FROM memory_sources ORDER BY id').all();
    db.close();
    expect(states).toEqual(
      expect.arrayContaining([{ status: 'omitted' }, { status: 'completed' }])
    );
    expect((await read(runtime)).memories).toEqual([]);
  });

  it.each(['max_output_tokens', 'tool_use', 'incomplete', 'failed'])(
    'does not accept terminal %s or retry it every wake',
    async (stopReason) => {
      const runtime = open((opts: any) => ({ ...proposals(opts), stopReason }));
      await runtime.wake();
      await runtime.wake();
      expect((await read(runtime)).memories).toEqual([]);
      const db = openMemoryDatabase(databasePath, 'instance', false);
      expect(db.prepare('SELECT outcome FROM memory_receipts').all()).toEqual([
        { outcome: 'failed' },
      ]);
      db.close();
    }
  );

  it('rejects a held response after the committed document changes', async () => {
    let release!: (result: any) => void;
    let request: any;
    const started = new Promise<void>((resolve) => {
      const runtime = open((opts: any) => {
        if (request) return { text: '{"changes":[]}', stopReason: 'end_turn', toolCalls: [] };
        request = opts;
        resolve();
        return new Promise((done) => {
          release = done;
        });
      });
      void runtime.wake();
    });
    await started;
    commit('Jesse prefers roomy rows.');
    release(proposals(request));
    await runtimes[0].wake();
    expect((await read(runtimes[0])).memories).toEqual([]);
  });

  it('excludes recall output as primary evidence', async () => {
    event(1, '', {
      type: 'tool_use',
      data: {
        name: 'recall',
        toolCallId: 'r',
        input: {},
        result: { outcome: 'completed', content: [{ type: 'text', text: 'invented echo' }] },
      },
    });
    const runtime = open((opts: any) => {
      const body = JSON.parse(opts.messages[0].content[0].text);
      expect(body.sources).toHaveLength(1);
      expect(body.sources[0].reference.kind).toBe('document');
      return { text: '{"changes":[]}', stopReason: 'end_turn', toolCalls: [] };
    });
    await runtime.wake();
  });
  it('reads full sidecars and native images as supplied originals', async () => {
    const { writeToolResultSidecar } = await import('../../storage/tool-result-store');
    const sidecar = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    writeToolResultSidecar(sessionId, 'tool_1', sidecar);
    event(1, '', {
      type: 'tool_use',
      data: {
        name: 'file_read',
        toolCallId: 'tool_1',
        input: {},
        result: {
          outcome: 'completed',
          content: [
            { type: 'text', text: '10 lines, 20 bytes elided of 30 total read_tool_result(' },
            { type: 'image', data: 'aGVsbG8=', mediaType: 'image/png' },
          ],
        },
      },
    });
    const runtime = open((opts: any) => {
      const blocks = opts.messages[0].content;
      const body = JSON.parse(blocks[0].text);
      expect(body.sources.some((source: any) => source.text.includes('line 299'))).toBe(true);
      expect(blocks).toContainEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
      });
      return proposals(opts);
    });
    await runtime.wake();
    expect((await read(runtime)).support).toHaveLength(2);
  });

  it('keeps missing sidecars unavailable rather than reporting success', async () => {
    event(1, '', {
      type: 'tool_use',
      data: {
        name: 'file_read',
        toolCallId: 'absent',
        input: {},
        result: {
          outcome: 'completed',
          content: [{ type: 'text', text: '10 bytes elided of 20 total read_tool_result(' }],
        },
      },
    });
    const runtime = open((opts: any) => {
      const body = JSON.parse(opts.messages[0].content[0].text);
      expect(
        body.withheld.some((source: any) => source.reason.includes('No spilled tool result'))
      ).toBe(true);
      return { text: '{"changes":[]}', stopReason: 'end_turn', toolCalls: [] };
    });
    await runtime.wake();
    const db = openMemoryDatabase(databasePath, 'instance', false);
    expect(db.prepare("SELECT status FROM memory_sources WHERE id LIKE 'event:%'").get()).toEqual({
      status: 'unavailable',
    });
    expect(db.prepare('SELECT outcome FROM memory_receipts').get()).toEqual({
      outcome: 'completed',
    });
    db.close();
  });

  it('accepts at most one bounded format repair and rejects invented support', async () => {
    let calls = 0;
    const runtime = open(() => ({
      text:
        ++calls === 1
          ? 'not JSON'
          : '{"changes":[{"text":"unsupported","sourceIds":["invented"]}]}',
      stopReason: 'end_turn',
      toolCalls: [],
    }));
    await runtime.wake();
    expect((await read(runtime, 'unsupported')).memories).toEqual([]);
    const db = openMemoryDatabase(databasePath, 'instance', false);
    expect(db.prepare('SELECT outcome FROM memory_receipts').get()).toEqual({ outcome: 'failed' });
    db.close();
  });

  it('reports superseded and removed document support without substituting current bytes', async () => {
    const runtime = open(proposals);
    await runtime.wake();
    const note = await read(runtime);
    commit('Different facts');
    expect((await runtime.reader(binding).read(note.id))?.support[0].status).toBe('superseded');
    git('rm', 'knowledge.md');
    git(
      '-c',
      'user.name=Memory Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'remove'
    );
    expect((await runtime.reader(binding).read(note.id))?.support[0].status).toBe('missing');
  });

  it('rejects a held response after grants are revoked, including later reads', async () => {
    let release!: (result: any) => void;
    let request: any;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = open((opts: any) => {
      request = opts;
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const work = runtime.wake();
    await waiting;
    const db = openMemoryDatabase(databasePath, 'instance', false);
    configureMemoryRoles(
      db,
      { ...binding, canMutate: false },
      { root: { ...grant, canMutate: false } }
    );
    release(proposals(request));
    await work;
    expect(db.prepare('SELECT count(*) AS count FROM memory_notes').get()).toEqual({ count: 0 });
    db.close();
    expect(() => runtime.reader(binding)).toThrow();
  });

  it('does not commit after a competing worker replaces its active attempt', async () => {
    let started!: () => void;
    let release!: (result: any) => void;
    let request: any;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = open((opts: any) => {
      request = opts;
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const work = first.wake();
    await waiting;
    const replacement = open(() => ({
      text: '{"changes":[]}',
      stopReason: 'end_turn',
      toolCalls: [],
    }));
    release(proposals(request));
    await work;
    expect((await read(replacement)).memories).toEqual([]);
    await replacement.wake();
    const db = openMemoryDatabase(databasePath, 'instance', false);
    expect(db.prepare('SELECT outcome FROM memory_receipts').all()).toEqual([
      { outcome: 'completed' },
    ]);
    db.close();
  });

  it('fences shutdown before abort and cannot accept a late provider result', async () => {
    let started!: () => void;
    let release!: (result: any) => void;
    let request: any;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = open((opts: any) => {
      request = opts;
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const work = runtime.wake();
    await waiting;
    const closing = runtime.close();
    expect(request.signal.aborted).toBe(true);
    release(proposals(request));
    await work;
    await closing;
    const db = openMemoryDatabase(databasePath, 'instance', false);
    expect(db.prepare('SELECT count(*) AS count FROM memory_notes').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT count(*) AS count FROM memory_receipts').get()).toEqual({ count: 0 });
    db.close();
  });

  it('bounds a batch to sixteen primaries and observes later child events on a maintenance wake', async () => {
    for (let seq = 1; seq <= 20; seq++) event(seq, `fresh fact ${seq}`);
    const runtime = open((opts: any) => {
      const body = JSON.parse(opts.messages[0].content[0].text);
      expect(body.sources.length).toBeLessThanOrEqual(16);
      return { text: '{"changes":[]}', stopReason: 'end_turn', toolCalls: [] };
    });
    await runtime.wake();
    const db = openMemoryDatabase(databasePath, 'instance', false);
    expect(
      db.prepare("SELECT count(*) AS count FROM memory_sources WHERE status='completed'").get()
    ).toEqual({ count: 21 });
    event(21, 'late child fact');
    await runtime.wake();
    expect(
      db.prepare("SELECT count(*) AS count FROM memory_sources WHERE status='completed'").get()
    ).toEqual({ count: 22 });
    db.close();
  });

  it('closes its database without waiting for a provider that ignores cancellation', async () => {
    let started!: () => void;
    let release!: (result: any) => void;
    let request: any;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = open((opts: any) => {
      request = opts;
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    void runtime.wake();
    await waiting;
    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const closedBeforeProviderReleased = closed;
    release(proposals(request));
    await closing;
    expect(closedBeforeProviderReleased).toBe(true);
  });

  it('offers an existing note with its old originals when reconciling a new document version', async () => {
    let first = true;
    const runtime = open((opts: any) => {
      if (first) {
        first = false;
        return proposals(opts);
      }
      const body = JSON.parse(opts.messages[0].content[0].text);
      expect(
        body.sources.some((source: any) => source.text.includes('Jesse likes compact rows.'))
      ).toBe(true);
      const newer = body.sources.find((source: any) =>
        source.text.includes('Jesse now prefers roomy rows.')
      );
      expect(newer).toBeDefined();
      expect(body.candidates).toHaveLength(1);
      return {
        text: JSON.stringify({
          changes: [
            {
              text: 'Jesse now prefers roomy rows.',
              sourceIds: [newer.id],
              target: { noteId: body.candidates[0].id, revision: 1 },
            },
          ],
        }),
        stopReason: 'end_turn',
        toolCalls: [],
      };
    });
    await runtime.wake();
    const original = await read(runtime);
    commit('Jesse now prefers roomy rows.');
    await runtime.wake();
    const revised = await runtime.reader(binding).read(original.id);
    expect(revised?.revision).toBe(2);
    expect(revised?.text).toBe('Jesse now prefers roomy rows.');
    expect(revised?.support).toHaveLength(1);
    expect(revised?.support[0].status).toBe('current');
  });
  it('does not overwrite a newer accepted note revision with a held proposal', async () => {
    let first = true;
    let started!: () => void;
    let release!: (result: any) => void;
    let request: any;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = open((opts: any) => {
      if (first) {
        first = false;
        return proposals(opts);
      }
      request = opts;
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    await runtime.wake();
    const original = await read(runtime);
    event(1, 'Another independently supplied fact');
    const work = runtime.wake();
    await waiting;
    const { MemoryNotes } = await import('../notes');
    const { sourceHandle } = await import('../types');
    const db = openMemoryDatabase(databasePath, 'instance', false);
    const notes = new MemoryNotes(db, false);
    const head = notes.note(original.id)!;
    const competing = notes.offer(head.sources, [head], 'controlled competing acceptance', []);
    const attempt = (db.prepare('SELECT attempt FROM memory_worker').get() as { attempt: string })
      .attempt;
    notes.accept(
      binding,
      attempt,
      competing,
      head.sources,
      [head],
      {
        changes: [
          {
            text: 'A newer accepted compact preference.',
            sourceIds: head.sources.map(sourceHandle),
            target: { noteId: head.id, revision: 1 },
          },
        ],
      },
      () => {},
      []
    );
    const body = JSON.parse(request.messages[0].content[0].text);
    release({
      text: JSON.stringify({
        changes: [
          {
            text: 'Stale compact preference.',
            sourceIds: [body.sources[0].id],
            target: { noteId: head.id, revision: 1 },
          },
        ],
      }),
      stopReason: 'end_turn',
      toolCalls: [],
    });
    await work;
    db.close();
    expect(await runtime.reader(binding).read(head.id)).toMatchObject({
      revision: 2,
      text: 'A newer accepted compact preference.',
    });
  });

  it('coalesces maintenance ticks during held inference and discovers a later child append', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let started!: () => void;
    let release!: (result: any) => void;
    let requests = 0;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    try {
      const runtime = open((opts: any) => {
        if (++requests > 1) return proposals(opts);
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      });
      const work = runtime.wake();
      await waiting;
      await vi.advanceTimersByTimeAsync(90_000);
      expect(requests).toBe(1);
      event(1, 'Late child event');
      release({ text: '{"changes":[]}', stopReason: 'end_turn', toolCalls: [] });
      await work;
      expect((await read(runtime)).support[0].reference.kind).toBe('event');
      expect(requests).toBe(2);
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds note search from current heads while transcript-index replacement does not replay extraction', async () => {
    const runtime = open(proposals);
    await runtime.wake();
    const note = await read(runtime);
    await runtime.close();
    closeRecallIndex();
    const db = openMemoryDatabase(databasePath, 'instance', false);
    db.exec('DROP TABLE memory_fts');
    db.close();
    rmSync(join(dir, 'state/recall/index.sqlite'), { force: true });
    let replayed = false;
    const restarted = open(() => {
      replayed = true;
      throw new Error('unexpected extraction replay');
    });
    await restarted.wake();
    expect((await read(restarted)).id).toBe(note.id);
    expect(replayed).toBe(false);
  });

  it('records provider exceptions as failure and withholds unsupported images', async () => {
    event(1, '', {
      type: 'prompt',
      data: {
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
        ],
      },
    });
    const runtime = createMemoryRuntime(
      {
        databasePath,
        binding,
        extraction: { connectionId: 'fake', modelId: 'fake' },
        documentSources: { gitRoot: join(dir, 'git'), paths: ['knowledge.md'] },
      },
      {
        supportsImages: async () => false,
        query: async () => {
          throw new Error('controlled provider failure');
        },
      }
    );
    runtimes.push(runtime);
    await runtime.wake();
    await runtime.wake();
    const db = openMemoryDatabase(databasePath, 'instance', false);
    expect(
      db.prepare("SELECT status,reason FROM memory_sources WHERE id LIKE 'event:%'").get()
    ).toMatchObject({ status: 'omitted', reason: 'Unsupported image input for configured model' });
    expect(db.prepare('SELECT outcome,detail FROM memory_receipts').all()).toEqual([
      { outcome: 'failed', detail: 'controlled provider failure' },
    ]);
    db.close();
  });

  it('cannot write discovery metadata after its owner generation is replaced', async () => {
    let started!: () => void;
    let release!: (result: any) => void;
    let request: any;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = open((opts: any) => {
      request = opts;
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const work = runtime.wake();
    await waiting;
    claimMemoryOwner('instance', databasePath, 'root', { create: false });
    commit('A document committed under the next owner');
    release(proposals(request));
    await work;
    const db = openMemoryDatabase(databasePath, 'instance', false);
    expect(db.prepare('SELECT count(*) AS count FROM memory_sources').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT count(*) AS count FROM memory_receipts').get()).toEqual({ count: 0 });
    db.close();
  });
  it.each(['prompt', 'context_injected'] as const)(
    'offers schema-valid canonical text and image %s input together',
    async (type) => {
      const request = SessionPromptRequestSchema.parse({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/prompt',
        params: {
          content: [
            { type: 'text', text: 'Jesse selected the compact picture.' },
            { type: 'image', data: 'aGVsbG8=', mediaType: 'image/png' },
          ],
        },
      });
      const sessionDir = getSessionDir(sessionId);
      writeSessionMeta(sessionDir, {
        sessionId,
        workDir: dir,
        created: '2026-10-29T00:00:00Z',
        persona: 'root',
      });
      appendDurableEvent(
        sessionDir,
        { nextEventSeq: 1, nextStreamSeq: 1 },
        { type, data: { content: request.params.content } }
      );
      const runtime = open((opts: any) => {
        const blocks = opts.messages[0].content;
        const body = JSON.parse(blocks[0].text);
        expect(
          body.sources.some((source: any) =>
            source.text.includes('Jesse selected the compact picture.')
          )
        ).toBe(true);
        expect(blocks).toContainEqual({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
        });
        return proposals(opts);
      });
      await runtime.wake();
      expect((await read(runtime)).support).toHaveLength(2);
      const db = openMemoryDatabase(databasePath, 'instance', false);
      expect(db.prepare("SELECT status FROM memory_sources WHERE id LIKE 'event:%'").get()).toEqual(
        { status: 'completed' }
      );
      db.close();
    }
  );

  it.each(['content:compact', 'content:compact OR persona:root'])(
    'preserves transcript hits for configured qualified query %s',
    async (query) => {
      const sessionDir = getSessionDir(sessionId);
      writeSessionMeta(sessionDir, {
        sessionId,
        workDir: dir,
        created: '2026-10-29T00:00:00Z',
        persona: 'root',
      });
      appendDurableEvent(
        sessionDir,
        { nextEventSeq: 1, nextStreamSeq: 1 },
        { type: 'message', data: { content: 'A compact transcript marker.' } }
      );
      const runtime = open(proposals);
      await runtime.wake();
      const tool = new RecallTool();
      const signal = new AbortController().signal;
      const ordinary = JSON.parse(
        (await tool.execute({ action: 'search', query }, { signal })).content[0].text!
      );
      expect(ordinary.hits).toHaveLength(1);
      const configured = JSON.parse(
        (
          await tool.execute(
            { action: 'search', query },
            { signal, memory: runtime.reader(binding) }
          )
        ).content[0].text!
      );
      expect(configured.hits.map(({ current_accounts: _accounts, ...hit }: any) => hit)).toEqual(
        ordinary.hits
      );
      expect(configured.hits[0].current_accounts).toEqual([
        expect.objectContaining({ text: 'Jesse prefers compact rows.', revision: 1 }),
      ]);
      expect(configured).not.toHaveProperty('error');
      if (query === 'content:compact') expect(configured.memories).toHaveLength(1);
      else {
        expect(configured.memories).toEqual([]);
        expect(configured.memories_hint).toBeDefined();
      }
    }
  );

  it('rejects an oversize sidecar at the source boundary without a whole-file read', async () => {
    const { writeToolResultSidecar } = await import('../../storage/tool-result-store');
    writeToolResultSidecar(sessionId, 'oversize_memory', 'x'.repeat(64 * 1024 + 1));
    event(1, '', {
      type: 'tool_use',
      data: {
        name: 'file_read',
        toolCallId: 'oversize_memory',
        input: {},
        result: {
          outcome: 'completed',
          content: [{ type: 'text', text: '10 bytes elided of 20 total read_tool_result(' }],
        },
      },
    });
    const originalRead = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((path: any, ...args: any[]) => {
      if (String(path).includes('tool-results')) throw new Error('Unbounded memory sidecar read');
      return (originalRead as any)(path, ...args);
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    try {
      const runtime = open(() => ({
        text: '{"changes":[]}',
        stopReason: 'end_turn',
        toolCalls: [],
      }));
      await runtime.wake();
      const db = openMemoryDatabase(databasePath, 'instance', false);
      expect(
        db.prepare("SELECT status,reason FROM memory_sources WHERE id LIKE 'event:%'").get()
      ).toEqual({ status: 'unavailable', reason: 'Error: Oversize sidecar input' });
      db.close();
    } finally {
      vi.restoreAllMocks();
      syncBuiltinESMExports();
    }
  });
});
