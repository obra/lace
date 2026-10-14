import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import {
  appendDurableEvent,
  readDurableEvents,
  type DurableEvent,
} from '@lace/agent/storage/event-log';
import { PROCESS_DIED_STOP_REASON } from '@lace/agent/storage/event-types';
import { classifyPromptHandoff } from '../handoff-idempotency';
import {
  getSessionDir,
  readSessionState,
  writeSessionState,
} from '@lace/agent/storage/session-store';

function createPairedPeers(register: (peer: JsonRpcPeer) => void) {
  const aToB = new PassThrough();
  const bToA = new PassThrough();

  const clientTransport = createNdjsonStdioTransport({ readable: bToA, writable: aToB });
  const serverTransport = createNdjsonStdioTransport({ readable: aToB, writable: bToA });

  const client = new JsonRpcPeer(clientTransport, { idPrefix: 'c_' });
  const server = new JsonRpcPeer(serverTransport, { idPrefix: 'a_' });
  register(server);

  return { client, server };
}

describe('opaque durable handoff idempotency', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-handoff-idempotency-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-handoff-idempotency-wd-'));
    process.env.LACE_DIR = tempDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('advertises prompt idempotency support during initialize', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      const result = (await client.request('initialize', defaultInitializeParams())) as {
        capabilities: Record<string, unknown>;
      };

      expect(result.capabilities['ent/promptIdempotency']).toBe(true);
    } finally {
      client.close();
      server.close();
    }
  });

  it('returns duplicate-already-handled for a repeated prompt idempotencyKey', async () => {
    const state = createAgentServerState();
    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async function (
      this: ConversationRunner,
      opts: { turnId: string }
    ) {
      if (!state.activeSession) throw new Error('test setup: no active session');
      const sessionDir = state.activeSession.dir;
      let sessionState = readSessionState(sessionDir);
      let appended = appendDurableEvent(sessionDir, sessionState, {
        type: 'message',
        turnId: opts.turnId,
        turnSeq: 1,
        data: { type: 'message', content: [{ type: 'text', text: 'done' }] },
      });
      sessionState = appended.nextState;
      appended = appendDurableEvent(sessionDir, sessionState, {
        type: 'turn_end',
        turnId: opts.turnId,
        turnSeq: 2,
        data: { type: 'turn_end', stopReason: 'end_turn' },
      });
      sessionState = appended.nextState;
      writeSessionState(sessionDir, sessionState);

      return {
        turnId: opts.turnId,
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      const prompt = {
        content: [{ type: 'text', text: 'hello' }],
        idempotencyKey: 'slack:C123:1748000000.000001',
      };
      const first = (await client.request('session/prompt', prompt)) as {
        durableHandoffStatus?: string;
      };
      const second = await client.request('session/prompt', prompt);

      expect(first.durableHandoffStatus).toBe('persisted-new');
      expect(second).toEqual({ durableHandoffStatus: 'duplicate-already-handled' });
      expect(runSpy).toHaveBeenCalledTimes(1);

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      const prompts = events.filter((event) => event.type === 'prompt');
      expect(prompts).toHaveLength(1);
      expect(prompts[0]?.data).toMatchObject({ idempotencyKey: prompt.idempotencyKey });
    } finally {
      client.close();
      server.close();
    }
  });

  it('runs a turn for a prompt redelivered after the process died mid-turn', async () => {
    const prompt = {
      content: [{ type: 'text', text: 'hello' }],
      idempotencyKey: 'slack:C123:1748000000.000008',
    };
    const deadTurnId = 'turn_dead';
    const providerRequestLog = join(tempDir, 'provider-requests.jsonl');
    const originalRecordRequests = process.env.LACE_TEST_PROVIDER_RECORD_REQUESTS;
    process.env.LACE_TEST_PROVIDER_RECORD_REQUESTS = providerRequestLog;
    const providerCallCount = () =>
      existsSync(providerRequestLog)
        ? readFileSync(providerRequestLog, 'utf8').split('\n').filter(Boolean).length
        : 0;

    // The process that died: it durably wrote the prompt and turn_start, then
    // was killed before any turn_end.
    const deadState = createAgentServerState();
    const dead = createPairedPeers((peer) => registerAgentRpcMethods(peer, deadState));
    let sessionId: string;
    try {
      await dead.client.request('initialize', defaultInitializeParams());
      ({ sessionId } = (await dead.client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string });
    } finally {
      dead.client.close();
      dead.server.close();
    }
    const sessionDir = getSessionDir(sessionId);
    let sessionState = readSessionState(sessionDir);
    let appended = appendDurableEvent(sessionDir, sessionState, {
      type: 'prompt',
      turnId: deadTurnId,
      turnSeq: 0,
      data: prompt,
    });
    sessionState = appended.nextState;
    appended = appendDurableEvent(sessionDir, sessionState, {
      type: 'turn_start',
      turnId: deadTurnId,
      turnSeq: 1,
      data: {},
    });
    writeSessionState(sessionDir, appended.nextState);

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const readEvents = () => readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 }).events;

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/load', { sessionId, cwd: workDir, mcpServers: [] });

      expect(
        readEvents().filter((event) => event.type === 'turn_end' && event.turnId === deadTurnId)
      ).toMatchObject([{ data: { stopReason: PROCESS_DIED_STOP_REASON } }]);
      expect(providerCallCount()).toBe(0);

      const redelivered = (await client.request('session/prompt', prompt)) as {
        turnId?: string;
        stopReason?: string;
        durableHandoffStatus?: string;
      };

      expect(redelivered.durableHandoffStatus).toBe('persisted-new');
      expect(redelivered.stopReason).toBe('end_turn');
      expect(redelivered.turnId).toBeDefined();
      expect(redelivered.turnId).not.toBe(deadTurnId);
      expect(providerCallCount()).toBe(1);

      const resumedTurnTypes = readEvents()
        .filter((event) => event.turnId === redelivered.turnId)
        .map((event) => event.type);
      expect(resumedTurnTypes).toEqual(expect.arrayContaining(['prompt', 'turn_start', 'message']));
      expect(resumedTurnTypes.at(-1)).toBe('turn_end');

      const third = await client.request('session/prompt', prompt);

      expect(third).toEqual({ durableHandoffStatus: 'duplicate-already-handled' });
      expect(providerCallCount()).toBe(1);
      const finalEvents = readEvents();
      expect(finalEvents.filter((event) => event.type === 'turn_start')).toHaveLength(2);
      expect(
        finalEvents.filter(
          (event) => event.type === 'prompt' && event.data.idempotencyKey === prompt.idempotencyKey
        )
      ).toHaveLength(2);
    } finally {
      client.close();
      server.close();
      if (originalRecordRequests === undefined) {
        delete process.env.LACE_TEST_PROVIDER_RECORD_REQUESTS;
      } else {
        process.env.LACE_TEST_PROVIDER_RECORD_REQUESTS = originalRecordRequests;
      }
    }
  });

  it('rejects prompt source metadata at runtime', async () => {
    const state = createAgentServerState();
    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run');
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      });

      await expect(
        client.request('session/prompt', {
          content: [{ type: 'text', text: 'hello' }],
          idempotencyKey: 'slack:C123:1748000000.000003',
          source: { kind: 'slack' },
        })
      ).rejects.toBeDefined();
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      client.close();
      server.close();
    }
  });

  it('fails closed when a repeated prompt idempotencyKey has different content', async () => {
    const state = createAgentServerState();
    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async function (
      this: ConversationRunner,
      opts: { turnId: string }
    ) {
      if (!state.activeSession) throw new Error('test setup: no active session');
      const sessionDir = state.activeSession.dir;
      let sessionState = readSessionState(sessionDir);
      let appended = appendDurableEvent(sessionDir, sessionState, {
        type: 'message',
        turnId: opts.turnId,
        turnSeq: 1,
        data: { type: 'message', content: [{ type: 'text', text: 'done' }] },
      });
      sessionState = appended.nextState;
      appended = appendDurableEvent(sessionDir, sessionState, {
        type: 'turn_end',
        turnId: opts.turnId,
        turnSeq: 2,
        data: { type: 'turn_end', stopReason: 'end_turn' },
      });
      writeSessionState(sessionDir, appended.nextState);

      return {
        turnId: opts.turnId,
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      const idempotencyKey = 'slack:C123:1748000000.000004';
      await client.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
        idempotencyKey,
      });

      await expect(
        client.request('session/prompt', {
          content: [{ type: 'text', text: 'changed' }],
          idempotencyKey,
        })
      ).rejects.toMatchObject({
        data: { durableHandoffStatus: 'duplicate-unsafe-retry' },
      });
      expect(runSpy).toHaveBeenCalledTimes(1);

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      expect(events.filter((event) => event.type === 'prompt')).toHaveLength(1);
    } finally {
      client.close();
      server.close();
    }
  });

  it('does not persist a prompt handoff before validating prompt params', async () => {
    const state = createAgentServerState();
    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run');
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      await expect(
        client.request('session/prompt', {
          content: [{ type: 'text', text: 'hello' }],
          idempotencyKey: 'slack:C123:1748000000.000005',
          outputFormat: { type: 'not-json-schema' },
        })
      ).rejects.toBeDefined();
      expect(runSpy).not.toHaveBeenCalled();

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      expect(events.filter((event) => event.type === 'prompt')).toHaveLength(0);
    } finally {
      client.close();
      server.close();
    }
  });

  it('returns duplicate-already-handled for a repeated inject idempotencyKey', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      const inject = {
        content: [{ type: 'text', text: 'background context' }],
        priority: 'normal',
        idempotencyKey: 'slack:C123:1748000000.000002',
      };
      const first = await client.request('ent/session/inject', inject);
      const second = await client.request('ent/session/inject', inject);

      expect(first).toEqual({ durableHandoffStatus: 'persisted-new' });
      expect(second).toEqual({ durableHandoffStatus: 'duplicate-already-handled' });

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      const injects = events.filter((event) => event.type === 'context_injected');
      expect(injects).toHaveLength(1);
      expect(injects[0]?.data).toMatchObject({ idempotencyKey: inject.idempotencyKey });
    } finally {
      client.close();
      server.close();
    }
  });

  it('rejects inject source metadata at runtime', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      await expect(
        client.request('ent/session/inject', {
          content: [{ type: 'text', text: 'background context' }],
          priority: 'normal',
          idempotencyKey: 'slack:C123:1748000000.000006',
          source: { kind: 'slack' },
        })
      ).rejects.toBeDefined();

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      expect(events.filter((event) => event.type === 'context_injected')).toHaveLength(0);
    } finally {
      client.close();
      server.close();
    }
  });

  it('fails closed when a repeated inject idempotencyKey has different content', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      const idempotencyKey = 'slack:C123:1748000000.000007';
      await client.request('ent/session/inject', {
        content: [{ type: 'text', text: 'background context' }],
        priority: 'normal',
        idempotencyKey,
      });

      await expect(
        client.request('ent/session/inject', {
          content: [{ type: 'text', text: 'changed context' }],
          priority: 'normal',
          idempotencyKey,
        })
      ).rejects.toMatchObject({
        data: { durableHandoffStatus: 'duplicate-unsafe-retry' },
      });

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      expect(events.filter((event) => event.type === 'context_injected')).toHaveLength(1);
    } finally {
      client.close();
      server.close();
    }
  });
});

