// ABOUTME: Tests that ent/session/inject wakes an idle session. An immediate
// ABOUTME: inject with no active turn must start one internal turn; an inject
// ABOUTME: during a turn, or a non-immediate inject, must not start one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState } from '../../../server';
import type { AgentServerState } from '../../../server-types';
import { registerSessionOperationHandlers } from '../session-operations';
import {
  ensureSessionFiles,
  getSessionDir,
  loadSession,
  writeSessionMeta,
  writeSessionState,
} from '../../../storage/session-store';

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

/** Let any wake the handler deferred with setImmediate run. */
async function flushDeferredWakes(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function claimTurn(state: AgentServerState): void {
  state.activeTurn = {
    turnId: 'turn_test',
    startedAt: new Date().toISOString(),
    status: 'running',
    abortController: new AbortController(),
  };
}

describe('ent/session/inject idle wake', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;
  let state: AgentServerState;
  let runPromptInternal: ReturnType<typeof vi.fn<(content: unknown[]) => Promise<void>>>;
  let client: JsonRpcPeer;
  let server: JsonRpcPeer;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-inject-idle-wake-'));
    process.env.LACE_DIR = tempDir;

    state = createAgentServerState();
    state.initialized = true;
    state.config = { executionMode: 'execute', approvalMode: 'ask' };

    const sessionId = 'sess_00000000-0000-0000-0000-000000000001';
    const sessionDir = getSessionDir(sessionId);
    writeSessionMeta(sessionDir, {
      sessionId,
      workDir: tempDir,
      created: new Date().toISOString(),
    });
    writeSessionState(sessionDir, { nextEventSeq: 1, nextStreamSeq: 1, config: {} });
    ensureSessionFiles(sessionDir);
    state.activeSession = loadSession(sessionId);

    // Like the real internal prompt runner, claim the turn synchronously on
    // entry so a second wake sees the session as busy.
    runPromptInternal = vi.fn(async () => {
      claimTurn(state);
    });
    const runPromptInternalRef = { current: runPromptInternal };

    ({ client, server } = createPairedPeers((peer) =>
      registerSessionOperationHandlers(
        peer,
        state,
        async (work) => await work(),
        async () => {
          throw new Error('unused');
        },
        runPromptInternalRef
      )
    ));
    client.onRequest('session/update', async () => undefined);
  });

  afterEach(() => {
    client.close();
    server.close();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts an internal turn when an immediate inject lands on an idle session', async () => {
    await client.request('ent/session/inject', {
      content: [{ type: 'text', text: 'news' }],
      priority: 'immediate',
    });
    await flushDeferredWakes();

    expect(runPromptInternal).toHaveBeenCalledTimes(1);
  });

  it('does not start a turn when the inject lands during an active turn', async () => {
    claimTurn(state);

    await client.request('ent/session/inject', {
      content: [{ type: 'text', text: 'news' }],
      priority: 'immediate',
    });
    await flushDeferredWakes();

    expect(runPromptInternal).not.toHaveBeenCalled();
  });

  it('starts only one turn for two immediate injects in a row on an idle session', async () => {
    await Promise.all([
      client.request('ent/session/inject', {
        content: [{ type: 'text', text: 'first' }],
        priority: 'immediate',
      }),
      client.request('ent/session/inject', {
        content: [{ type: 'text', text: 'second' }],
        priority: 'immediate',
      }),
    ]);
    await flushDeferredWakes();

    expect(runPromptInternal).toHaveBeenCalledTimes(1);
  });

  it('does not start a turn for a normal-priority inject on an idle session', async () => {
    await client.request('ent/session/inject', {
      content: [{ type: 'text', text: 'context' }],
      priority: 'normal',
    });
    await flushDeferredWakes();

    expect(runPromptInternal).not.toHaveBeenCalled();
  });
});
