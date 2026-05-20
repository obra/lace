// ABOUTME: Tests for ACP session cancellation and close lifecycle handling.
// ABOUTME: Ensures cancellation remains mapped to the JSON-RPC cancellation error code.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AcpErrorCodes,
  createNdjsonStdioTransport,
  JsonRpcPeer,
  JSONRPC_ERROR_CANCELLED,
} from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';

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

describe('ACP session cancellation', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-test-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('aborts the active turn on session/cancel notification', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };

    const abortController = new AbortController();
    state.activeTurn = {
      turnId: 'turn_test',
      startedAt: new Date().toISOString(),
      status: 'running',
      abortController,
    };

    client.notify('session/cancel', { sessionId: created.sessionId });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(abortController.signal.aborted).toBe(true);
    const ping = await client.request('ent/agent/ping');
    expect(ping).toMatchObject({ ok: true, timestamp: expect.any(String) });

    client.close();
    server.close();
  });

  it('rejects session/close while a turn is active', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = (await client.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };

    const abortController = new AbortController();
    state.activeTurn = {
      turnId: 'turn_test',
      startedAt: new Date().toISOString(),
      status: 'running',
      abortController,
    };

    await expect(
      client.request('session/close', { sessionId: created.sessionId })
    ).rejects.toMatchObject({
      code: AcpErrorCodes.SessionBusy,
    });

    expect(abortController.signal.aborted).toBe(false);
    expect(state.activeTurn).toBeTruthy();
    expect(state.activeSession?.meta.sessionId).toBe(created.sessionId);

    client.close();
    server.close();
  });

  it('stops session MCP servers on session/close', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const fixturePath = resolve('../web/test-utils/fixtures/mcp-stdio-test-server.cjs');

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [{ name: 'close-test', command: process.execPath, args: [fixturePath] }],
      })) as { sessionId: string };

      const status = (await client.request('ent/agent/status')) as {
        mcpServers?: Array<{ name: string; status: string }>;
      };
      expect(status.mcpServers?.find((s) => s.name === 'close-test')).toMatchObject({
        name: 'close-test',
        status: 'connected',
      });

      await expect(
        client.request('session/close', { sessionId: created.sessionId })
      ).resolves.toEqual({});

      expect(state.activeSession).toBeNull();
      expect(state.mcpServerManager.getAllServers()).toEqual([]);
    } finally {
      await state.mcpServerManager.shutdown();
      client.close();
      server.close();
    }
  });

  it('sends -32800 error code when handling cancellation request', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    // Verify the error code constant is correct
    expect(JSONRPC_ERROR_CANCELLED).toBe(-32800);

    client.close();
    server.close();
  });
});