describe('classifyPromptHandoff', () => {
  const KEY = 'slack:C123:1748000000.000010';
  const CONTENT = [{ type: 'text', text: 'hello' }];

  // Builds one turn's events with consecutive eventSeqs starting at firstSeq.
  function turnEvents(
    firstSeq: number,
    turnId: string,
    types: Array<'prompt' | 'turn_start' | 'tool_use' | 'message' | 'turn_end'>,
    stopReason = 'end_turn'
  ): DurableEvent[] {
    return types.map((type, index) => ({
      eventSeq: firstSeq + index,
      timestamp: '2026-05-24T00:00:00.000Z',
      turnId,
      turnSeq: index,
      type,
      data:
        type === 'prompt'
          ? { content: CONTENT, idempotencyKey: KEY }
          : type === 'turn_end'
            ? { stopReason }
            : {},
    }));
  }

  it('runs a turn for a retried prompt whose only turn ended because the process died', () => {
    const events = turnEvents(
      1,
      'turn_a',
      ['prompt', 'turn_start', 'turn_end'],
      PROCESS_DIED_STOP_REASON
    );

    expect(classifyPromptHandoff(events, KEY, CONTENT)).toBe('persisted-new');
  });

  it('runs a turn for a retried prompt whose turn died after tool calls and messages', () => {
    const events = turnEvents(
      1,
      'turn_a',
      ['prompt', 'turn_start', 'tool_use', 'message', 'turn_end'],
      PROCESS_DIED_STOP_REASON
    );

    expect(classifyPromptHandoff(events, KEY, CONTENT)).toBe('persisted-new');
  });

  it('does not resume a second time when the resumed turn also died', () => {
    const events = [
      ...turnEvents(1, 'turn_a', ['prompt', 'turn_start', 'turn_end'], PROCESS_DIED_STOP_REASON),
      ...turnEvents(4, 'turn_b', ['prompt', 'turn_start', 'turn_end'], PROCESS_DIED_STOP_REASON),
    ];

    expect(classifyPromptHandoff(events, KEY, CONTENT)).toBe('duplicate-already-handled');
  });

  it('reports the resumed turn as in progress while it is still running', () => {
    const events = [
      ...turnEvents(1, 'turn_a', ['prompt', 'turn_start', 'turn_end'], PROCESS_DIED_STOP_REASON),
      ...turnEvents(4, 'turn_b', ['prompt', 'turn_start']),
    ];

    expect(classifyPromptHandoff(events, KEY, CONTENT, 'turn_b')).toBe('duplicate-in-progress');
  });

  it('reports a resumed turn that ended normally as already handled', () => {
    const events = [
      ...turnEvents(1, 'turn_a', ['prompt', 'turn_start', 'turn_end'], PROCESS_DIED_STOP_REASON),
      ...turnEvents(4, 'turn_b', ['prompt', 'turn_start', 'message', 'turn_end']),
    ];

    expect(classifyPromptHandoff(events, KEY, CONTENT)).toBe('duplicate-already-handled');
  });

  it('keeps a prompt whose turn ended normally as already handled', () => {
    const events = turnEvents(1, 'turn_a', ['prompt', 'turn_start', 'message', 'turn_end']);

    expect(classifyPromptHandoff(events, KEY, CONTENT)).toBe('duplicate-already-handled');
  });

  it.each(['cancelled', 'error', 'prompt_handler_caught'])(
    'keeps a prompt whose turn ended with %s as already handled',
    (stopReason) => {
      const events = turnEvents(1, 'turn_a', ['prompt', 'turn_start', 'turn_end'], stopReason);

      expect(classifyPromptHandoff(events, KEY, CONTENT)).toBe('duplicate-already-handled');
    }
  );

  it('fails closed on changed content even when the earlier turn died with the process', () => {
    const events = turnEvents(
      1,
      'turn_a',
      ['prompt', 'turn_start', 'turn_end'],
      PROCESS_DIED_STOP_REASON
    );

    expect(classifyPromptHandoff(events, KEY, [{ type: 'text', text: 'changed' }])).toBe(
      'duplicate-unsafe-retry'
    );
  });
});
