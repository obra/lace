// ABOUTME: Tests that the prompt handler drains pending immediate injects on the
// non-success turn-exit paths (abort early-return and error/catch), not just the
// normal success return. Under async-only delegation a job-completion
// `context_injected` (priority='immediate') is the SOLE way a parent learns a
// subagent finished, so an inject landing as a turn exits via abort/error must
// still trigger a follow-up internal turn that consumes it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import * as eventLog from '@lace/agent/storage/event-log';
import { readDurableEvents } from '@lace/agent/storage/event-log';
import {
  getSessionDir,
  readSessionState,
  writeSessionState,
} from '@lace/agent/storage/session-store';
import type { AgentServerState } from '@lace/agent/server-types';

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

/**
 * Write a `context_injected` immediate event directly to the session log via
 * the real (un-spied) appendDurableEvent, simulating a job-completion
 * notification landing during the turn.
 */
function injectImmediate(state: AgentServerState, text: string): void {
  if (!state.activeSession) throw new Error('test setup: no active session');
  const sessionDir = state.activeSession.dir;
  const sessionState = readSessionState(sessionDir);
  const { nextState } = realAppendDurableEvent(sessionDir, sessionState, {
    type: 'context_injected',
    data: { content: [{ type: 'text', text }], priority: 'immediate' },
  });
  writeSessionState(sessionDir, nextState);
  state.activeSession = { ...state.activeSession, state: nextState };
}

// Capture the real implementation before any test spies on the module.
const realAppendDurableEvent = eventLog.appendDurableEvent;

/** Wait for the setImmediate-scheduled follow-up turn to be observed. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('prompt handler — drain pending immediate injects on non-success exits', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-drain-on-exit-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-drain-on-exit-wd-'));
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

  it('fires a follow-up internal turn when an immediate inject lands as the turn ABORTS', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    // The follow-up internal turn is the only one that reaches the runner (the
    // original turn aborts before run()). Spy run() to observe it fired and to
    // resolve cleanly so the follow-up turn completes.
    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async function (
      this: ConversationRunner,
      opts: { turnId: string }
    ) {
      if (!state.activeSession) throw new Error('test setup: no active session');
      const sessionDir = state.activeSession.dir;
      const sessionState = readSessionState(sessionDir);
      const { nextState } = realAppendDurableEvent(sessionDir, sessionState, {
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

    // One-shot: when the FIRST turn writes its turn_start, abort that turn's
    // controller and land an immediate inject. The prompt handler's abort
    // early-return then fires before run() — exactly the gap path under test.
    let armed = true;
    vi.spyOn(eventLog, 'appendDurableEvent').mockImplementation(
      (sessionDir, sessionState, event) => {
        const result = realAppendDurableEvent(sessionDir, sessionState, event);
        if (armed && event.type === 'turn_start') {
          armed = false;
          state.activeTurn?.abortController.abort();
          injectImmediate(state, 'JOB-DONE-ABORT');
        }
        return result;
      }
    );

    try {
      await client.request('initialize', defaultInitializeParams());
      const newResult = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      const promptResult = (await client.request('session/prompt', {
        content: [{ type: 'text', text: 'hello' }],
      })) as { stopReason: string };
      // The original turn was cancelled.
      expect(promptResult.stopReason).toBe('cancelled');

      // The drain must have scheduled a follow-up internal turn that reaches the
      // runner to consume the pending inject.
      await waitFor(() => runSpy.mock.calls.length >= 1);
      expect(runSpy).toHaveBeenCalledTimes(1);

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 200 });
      // Two turn_starts: the original (aborted) turn and the follow-up drain turn.
      const turnStarts = events.filter((e) => e.type === 'turn_start');
      expect(turnStarts.length).toBe(2);
    } finally {
      client.close();
      server.close();
    }
  });

  it('fires a follow-up internal turn when an immediate inject lands as the turn ERRORS', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    // run() throws on the FIRST call (after landing an immediate inject), then
    // resolves cleanly on the follow-up drain turn so it completes.
    let firstRun = true;
    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async function (
      this: ConversationRunner,
      opts: { turnId: string }
    ) {
      if (firstRun) {
        firstRun = false;
        injectImmediate(state, 'JOB-DONE-ERROR');
        throw new Error('synthetic runner failure');
      }
      if (!state.activeSession) throw new Error('test setup: no active session');
      const sessionDir = state.activeSession.dir;
      const sessionState = readSessionState(sessionDir);
      const { nextState } = realAppendDurableEvent(sessionDir, sessionState, {
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

      // The drain (on the catch/finally exit) must have scheduled a follow-up
      // internal turn that reaches the runner a SECOND time.
      await waitFor(() => runSpy.mock.calls.length >= 2);
      expect(runSpy).toHaveBeenCalledTimes(2);

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 200 });
      const turnStarts = events.filter((e) => e.type === 'turn_start');
      expect(turnStarts.length).toBe(2);
    } finally {
      client.close();
      server.close();
    }
  });

  it('does NOT fire a follow-up turn on a clean success with no pending inject', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    const runSpy = vi.spyOn(ConversationRunner.prototype, 'run').mockImplementation(async function (
      this: ConversationRunner,
      opts: { turnId: string }
    ) {
      if (!state.activeSession) throw new Error('test setup: no active session');
      const sessionDir = state.activeSession.dir;
      const sessionState = readSessionState(sessionDir);
      const { nextState } = realAppendDurableEvent(sessionDir, sessionState, {
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

      // Give any erroneously-scheduled setImmediate a chance to run.
      await new Promise((r) => setTimeout(r, 50));
      expect(runSpy).toHaveBeenCalledTimes(1);

      const sessionDir = getSessionDir(newResult.sessionId);
      const { events } = readDurableEvents(sessionDir, { afterEventSeq: 0, limit: 200 });
      const turnStarts = events.filter((e) => e.type === 'turn_start');
      expect(turnStarts.length).toBe(1);
    } finally {
      client.close();
      server.close();
    }
  });
});
