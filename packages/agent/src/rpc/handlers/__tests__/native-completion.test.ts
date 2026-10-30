// ABOUTME: Native settlement must cover finalization and deferred inject admission.
// ABOUTME: Real session logs and RPC status expose the race boundaries deterministically.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { ConversationRunner } from '../../../core/conversation/runner';
import { appendDurableEvent, readDurableEvents } from '../../../storage/event-log';
import { readSessionState } from '../../../storage/session-store';
import { createFinalizeJob, createQueueJobNotification } from '../../../jobs/job-notifications';
import { closeRecallIndex } from '../../../storage/recall/index-db';
import type { JobState } from '../../../server-types';
import { scheduleImmediateInjectDrain } from '../../../completion';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('native completion', () => {
  let directory: string;
  let previous: string | undefined;
  let previousProvider: string | undefined;
  let client: JsonRpcPeer;
  let server: JsonRpcPeer;
  let state: ReturnType<typeof createAgentServerState>;
  let sessionId: string;
  const notifications: unknown[] = [];

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'lace-native-completion-'));
    previous = process.env.LACE_DIR;
    previousProvider = process.env.LACE_AGENT_TEST_PROVIDER;
    process.env.LACE_DIR = directory;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
    state = createAgentServerState();
    const inbound = new PassThrough();
    const outbound = new PassThrough();
    client = new JsonRpcPeer(
      createNdjsonStdioTransport({ readable: outbound, writable: inbound }),
      { idPrefix: 'c_' }
    );
    server = new JsonRpcPeer(
      createNdjsonStdioTransport({ readable: inbound, writable: outbound }),
      { idPrefix: 'a_' }
    );
    registerAgentRpcMethods(server, state);
    notifications.length = 0;
    client.onRequest('session/update', (update) => {
      notifications.push(update);
    });
    await client.request('initialize', defaultInitializeParams());
    ({ sessionId } = (await client.request('session/new', { cwd: directory, mcpServers: [] })) as {
      sessionId: string;
    });
  });

  afterEach(async () => {
    await state.sessionMutex;
    vi.useRealTimers();
    vi.restoreAllMocks();
    client.close();
    server.close();
    closeRecallIndex();
    if (previous === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = previous;
    if (previousProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = previousProvider;
    rmSync(directory, { recursive: true, force: true });
  });

  const status = async () =>
    (await client.request('ent/agent/status', {})) as {
      completion?: {
        sessionId: string;
        terminalTurnId?: string;
        observedStreamSeq: number;
        settled: boolean;
      };
    };
  const prompt = () =>
    client.request('session/prompt', { content: [{ type: 'text', text: 'work' }] });
  const write = (type: string, turnId: string, data: Record<string, unknown>) => {
    const dir = state.activeSession!.dir;
    return appendDurableEvent(dir, readSessionState(dir), { type, turnId, data }).written;
  };
  const finish = (turnId: string, inject = false) => {
    const end = write('turn_end', turnId, { stopReason: 'end_turn' });
    if (inject)
      write('context_injected', turnId, {
        priority: 'immediate',
        content: [{ type: 'text', text: 'collect result' }],
      });
    return {
      turnId,
      stopReason: 'end_turn' as const,
      content: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      lastSeenEventSeq: end.eventSeq,
    };
  };

  it('observes the active session without emitting wakes on status reads', async () => {
    expect((await status()).completion).toMatchObject({ sessionId, settled: false });
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId)
    );
    const terminal = (await prompt()) as { turnId: string };
    await state.sessionMutex;
    const before = notifications.length;
    const observation = (await status()).completion;
    expect(observation).toMatchObject({
      sessionId,
      terminalTurnId: terminal.turnId,
      settled: true,
    });
    const lastUpdate = notifications.at(-1) as { streamSeq: number };
    expect(observation?.observedStreamSeq).toBe(lastUpdate.streamSeq);
    expect((await status()).completion).toEqual(observation);
    expect(notifications).toHaveLength(before);
  });

  it('retains shared idle-wake ownership until a consumed inject drain is discarded', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId)
    );
    await prompt();
    await client.request('ent/session/inject', {
      content: [{ type: 'text', text: 'idle update' }],
      priority: 'immediate',
    });
    const terminal = (await prompt()) as { turnId: string };
    expect((await status()).completion?.settled).toBe(false);
    vi.runAllTimers();
    expect((await status()).completion).toMatchObject({
      terminalTurnId: terminal.turnId,
      settled: true,
    });
  });

  it('does not admit a shared idle wake into a replacement session', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const turns: string[] = [];
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) => {
      turns.push(turnId);
      return finish(turnId);
    });
    await prompt();
    await client.request('ent/session/inject', {
      content: [{ type: 'text', text: 'departing session update' }],
      priority: 'immediate',
    });
    const replacement = (await client.request('session/new', {
      cwd: directory,
      mcpServers: [],
    })) as { sessionId: string };
    vi.runAllTimers();
    await state.sessionMutex;
    expect((await status()).completion).toMatchObject({
      sessionId: replacement.sessionId,
      settled: false,
    });
    expect(turns).toHaveLength(1);
    expect(
      readDurableEvents(state.activeSession!.dir, {}).events.some(
        (event) => event.type === 'turn_start'
      )
    ).toBe(false);
  });

  it('does not certify visible job_finished while notification publication is paused', async () => {
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId)
    );
    const response = (await prompt()) as { turnId: string };
    const visible = deferred();
    const release = deferred();
    state.jobManager.subscribe({ jobId: 'suppressed', on: ['failed'] });
    const queue = createQueueJobNotification(state, { current: null });
    const finalize = createFinalizeJob(
      state,
      async (work) => work(),
      async () => {
        visible.resolve();
        await release.promise;
      },
      queue
    );
    const job = {
      jobId: 'suppressed',
      type: 'delegate',
      status: 'completed',
      startedAt: new Date().toISOString(),
      outputPath: join(directory, 'absent'),
      finished: false,
      resolveCompletion: () => {},
    } as JobState;
    const work = finalize(job);
    await visible.promise;
    expect(
      readDurableEvents(state.activeSession!.dir, {}).events.some(
        (event) => event.type === 'job_finished'
      )
    ).toBe(true);
    expect((await status()).completion).toMatchObject({
      sessionId,
      terminalTurnId: response.turnId,
      settled: false,
    });
    release.resolve();
    await work;
    expect((await status()).completion).toMatchObject({
      sessionId,
      terminalTurnId: response.turnId,
      settled: true,
    });
  });

  it('retains prompt ownership after the runner clears the active turn', async () => {
    const visible = deferred();
    const release = deferred();
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) => {
      const result = finish(turnId);
      state.activeTurn = null;
      visible.resolve();
      await release.promise;
      return result;
    });
    const work = prompt();
    await visible.promise;
    try {
      expect(state.activeTurn).toBeNull();
      expect((await status()).completion?.settled).toBe(false);
    } finally {
      release.resolve();
      await work;
    }
    expect((await status()).completion?.settled).toBe(true);
  });

  it('holds queued inject ownership through followup admission and settlement', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const admitted = deferred();
    const release = deferred();
    let turns = 0;
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) => {
      if (++turns === 1) return finish(turnId, true);
      admitted.resolve();
      await release.promise;
      return finish(turnId);
    });
    const root = (await prompt()) as { turnId: string };
    expect((await status()).completion).toMatchObject({
      terminalTurnId: root.turnId,
      settled: false,
    });
    vi.runAllTimers();
    await admitted.promise;
    expect((await status()).completion?.settled).toBe(false);
    release.resolve();
    const idle = deferred();
    client.onRequest('session/update', async (update) => {
      notifications.push(update);
      if (
        (update as { type: string }).type === 'completion_status' &&
        (await status()).completion?.settled
      )
        idle.resolve();
    });
    await idle.promise;
    expect((await status()).completion).toMatchObject({ sessionId, settled: true });
    expect((await status()).completion?.terminalTurnId).not.toBe(root.turnId);
  });

  it('wakes the observer when a queued drain is discarded after another turn consumed it', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    let turns = 0;
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId, ++turns === 1)
    );
    await prompt();
    const last = (await prompt()) as { turnId: string };
    expect((await status()).completion?.settled).toBe(false);
    const before = notifications.length;
    vi.runAllTimers();
    await Promise.resolve();
    expect((await status()).completion).toMatchObject({
      terminalTurnId: last.turnId,
      settled: true,
    });
    expect(notifications.slice(before)).toContainEqual(
      expect.objectContaining({ type: 'completion_status', sessionId })
    );
    expect(turns).toBe(2);
  });
  it('discards the captured session drain without admitting it into a different session', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    let turns = 0;
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId, ++turns === 1)
    );
    await prompt();
    const replacement = (await client.request('session/new', {
      cwd: directory,
      mcpServers: [],
    })) as { sessionId: string };
    vi.runAllTimers();
    await state.sessionMutex;
    expect(turns).toBe(1);
    expect((await status()).completion).toMatchObject({
      sessionId: replacement.sessionId,
      settled: false,
    });
    expect((await status()).completion?.terminalTurnId).toBeUndefined();
  });

  it('reports unfinished jobs and unread immediate injects even without reservations', async () => {
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId)
    );
    const response = (await prompt()) as { turnId: string };
    state.jobManager.addJob({
      jobId: 'running',
      type: 'delegate',
      status: 'running',
      finished: false,
      outputPath: join(directory, 'absent'),
    } as JobState);
    expect((await status()).completion?.settled).toBe(false);
    state.jobManager.removeJob('running');
    expect((await status()).completion?.settled).toBe(true);
    write('context_injected', response.turnId, {
      priority: 'immediate',
      content: [{ type: 'text', text: 'unread' }],
    });
    expect((await status()).completion?.settled).toBe(false);
  });

  it('does not treat a failed followup start watermark as consumption of a late inject', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    let turns = 0;
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) => {
      if (++turns === 1) {
        const consumed = readDurableEvents(state.activeSession!.dir, {}).events.at(-1)!.eventSeq;
        write('context_injected', turnId, {
          priority: 'immediate',
          content: [{ type: 'text', text: 'late result' }],
        });
        return { ...finish(turnId), lastSeenEventSeq: consumed };
      }
      throw new Error('followup failed before reading injects');
    });
    const root = (await prompt()) as { turnId: string };
    expect((await status()).completion?.settled).toBe(false);
    const finalized = deferred();
    let wakes = 0;
    client.onRequest('session/update', (update) => {
      notifications.push(update);
      if ((update as { type: string }).type === 'completion_status' && ++wakes === 2)
        finalized.resolve();
    });
    vi.runAllTimers();
    await finalized.promise;
    const completion = (await status()).completion;
    expect(completion?.terminalTurnId).not.toBe(root.turnId);
    expect(completion?.settled).toBe(false);
    expect(turns).toBe(2);
  });
  it('suppresses a paused finalizer notification when its session has been replaced', async () => {
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId)
    );
    await prompt();
    const visible = deferred();
    const release = deferred();
    const finalize = createFinalizeJob(
      state,
      async (work) => work(),
      async () => {
        visible.resolve();
        await release.promise;
      },
      createQueueJobNotification(state, { current: null })
    );
    const work = finalize({
      jobId: 'departed',
      type: 'delegate',
      status: 'completed',
      startedAt: new Date().toISOString(),
      outputPath: join(directory, 'absent'),
      finished: false,
      resolveCompletion: () => {},
    } as JobState);
    await visible.promise;
    await client.request('session/new', { cwd: directory, mcpServers: [] });
    release.resolve();
    await work;
    expect(
      readDurableEvents(state.activeSession!.dir, {}).events.filter(
        (event) => event.type === 'context_injected'
      )
    ).toEqual([]);
  });
  it('does not certify failed notification delivery as definitive suppression', async () => {
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId)
    );
    await prompt();
    const finalize = createFinalizeJob(
      state,
      async (work) => work(),
      async () => {},
      () => {
        throw new Error('notification write failed');
      }
    );
    await expect(
      finalize({
        jobId: 'undelivered',
        type: 'delegate',
        status: 'completed',
        startedAt: new Date().toISOString(),
        outputPath: join(directory, 'absent'),
        finished: false,
        resolveCompletion: () => {},
      } as JobState)
    ).rejects.toThrow('notification write failed');
    expect((await status()).completion?.settled).toBe(false);
  });

  it('rejects another session producer before advancing consumption or scheduling its drain', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const producerSession = sessionId;
    await client.request('session/new', { cwd: directory, mcpServers: [] });
    vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async ({ turnId }) =>
      finish(turnId)
    );
    const terminal = (await prompt()) as { turnId: string };
    write('context_injected', terminal.turnId, {
      priority: 'immediate',
      content: [{ type: 'text', text: 'replacement session unread result' }],
    });
    scheduleImmediateInjectDrain(state, { current: null }, producerSession, 500, 500);
    expect((await status()).completion).toMatchObject({
      terminalTurnId: terminal.turnId,
      settled: false,
    });
    vi.runAllTimers();
    expect((await status()).completion?.terminalTurnId).toBe(terminal.turnId);
  });
});
