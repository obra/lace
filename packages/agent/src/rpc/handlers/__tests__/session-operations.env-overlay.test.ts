// ABOUTME: Verifies the memory-only credential env overlay RPC (PRI-3672) over
// ABOUTME: real Ent RPC: set/clear semantics, dangerous-name refusal, and that
// ABOUTME: the value never lands in any file under the session directory.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer, AcpErrorCodes } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { readDurableEvents } from '../../../storage/event-log';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';

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

/** Every regular file directly under a directory tree, recursively. */
function allFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...allFilesUnder(full));
    else out.push(full);
  }
  return out;
}

describe('credential env overlay over Ent RPC (PRI-3672)', () => {
  let tempDir: string;
  let workDir: string;
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-env-overlay-rpc-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-env-overlay-rpc-work-'));
    process.env.LACE_DIR = tempDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('requires an active session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', defaultInitializeParams());
      await expect(
        client.request('ent/session/env_overlay/set', { vars: { FOO: 'test-placeholder-xyz' } })
      ).rejects.toMatchObject({ code: AcpErrorCodes.SessionNotFound });
      await expect(client.request('ent/session/env_overlay/clear', {})).rejects.toMatchObject({
        code: AcpErrorCodes.SessionNotFound,
      });
    } finally {
      client.close();
      server.close();
    }
  });

  it('sets and clears without writing a durable event or touching state.json', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });
      const dir = state.activeSession!.dir;
      const beforeEvents = JSON.stringify(readDurableEvents(dir, {}).events);
      const beforeState = readFileSync(join(dir, 'state.json'), 'utf8');

      expect(
        await client.request('ent/session/env_overlay/set', {
          vars: { MINTED_CRED: 'test-placeholder-xyz' },
        })
      ).toEqual({});
      expect(state.envOverlay).toEqual({ MINTED_CRED: { value: 'test-placeholder-xyz' } });

      // A second key, plus an expiresAt this time.
      await client.request('ent/session/env_overlay/set', {
        vars: { OTHER_CRED: 'test-placeholder-abc' },
        expiresAt: Date.now() + 60_000,
      });
      expect(Object.keys(state.envOverlay ?? {}).sort()).toEqual(['MINTED_CRED', 'OTHER_CRED']);

      expect(
        await client.request('ent/session/env_overlay/clear', { keys: ['OTHER_CRED'] })
      ).toEqual({});
      expect(state.envOverlay).toEqual({ MINTED_CRED: { value: 'test-placeholder-xyz' } });

      expect(await client.request('ent/session/env_overlay/clear', {})).toEqual({});
      expect(state.envOverlay).toEqual({});

      // Nothing durable changed at any point above.
      expect(JSON.stringify(readDurableEvents(dir, {}).events)).toBe(beforeEvents);
      expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(beforeState);
    } finally {
      client.close();
      server.close();
    }
  });

  it('refuses an empty vars object and a non-object params shape', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      for (const params of [
        { vars: {} },
        { vars: { FOO: 3 } },
        null,
        { vars: { FOO: 'x' }, extra: 1 },
      ]) {
        await expect(client.request('ent/session/env_overlay/set', params)).rejects.toMatchObject({
          code: -32602,
        });
      }
      expect(state.envOverlay ?? {}).toEqual({});
    } finally {
      client.close();
      server.close();
    }
  });

  it.each(['PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH'])(
    'refuses the dangerous name %s and sets nothing from that call',
    async (dangerousName) => {
      const state = createAgentServerState();
      const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
      try {
        await client.request('initialize', defaultInitializeParams());
        await client.request('session/new', { cwd: workDir, mcpServers: [] });

        await expect(
          client.request('ent/session/env_overlay/set', {
            vars: { [dangerousName]: '/evil', SAFE_CRED: 'test-placeholder-xyz' },
          })
        ).rejects.toMatchObject({ code: -32602 });
        // All-or-nothing: SAFE_CRED in the same call was not set either.
        expect(state.envOverlay ?? {}).toEqual({});
      } finally {
        client.close();
        server.close();
      }
    }
  );

  it('expires a key on its own: a live read after expiresAt no longer returns it, and the map drops it', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      await client.request('ent/session/env_overlay/set', {
        vars: { EXPIRING_CRED: 'test-placeholder-xyz' },
        expiresAt: Date.now() + 10,
      });
      expect(state.envOverlay).toEqual({
        EXPIRING_CRED: { value: 'test-placeholder-xyz', expiresAt: expect.any(Number) },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      // Nothing in this PR calls env_overlay/clear on a timer — the entry is
      // dropped lazily the next time the overlay is read. liveEnvOverlay (the
      // function the runner calls at every tool call) is what does that read;
      // import it directly here rather than driving a whole tool call just to
      // trigger it.
      const { liveEnvOverlay } = await import('../../../core/env-overlay');
      expect(liveEnvOverlay(state)).toBeUndefined();
      expect(state.envOverlay).toEqual({});
    } finally {
      client.close();
      server.close();
    }
  });

  it('never writes the overlay value into any file under the session directory', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const secret = 'test-placeholder-xyz-do-not-leak-98765';
    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });
      const dir = state.activeSession!.dir;

      await client.request('ent/session/env_overlay/set', { vars: { LEAK_CHECK_CRED: secret } });
      // A failed, rejected call carries the value too — make sure that path
      // doesn't leak it into an error log either.
      await expect(
        client.request('ent/session/env_overlay/set', { vars: { PATH: secret } })
      ).rejects.toMatchObject({ code: -32602 });
      await client.request('ent/session/env_overlay/clear', {});

      for (const file of allFilesUnder(dir)) {
        const content = readFileSync(file, 'utf8');
        expect(content.includes(secret), `secret leaked into ${file}`).toBe(false);
      }
    } finally {
      client.close();
      server.close();
    }
  });
});
