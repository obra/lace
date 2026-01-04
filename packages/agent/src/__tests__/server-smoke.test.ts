import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';

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

describe('agent rpc server (smoke)', () => {
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

  it('handles initialize and session/new', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    const init = await client.request('initialize', { protocolVersion: '1.0' });
    expect(init).toMatchObject({ protocolVersion: '1.0' });

    const ping = await client.request('ent/agent/ping');
    expect(ping).toMatchObject({ ok: true, timestamp: expect.any(String) });

    const created = await client.request('session/new', { workDir: process.cwd() });
    expect(created).toMatchObject({
      sessionId: expect.stringMatching(/^sess_/),
      created: expect.any(String),
    });

    const list = await client.request('session/list', { workDir: process.cwd() });
    expect(list).toMatchObject({
      sessions: [
        {
          sessionId: created.sessionId,
          workDir: process.cwd(),
        },
      ],
    });

    const loaded = await client.request('session/load', { sessionId: created.sessionId });
    expect(loaded).toMatchObject({ sessionId: created.sessionId, messageCount: 0 });

    const status = await client.request('ent/agent/status');
    expect(status).toMatchObject({
      currentSession: { sessionId: created.sessionId, messageCount: 0 },
      pendingPermissions: [],
    });

    client.close();
    server.close();
  });

  it('returns SessionNotFound for session/load of missing session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', { protocolVersion: '1.0' });

    await expect(
      client.request('session/load', { sessionId: 'sess_missing' })
    ).rejects.toMatchObject({
      code: 1,
      message: 'SessionNotFound',
    });

    client.close();
    server.close();
  });

  it('returns JobNotFound for ent/job/output of missing job', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', { protocolVersion: '1.0' });
    await client.request('session/new', { workDir: process.cwd() });

    await expect(client.request('ent/job/output', { jobId: 'job_missing' })).rejects.toMatchObject({
      code: 8,
      message: 'JobNotFound',
    });

    client.close();
    server.close();
  });

  it('returns ConnectionNotFound for ent/models/list of missing connection', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', { protocolVersion: '1.0' });

    await expect(
      client.request('ent/models/list', { connectionId: 'conn_missing' })
    ).rejects.toMatchObject({
      code: 14,
      message: 'ConnectionNotFound',
    });

    client.close();
    server.close();
  });

  it('returns NotInitialized for methods called before initialize', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await expect(client.request('ent/agent/ping')).rejects.toMatchObject({
      code: 9,
      message: 'NotInitialized',
    });

    client.close();
    server.close();
  });
});
