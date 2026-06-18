// ABOUTME: Tests for the prompt.ts fallback turn_end catch handler.
// ABOUTME: Verifies the defense-in-depth path that synthesizes a turn_end when
// ABOUTME: the conversation runner throws, and that storage-layer dedup keeps
// ABOUTME: us to one turn_end per turnId even when runner+fallback both write.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import { appendDurableEvent, readDurableEvents } from '@lace/agent/storage/event-log';
import {
  getSessionDir,
  readSessionState,
  writeSessionState,
} from '@lace/agent/storage/session-store';
import { PROMPT_HANDLER_CAUGHT_STOP_REASON } from '@lace/agent/storage/event-types';
import { logger } from '@lace/agent/utils/logger';

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

describe('prompt.ts fallback turn_end', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-prompt-fallback-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-prompt-fallback-wd-'));
    process.env.LACE_DIR = tempDir;
    // Use the test provider so createProviderForTurn doesn't need real API keys.
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

  it('writes fallback turn_end when runner.run throws without writing one itself', async () => {
    // Force the runner to throw immediately, simulating an error before its
    // own turn_end-write path can fire (e.g. provider construction failure,
    // or a future bug in the runner's turn_end classifier).
    const runSpy = vi
      .spyOn(ConversationRunner.prototype, 'run')
      .mockRejectedValue(new Error('synthetic runner failure'));

    const state = createAgentServerState();
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
        })
      ).rejects.toBeDefined();

      // The handler must have synthesized a turn_end so the durable log
      // satisfies the "every turn_start has a matching turn_end" invariant.
      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      const turnStarts = events.filter((e) => e.type === 'turn_start');
      const turnEnds = events.filter((e) => e.type === 'turn_end');

      expect(turnStarts).toHaveLength(1);
      expect(turnEnds).toHaveLength(1);
      expect(turnEnds[0]?.turnId).toBe(turnStarts[0]?.turnId);
      expect(turnEnds[0]?.data).toMatchObject({
        stopReason: PROMPT_HANDLER_CAUGHT_STOP_REASON,
      });

      expect(runSpy).toHaveBeenCalledTimes(1);
    } finally {
      client.close();
      server.close();
    }
  });

  it('logs the caught turn error so a swallowed failure is observable', async () => {
    // A turn that throws is otherwise invisible: the fallback turn_end records
    // only a generic stop reason, and an idempotency-keyed prompt re-raises
    // tagged 'persisted-new', which the caller (sen-core) reports as delivered.
    // Without an explicit log the failure repeats silently on every message.
    const runSpy = vi
      .spyOn(ConversationRunner.prototype, 'run')
      .mockRejectedValue(new Error('synthetic runner failure ZQX'));
    const errorSpy = vi.spyOn(logger, 'error');

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      await expect(
        client.request('session/prompt', { content: [{ type: 'text', text: 'hello' }] })
      ).rejects.toBeDefined();

      const turnFailureLog = errorSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('turn failed')
      );
      expect(turnFailureLog).toBeDefined();
      expect(JSON.stringify(turnFailureLog?.[1])).toContain('synthetic runner failure ZQX');

      expect(runSpy).toHaveBeenCalledTimes(1);
    } finally {
      client.close();
      server.close();
    }
  });

  it('does NOT overwrite an earlier runner turn_end when the runner threw after writing one', async () => {
    // Simulate the realistic post-fix path: runner writes its own
    // turn_end (with a precise stopReason) and THEN throws. The fallback
    // must hit the storage dedup and leave the runner's turn_end intact.
    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async function (
      this: ConversationRunner,
      opts: { turnId: string }
    ) {
      if (!state.activeSession) throw new Error('test setup: no active session');
      const sessionDir = state.activeSession.dir;
      const sessionState = readSessionState(sessionDir);
      const { nextState } = appendDurableEvent(sessionDir, sessionState, {
        type: 'turn_end',
        turnId: opts.turnId,
        turnSeq: 99,
        data: { type: 'turn_end', stopReason: 'provider_error_simulated' },
      });
      writeSessionState(sessionDir, nextState);
      throw new Error('synthetic runner failure after turn_end written');
    });

    const state = createAgentServerState();
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
        })
      ).rejects.toBeDefined();

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      const turnStarts = events.filter((e) => e.type === 'turn_start');
      const turnEnds = events.filter((e) => e.type === 'turn_end');

      expect(turnStarts).toHaveLength(1);
      // Exactly one turn_end despite TWO writes (runner + fallback) — storage
      // layer dedup made the fallback a no-op.
      expect(turnEnds).toHaveLength(1);
      // The runner's stopReason wins, not the fallback's.
      expect(turnEnds[0]?.data).toMatchObject({ stopReason: 'provider_error_simulated' });

      expect(runSpy).toHaveBeenCalledTimes(1);
    } finally {
      client.close();
      server.close();
    }
  });

  it('writes exactly one turn_end on a successful run (no fallback fired)', async () => {
    // Sanity check: when runner.run resolves cleanly, the catch handler must
    // not write a second turn_end. The mocked runner stands in for a normal
    // happy-path runner that already wrote its own turn_end.
    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async function (
      this: ConversationRunner,
      opts: { turnId: string }
    ) {
      if (!state.activeSession) throw new Error('test setup: no active session');
      const sessionDir = state.activeSession.dir;
      const sessionState = readSessionState(sessionDir);
      const { nextState } = appendDurableEvent(sessionDir, sessionState, {
        type: 'turn_end',
        turnId: opts.turnId,
        turnSeq: 1,
        data: { type: 'turn_end', stopReason: 'end_turn' },
      });
      writeSessionState(sessionDir, nextState);
      return {
        turnId: opts.turnId,
        stopReason: 'end_turn',
        content: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    });

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      const promptResult = (await client.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
      })) as { stopReason: string };
      expect(promptResult.stopReason).toBe('end_turn');

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 100 });
      const turnEnds = events.filter((e) => e.type === 'turn_end');

      expect(turnEnds).toHaveLength(1);
      expect(turnEnds[0]?.data).toMatchObject({ stopReason: 'end_turn' });

      expect(runSpy).toHaveBeenCalledTimes(1);
    } finally {
      client.close();
      server.close();
    }
  });
});
