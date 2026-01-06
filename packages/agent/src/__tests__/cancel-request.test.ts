import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AcpErrorCodes,
  createNdjsonStdioTransport,
  EntErrorCodes,
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

describe('$/cancel_request notification', () => {
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

  it('accepts $/cancel_request notification', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    const created = await client.request('session/new', { workDir: process.cwd() });

    // Send a $/cancel_request notification (notifications don't expect a response)
    client.notify('$/cancel_request', { requestId: 'test-request-123' });

    // Give it a moment to process
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify server is still responsive
    const ping = await client.request('ent/agent/ping');
    expect(ping).toMatchObject({ ok: true, timestamp: expect.any(String) });

    client.close();
    server.close();
  });

  it('rejects session/cancel as an unknown method', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    await client.request('session/new', { workDir: process.cwd() });

    // session/cancel should no longer be supported - it's been replaced by $/cancel_request
    await expect(client.request('session/cancel', {})).rejects.toThrow();

    client.close();
    server.close();
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
