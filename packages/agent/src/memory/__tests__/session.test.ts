import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  createNdjsonStdioTransport,
  JsonRpcPeer,
  type HostMemoryBinding,
} from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods, shutdownReminders } from '../../server';
import { claimMemoryOwner, configureMemoryRoles, openMemoryDatabase } from '../authority';
import { closeRecallIndex } from '../../storage/recall/index-db';
import { defaultInitializeParams } from '../../__tests__/helpers/initialize';

const grant = {
  producerId: 'persona:lace',
  canRead: true,
  canMutate: true,
  collections: [],
  writableCollections: [],
};
describe('trusted memory initialization and session affinity', () => {
  let dir: string;
  let databasePath: string;
  let binding: HostMemoryBinding;
  const peers: JsonRpcPeer[] = [];
  const states: ReturnType<typeof createAgentServerState>[] = [];
  function pair() {
    const a = new PassThrough();
    const b = new PassThrough();
    const client = new JsonRpcPeer(createNdjsonStdioTransport({ readable: b, writable: a }), {
      idPrefix: 'client_',
    });
    const server = new JsonRpcPeer(createNdjsonStdioTransport({ readable: a, writable: b }), {
      idPrefix: 'server_',
    });
    const state = createAgentServerState();
    registerAgentRpcMethods(server, state);
    peers.push(client, server);
    states.push(state);
    return { client, state };
  }
  async function initialize(client: JsonRpcPeer, memory: unknown = { databasePath, binding }) {
    return client.request('initialize', {
      ...defaultInitializeParams(),
      ...(memory ? { memory } : {}),
    });
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-memory-session-'));
    vi.stubEnv('LACE_DIR', dir);
    vi.stubEnv('LACE_SESSION_DIR', join(dir, 'sessions'));
    vi.stubEnv('LACE_AGENT_TEST_PROVIDER', '1');
    databasePath = join(dir, 'memory.sqlite');
    binding = {
      ...grant,
      instanceId: 'instance',
      ownerGeneration: claimMemoryOwner('instance', databasePath, 'lace'),
      actorId: 'host',
      role: 'lace',
      isRoot: true,
    };
    const db = openMemoryDatabase(databasePath, 'instance', false);
    configureMemoryRoles(db, binding, { lace: grant });
    db.close();
  });
  afterEach(async () => {
    for (const state of states.splice(0)) {
      await shutdownReminders(state);
      await state.memory?.close();
      await state.mcpServerManager.shutdown();
    }
    for (const peer of peers.splice(0)) peer.close();
    closeRecallIndex();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  it('persists only instance affinity and rejects reopening without configured authority', async () => {
    const root = pair();
    await initialize(root.client);
    const created = (await root.client.request('session/new', { cwd: dir, mcpServers: [] })) as {
      sessionId: string;
    };
    expect(root.state.activeSession?.state.memoryInstanceId).toBe('instance');
    const saved = readFileSync(join(root.state.activeSession!.dir, 'state.json'), 'utf8');
    expect(saved).not.toContain('ownerGeneration');
    expect(saved).not.toContain('writableCollections');
    const unconfigured = pair();
    await initialize(unconfigured.client, null);
    await expect(
      unconfigured.client.request('session/load', {
        sessionId: created.sessionId,
        cwd: dir,
        mcpServers: [],
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('Session memory authority') });
    expect(unconfigured.state.activeSession).toBeNull();
  });
  it('rejects child extraction configuration before activating the server', async () => {
    const child = pair();
    await expect(
      initialize(child.client, {
        databasePath,
        binding: { ...binding, isRoot: false, canMutate: false },
        extraction: { connectionId: 'fake', modelId: 'fake' },
      })
    ).rejects.toBeDefined();
    expect(child.state.initialized).toBe(false);
  });
  it('checks current owner before session/new and forwards fresh restricted child configuration', async () => {
    const root = pair();
    await initialize(root.client);
    const { childMemoryConfiguration } = await import('../session');
    const child = childMemoryConfiguration(root.state, 'lace', 'child-actor');
    expect(child).toMatchObject({
      databasePath,
      binding: { isRoot: false, canMutate: false, actorId: 'child-actor' },
    });
    expect(child).not.toHaveProperty('extraction');
    expect(child).not.toHaveProperty('documentSources');
    claimMemoryOwner('instance', databasePath, 'lace', { create: false });
    await expect(
      root.client.request('session/new', { cwd: dir, mcpServers: [] })
    ).rejects.toBeDefined();
    expect(root.state.activeSession).toBeNull();
  });
  it('preserves affinity across load, fork and clear and derives persona-change reads', async () => {
    const root = pair();
    await initialize(root.client);
    const created = (await root.client.request('session/new', { cwd: dir, mcpServers: [] })) as {
      sessionId: string;
    };
    const forked = (await root.client.request('session/fork', {
      sessionId: created.sessionId,
    })) as { sessionId: string };
    await root.client.request('session/load', {
      sessionId: forked.sessionId,
      cwd: dir,
      mcpServers: [],
    });
    expect(root.state.activeSession?.state.memoryInstanceId).toBe('instance');
    const { handleSlashCommand } = await import('../../conversation/slash-commands');
    const { ToolExecutor } = await import('../../tools/executor');
    await handleSlashCommand(
      root.state,
      'clear',
      '',
      'turn-clear',
      async () => {},
      async () => {},
      async () => ({ executor: new ToolExecutor(), toolsForProvider: [], mcpServersNotReady: [] })
    );
    expect(root.state.activeSession?.meta.sessionId).not.toBe(forked.sessionId);
    expect(root.state.activeSession?.state.memoryInstanceId).toBe('instance');
    const { sessionMemory } = await import('../session');
    const active = root.state.activeSession!;
    sessionMemory(root.state, active);
    active.meta.persona = 'reader';
    expect(sessionMemory(root.state, active)?.reader).toBeDefined();
    active.meta.persona = 'lace';
    expect(sessionMemory(root.state, active)?.reader).toBeDefined();
    const db = openMemoryDatabase(databasePath, 'instance', false);
    configureMemoryRoles(db, binding, {
      lace: grant,
      reader: { ...grant, producerId: 'persona:reader', canRead: false, canMutate: false },
    });
    active.meta.persona = 'reader';
    expect(() => sessionMemory(root.state, active)).toThrow();
    db.close();
  });
});
