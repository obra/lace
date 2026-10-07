// ABOUTME: Tests for ent/session/rerender_persona, which re-renders a session's frozen
// ABOUTME: system prompt from the current persona file without compacting.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../server';
import { defaultInitializeParams } from '../../__tests__/helpers/initialize';
import { getSessionDir } from '@lace/agent/storage/session-store';
import { readDurableEvents } from '@lace/agent/storage/event-log';

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

type LoggedEvent = { type: string; data?: { text?: string } };

function readEvents(sessionDir: string): LoggedEvent[] {
  return readDurableEvents(sessionDir, { limit: Number.MAX_SAFE_INTEGER })
    .events as unknown as LoggedEvent[];
}

describe('ent/session/rerender_persona', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;
  let personasDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-rerender-rpc-test-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-rerender-rpc-wd-'));
    personasDir = mkdtempSync(join(tmpdir(), 'lace-rerender-rpc-personas-'));
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
    rmSync(personasDir, { recursive: true, force: true });
  });

  it('rerenders the frozen system prompt without compacting', async () => {
    const personaPath = join(personasDir, 'rerender.md');
    writeFileSync(personaPath, '---\nmodel: some-model\n---\nYou are a persona. MARKER-A');

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request(
        'initialize',
        defaultInitializeParams({}, { userPersonasPaths: [personasDir] })
      );
      const { sessionId } = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
        persona: 'rerender',
      })) as { sessionId: string };
      const sessionDir = getSessionDir(sessionId);

      const before = readEvents(sessionDir).filter((e) => e.type === 'system_prompt_set');
      expect(before.at(-1)?.data?.text).toContain('MARKER-A');

      writeFileSync(personaPath, '---\nmodel: some-model\n---\nYou are a persona. MARKER-B');

      const result = await client.request('ent/session/rerender_persona', { sessionId });
      expect(result).toEqual({ rerendered: true });

      const events = readEvents(sessionDir);
      const latest = events.filter((e) => e.type === 'system_prompt_set').at(-1);
      expect(latest?.data?.text).toContain('MARKER-B');
      expect(latest?.data?.text).not.toContain('MARKER-A');
      expect(events.some((e) => e.type === 'context_compacted')).toBe(false);
    } finally {
      client.close();
      server.close();
    }
  });

  it('errors when the sessionId does not match the active session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      await client.request('session/new', { cwd: workDir, mcpServers: [] });

      await expect(
        client.request('ent/session/rerender_persona', { sessionId: 'sess_nope' })
      ).rejects.toMatchObject({ message: 'SessionNotFound' });
    } finally {
      client.close();
      server.close();
    }
  });
});
