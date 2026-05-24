// ABOUTME: Tests that the initialize handler accepts and stores the embedder-supplied
// containerMounts named-mount registry, and rejects malformed inputs.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, getContainerMounts, registerAgentRpcMethods } from '../server';
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

describe('initialize containerMounts', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-cmounts-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('defaults to {} when containerMounts is omitted', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    expect(getContainerMounts(state)).toEqual({});

    client.close();
    server.close();
  });

  it('stores valid containerMounts entries on state', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    const mounts = {
      scratch: { hostPath: '/var/lace/scratch', readonly: false },
      knowledge: { hostPath: '/var/lace/knowledge', readonly: true },
    };

    await client.request('initialize', defaultInitializeParams({}, { containerMounts: mounts }));

    expect(getContainerMounts(state)).toEqual(mounts);

    client.close();
    server.close();
  });

  it('stores valid containerExecutionIdentity on state', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', {
      ...defaultInitializeParams(),
      containerExecutionIdentity: { tokenEnvName: 'SEN_AGENT_TOKEN' },
    });

    expect(state.containerExecutionIdentity).toEqual({ tokenEnvName: 'SEN_AGENT_TOKEN' });

    client.close();
    server.close();
  });

  it('rejects unsafe containerExecutionIdentity env var names', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await expect(
      client.request('initialize', {
        ...defaultInitializeParams(),
        containerExecutionIdentity: { tokenEnvName: 'bad-name' },
      })
    ).rejects.toThrow();

    expect(state.containerExecutionIdentity).toBeUndefined();

    client.close();
    server.close();
  });

  it('rejects unexpected containerExecutionIdentity keys', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await expect(
      client.request('initialize', {
        ...defaultInitializeParams(),
        containerExecutionIdentity: {
          tokenEnvName: 'SEN_AGENT_TOKEN',
          unexpected: 'value',
        },
      })
    ).rejects.toThrow();

    expect(state.containerExecutionIdentity).toBeUndefined();

    client.close();
    server.close();
  });

  it('rejects invalid mount names (uppercase)', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await expect(
      client.request(
        'initialize',
        defaultInitializeParams(
          {},
          { containerMounts: { Scratch: { hostPath: '/x', readonly: false } } }
        )
      )
    ).rejects.toThrow();
    // State must remain at the default since initialize aborted.
    expect(getContainerMounts(state)).toEqual({});

    client.close();
    server.close();
  });

  it('rejects mount entry missing readonly flag', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await expect(
      client.request('initialize', {
        ...defaultInitializeParams(),
        containerMounts: { scratch: { hostPath: '/x' } },
      })
    ).rejects.toThrow();

    client.close();
    server.close();
  });

  it('rejects mount entry with empty hostPath', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await expect(
      client.request(
        'initialize',
        defaultInitializeParams(
          {},
          { containerMounts: { scratch: { hostPath: '', readonly: false } } }
        )
      )
    ).rejects.toThrow();

    client.close();
    server.close();
  });
});
