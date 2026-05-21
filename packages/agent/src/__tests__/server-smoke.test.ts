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
} from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { EnvironmentRuntimeSecretResolver } from '../tools/runtime/secrets';

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

  it('installs the default runtime secret resolver', () => {
    const state = createAgentServerState();

    expect(state.runtimeSecretResolver).toBeInstanceOf(EnvironmentRuntimeSecretResolver);
  });

  it('handles initialize and session/new', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    const init = await client.request('initialize', defaultInitializeParams());
    expect(init).toMatchObject({ protocolVersion: '1.0' });

    const ping = await client.request('ent/agent/ping');
    expect(ping).toMatchObject({ ok: true, timestamp: expect.any(String) });

    const created = await client.request('session/new', { cwd: process.cwd(), mcpServers: [] });
    expect(created).toMatchObject({
      sessionId: expect.stringMatching(/^sess_/),
      created: expect.any(String),
    });

    const list = await client.request('session/list', { cwd: process.cwd() });
    expect(list).toMatchObject({
      sessions: [
        {
          sessionId: created.sessionId,
          cwd: process.cwd(),
          created: expect.any(String),
          updatedAt: expect.any(String),
          messageCount: expect.any(Number),
        },
      ],
    });

    const loaded = await client.request('session/load', {
      sessionId: created.sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    });
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

    await client.request('initialize', defaultInitializeParams());

    await expect(
      client.request('session/load', {
        sessionId: 'sess_00000000-0000-0000-0000-000000000000',
        cwd: process.cwd(),
        mcpServers: [],
      })
    ).rejects.toMatchObject({
      code: AcpErrorCodes.SessionNotFound,
      message: 'SessionNotFound',
    });

    client.close();
    server.close();
  });

  it('returns JobNotFound for ent/job/output of missing job', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());
    await client.request('session/new', { cwd: process.cwd(), mcpServers: [] });

    await expect(client.request('ent/job/output', { jobId: 'job_missing' })).rejects.toMatchObject({
      code: EntErrorCodes.JobNotFound,
      message: 'JobNotFound',
    });

    client.close();
    server.close();
  });

  it('returns ConnectionNotFound for ent/models/list of missing connection', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    await expect(
      client.request('ent/models/list', { connectionId: 'conn_missing' })
    ).rejects.toMatchObject({
      code: EntErrorCodes.ConnectionNotFound,
      message: 'ConnectionNotFound',
    });

    client.close();
    server.close();
  });

  it('returns NotInitialized for methods called before initialize', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await expect(client.request('ent/agent/ping')).rejects.toMatchObject({
      code: EntErrorCodes.NotInitialized,
      message: 'Agent not initialized; call initialize first',
    });

    client.close();
    server.close();
  });
});
