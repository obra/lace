// ABOUTME: Tests for host-preallocated sessionId support in session/new (Chunk D.2)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
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

describe('session/new preallocated sessionId', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-prealloc-sess-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses host-supplied sessionId when present', async () => {
    const preallocated = `sess_${randomUUID()}`;

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    const result = (await client.request('session/new', {
      cwd: tempDir,
      sessionId: preallocated,
    })) as { sessionId: string };

    expect(result.sessionId).toBe(preallocated);
  });

  it('mints a new sessionId when sessionId not provided', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    const result = (await client.request('session/new', {
      cwd: tempDir,
    })) as { sessionId: string };

    expect(result.sessionId).toMatch(
      /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('rejects a malformed host-supplied sessionId', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    await expect(
      client.request('session/new', {
        cwd: tempDir,
        sessionId: 'badid',
      })
    ).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('rejects an empty string host-supplied sessionId', async () => {
    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    await expect(
      client.request('session/new', {
        cwd: tempDir,
        sessionId: '',
      })
    ).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('rejects a host-supplied sessionId that already has an existing session on disk', async () => {
    const preallocated = `sess_${randomUUID()}`;

    const state = createAgentServerState();
    const { client } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    // First creation should succeed
    await client.request('session/new', {
      cwd: tempDir,
      sessionId: preallocated,
    });

    // Second creation with same id should fail — session already exists
    await expect(
      client.request('session/new', {
        cwd: tempDir,
        sessionId: preallocated,
      })
    ).rejects.toMatchObject({
      code: -32602,
    });
  });
});
