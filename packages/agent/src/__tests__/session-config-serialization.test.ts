// ABOUTME: Tests for serialized session configuration writes.
// ABOUTME: Guards the split Ent/ACP config flow against lost read-modify-write updates.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState } from '../server';
import { registerSessionOperationHandlers } from '../rpc/handlers/session-operations';
import {
  ensureSessionFiles,
  getSessionDir,
  loadSession,
  writeSessionMeta,
  writeSessionState,
} from '../storage/session-store';

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

describe('session config serialization', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-session-config-lock-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses the session mutex for split connection and model config writes', async () => {
    const state = createAgentServerState();
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

    let exclusiveCalls = 0;
    const { client, server } = createPairedPeers((peer) =>
      registerSessionOperationHandlers(
        peer,
        state,
        async (work) => {
          exclusiveCalls += 1;
          return await work();
        },
        async () => {
          throw new Error('unused');
        }
      )
    );

    await Promise.all([
      client.request('ent/session/configure', { connectionId: 'conn_1' }),
      client.request('session/set_config_option', {
        sessionId,
        configId: 'model',
        value: 'model_1',
      }),
    ]);

    expect(exclusiveCalls).toBe(2);
    expect(loadSession(sessionId).state.config).toMatchObject({
      connectionId: 'conn_1',
      modelId: 'model_1',
    });

    client.close();
    server.close();
  });
});
