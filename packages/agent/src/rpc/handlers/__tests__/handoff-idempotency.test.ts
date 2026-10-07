import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import { appendDurableEvent, readDurableEvents } from '@lace/agent/storage/event-log';
import { classifyPromptHandoff } from '@lace/agent/rpc/handlers/handoff-idempotency';
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

  it('preserves active and unfinished prompt classifications when an injection shares its key', () => {
    const content = [{ type: 'text', text: 'original request' }];
    const events = [
      {
        eventSeq: 1,
        timestamp: '2026-10-06T00:00:00.000Z',
        type: 'context_injected',
        data: { idempotencyKey: 'request-1', content },
      },
      {
        eventSeq: 2,
        timestamp: '2026-10-06T00:00:00.000Z',
        type: 'prompt',
        turnId: 'turn-1',
        data: { idempotencyKey: 'request-1', content },
      },
    ];
    expect(classifyPromptHandoff(events, 'request-1', content, 'turn-1')).toBe(
      'duplicate-in-progress'
    );
    expect(classifyPromptHandoff(events, 'request-1', content)).toBe('duplicate-unsafe-retry');
    expect(classifyPromptHandoff(events, 'unrelated-key', content)).toBe('persisted-new');
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

  it.each([false, true])(
    'does not persist a prompt for an injection key after consumption=%s',
    async (consumed) => {
      const state = createAgentServerState();
      const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      try {
        await client.request('initialize', defaultInitializeParams());
        const session = (await client.request('session/new', {
          cwd: workDir,
          mcpServers: [],
        })) as { sessionId: string };
        const handoff = {
          content: [{ type: 'text', text: 'Please acknowledge this request once.' }],
          idempotencyKey: 'input-1',
        };
        expect(
          await client.request('ent/session/inject', { ...handoff, priority: 'normal' })
        ).toEqual({ durableHandoffStatus: 'persisted-new' });
        if (consumed) {
          await client.request('session/prompt', {
            content: [{ type: 'text', text: 'Consume the pending request.' }],
          });
        }

        expect(await client.request('session/prompt', handoff)).toEqual({
          durableHandoffStatus: 'duplicate-already-handled',
        });
        const unrelated = (await client.request('session/prompt', {
          ...handoff,
          idempotencyKey: 'input-2',
        })) as { durableHandoffStatus: string };
        expect(unrelated.durableHandoffStatus).toBe('persisted-new');
        const { events } = readDurableEvents(getSessionDir(session.sessionId), {
          afterEventSeq: 0,
          limit: 100,
        });
        expect(
          events
            .filter((event) => event.data?.idempotencyKey === handoff.idempotencyKey)
            .map((event) => event.type)
        ).toEqual(['context_injected']);
      } finally {
        client.close();
        server.close();
      }
    }
  );

  it('fails closed when a prompt reuses an injection key with different content', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const session = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };
      const idempotencyKey = 'input-1';
      await client.request('ent/session/inject', {
        content: [{ type: 'text', text: 'original request' }],
        priority: 'normal',
        idempotencyKey,
      });

      await expect(
        client.request('session/prompt', {
          content: [{ type: 'text', text: 'changed request' }],
          idempotencyKey,
        })
      ).rejects.toMatchObject({
        data: { durableHandoffStatus: 'duplicate-unsafe-retry' },
      });
      const { events } = readDurableEvents(getSessionDir(session.sessionId), {
        afterEventSeq: 0,
        limit: 100,
      });
      expect(events.filter((event) => event.type === 'prompt')).toHaveLength(0);
    } finally {
      client.close();
      server.close();
    }
  });

  it('rejects injection-to-prompt recovery when durable event evidence is corrupt', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const session = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };
      const handoff = {
        content: [{ type: 'text', text: 'original request' }],
        idempotencyKey: 'input-1',
      };
      await client.request('ent/session/inject', { ...handoff, priority: 'normal' });
      const sessionDir = getSessionDir(session.sessionId);
      appendFileSync(join(sessionDir, 'events.jsonl'), '{broken event\n');

      await expect(client.request('session/prompt', handoff)).rejects.toMatchObject({
        data: { durableHandoffStatus: 'duplicate-unsafe-retry' },
      });
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      expect(events.filter((event) => event.type === 'prompt')).toHaveLength(0);
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
  it.each(['end_turn', 'process_died'])(
    'retains ordinary injection deduplication after stopReason=%s',
    async (stopReason) => {
      const state = createAgentServerState();
      const runSpy = vi
        .spyOn(ConversationRunner.prototype, 'run')
        .mockRejectedValue(new Error('controlled execution failure'));
      const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
      try {
        await client.request('initialize', defaultInitializeParams());
        const session = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
          sessionId: string;
        };
        const dir = getSessionDir(session.sessionId);
        const handoff = {
          content: [{ type: 'text', text: 'saved request' }],
          idempotencyKey: 'interrupted-request',
          track: 'track-1',
        };
        let sessionState = readSessionState(dir);
        for (const event of [
          { type: 'turn_start', turnId: 'interrupted-turn', data: {} },
          { type: 'context_injected', data: { ...handoff, priority: 'immediate' } },
          { type: 'turn_end', turnId: 'interrupted-turn', data: { stopReason } },
        ])
          sessionState = appendDurableEvent(dir, sessionState, event).nextState;
        writeSessionState(dir, sessionState);
        if (stopReason === 'end_turn') {
          expect(await client.request('session/prompt', handoff)).toEqual({
            durableHandoffStatus: 'duplicate-already-handled',
          });
          expect(runSpy).not.toHaveBeenCalled();
        } else {
          await expect(client.request('session/prompt', handoff)).rejects.toMatchObject({
            message: 'controlled execution failure',
          });
          expect(runSpy).toHaveBeenCalledTimes(1);
          try {
            await client.request('session/prompt', handoff);
          } catch (error) {
            expect(
              (error as { data?: Record<string, unknown> }).data?.durableHandoffStatus
            ).toBeUndefined();
          }
          expect(runSpy).toHaveBeenCalledTimes(2);
          const source = readDurableEvents(dir, { afterEventSeq: 0, limit: 100 }).events.filter(
            (e) => e.data.idempotencyKey === handoff.idempotencyKey
          );
          expect(source.map((e) => e.type)).toEqual(['context_injected']);
        }
      } finally {
        client.close();
        server.close();
      }
    }
  );
});
