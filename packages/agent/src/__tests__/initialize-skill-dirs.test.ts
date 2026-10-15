// ABOUTME: Tests that the initialize handler accepts embedder skillDirs as bare paths or
// ABOUTME: { dir, namespace } entries, stores them in order, and rejects malformed entries.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('initialize skillDirs', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-skilldirs-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function initializeWith(skillDirs: unknown) {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', { ...defaultInitializeParams(), skillDirs });
      return { state, error: undefined };
    } catch (error) {
      return { state, error };
    } finally {
      client.close();
      server.close();
    }
  }

  it('stores a plain string list unchanged', async () => {
    const { state, error } = await initializeWith(['/a/skills', '/b/skills']);
    expect(error).toBeUndefined();
    expect(state.skillDirs).toEqual(['/a/skills', '/b/skills']);
  });

  it('stores namespaced and bare entries in order', async () => {
    const dirs = [
      { dir: '/local/skills', namespace: 'local' },
      '/bare/skills',
      { dir: '/org/skills', namespace: 'org-prime-radiant' },
    ];
    const { state, error } = await initializeWith(dirs);
    expect(error).toBeUndefined();
    expect(state.skillDirs).toEqual(dirs);
  });

  it.each([
    ['an empty string', ''],
    ['an empty namespace', { dir: '/x', namespace: '' }],
    ['a namespace with uppercase letters', { dir: '/x', namespace: 'Org' }],
    ['a namespace with a colon', { dir: '/x', namespace: 'org:acme' }],
    ['a namespace with a leading hyphen', { dir: '/x', namespace: '-org' }],
    ['a namespace with consecutive hyphens', { dir: '/x', namespace: 'org--acme' }],
    ['a namespace with surrounding whitespace', { dir: '/x', namespace: ' org ' }],
    ['a missing namespace', { dir: '/x' }],
    ['a missing dir', { namespace: 'org' }],
    ['an empty dir', { dir: '', namespace: 'org' }],
    ['a number', 42],
    ['null', null],
    ['an array', ['/x', 'org']],
  ])('rejects %s', async (_label, entry) => {
    const { state, error } = await initializeWith([entry]);
    expect(error).toMatchObject({ code: -32602, message: 'InvalidParams' });
    expect(state.skillDirs).toBeUndefined();
  });
});
