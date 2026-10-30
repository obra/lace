// ABOUTME: Verifies the process-local sticky context API over real Ent RPC.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer, AcpErrorCodes } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { readDurableEvents } from '../../../storage/event-log';
import { registerSessionHandlers } from '../session';
import type { CreateToolExecutorFn } from '../../../server-types';
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

describe('temporary request context over Ent RPC', () => {
  let tempDir: string;
  let workDir: string;
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-temporary-context-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-temporary-context-work-'));
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
  it('clears old context before activation can wake the new session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', defaultInitializeParams());
      const opened = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };
      const observedAtSchedulerStart: (string | null | undefined)[] = [];
      registerSessionHandlers(
        server,
        state,
        (async () => ({
          executor: {},
          toolsForProvider: [],
          mcpServersNotReady: [],
        })) as unknown as CreateToolExecutorFn,
        async (work) => await work(),
        async () => {},
        async () => {
          observedAtSchedulerStart.push(state.temporaryContext);
        }
      );
      for (const method of ['session/new', 'session/load', 'session/resume']) {
        await client.request('ent/session/temporary_context/set', {
          text: 'previous session context',
        });
        await client.request(method, {
          ...(method === 'session/new' ? {} : { sessionId: opened.sessionId }),
          cwd: workDir,
          mcpServers: [],
        });
      }
      expect(observedAtSchedulerStart).toEqual([null, null, null]);
    } finally {
      client.close();
      server.close();
    }
  });

  it('sets, replaces, peeks and clears without changing durable session files', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', defaultInitializeParams());
      await expect(
        client.request('ent/session/temporary_context/set', { text: 'absent' })
      ).rejects.toMatchObject({ code: AcpErrorCodes.SessionNotFound });
      const opened = (await client.request('session/new', { cwd: workDir, mcpServers: [] })) as {
        sessionId: string;
      };
      const before = JSON.stringify(readDurableEvents(state.activeSession!.dir, {}).events);
      const beforeState = readFileSync(join(state.activeSession!.dir, 'state.json'), 'utf8');
      const peek = () => client.request('ent/session/temporary_context/peek', {});
      expect(await peek()).toEqual({ text: null });
      expect(await client.request('ent/session/temporary_context/set', { text: 'first' })).toEqual(
        {}
      );
      expect(await peek()).toEqual({ text: 'first' });
      expect(await peek()).toEqual({ text: 'first' });
      await client.request('ent/session/temporary_context/set', { text: ' replacement ' });
      expect(await peek()).toEqual({ text: ' replacement ' });
      for (const params of [{ text: '' }, { text: 3 }, { text: 'x', lifetime: 'turn' }, null]) {
        await expect(
          client.request('ent/session/temporary_context/set', params)
        ).rejects.toMatchObject({ code: -32602 });
      }
      await expect(
        client.request('ent/session/temporary_context/peek', { extra: true })
      ).rejects.toMatchObject({ code: -32602 });
      expect(JSON.stringify(readDurableEvents(state.activeSession!.dir, {}).events)).toBe(before);
      expect(readFileSync(join(state.activeSession!.dir, 'state.json'), 'utf8')).toBe(beforeState);
      const beforeUsage = (await client.request('ent/session/token_usage', {})) as {
        totalTokens: number;
      };
      await client.request('ent/session/temporary_context/set', { text: 'x'.repeat(4000) });
      const afterUsage = (await client.request('ent/session/token_usage', {})) as {
        totalTokens: number;
      };
      expect(afterUsage.totalTokens - beforeUsage.totalTokens).toBeGreaterThanOrEqual(990);
      expect(await client.request('ent/session/temporary_context/clear', {})).toEqual({});
      expect(await peek()).toEqual({ text: null });
      await client.request('ent/session/temporary_context/set', { text: 'old' });
      await client.request('session/close', { sessionId: opened.sessionId });
      expect(state.temporaryContext).toBeNull();
      await client.request('session/load', {
        sessionId: opened.sessionId,
        cwd: workDir,
        mcpServers: [],
      });
      expect(await peek()).toEqual({ text: null });
      await client.request('ent/session/temporary_context/set', { text: 'load reset' });
      await client.request('session/load', {
        sessionId: opened.sessionId,
        cwd: workDir,
        mcpServers: [],
      });
      expect(await peek()).toEqual({ text: null });
      await client.request('ent/session/temporary_context/set', { text: 'resume reset' });
      await client.request('session/resume', {
        sessionId: opened.sessionId,
        cwd: workDir,
        mcpServers: [],
      });
      expect(await peek()).toEqual({ text: null });
      await client.request('ent/session/temporary_context/set', { text: 'failed load stays' });
      await expect(
        client.request('session/load', { sessionId: 'sess_missing', cwd: workDir, mcpServers: [] })
      ).rejects.toBeDefined();
      expect(await peek()).toEqual({ text: 'failed load stays' });
      await client.request('session/prompt', { content: [{ type: 'text', text: 'Hello' }] });
      expect(await peek()).toEqual({ text: 'failed load stays' });
      await client.request('ent/session/temporary_context/set', { text: 'new reset' });
      await client.request('session/new', { cwd: workDir, mcpServers: [] });
      expect(await peek()).toEqual({ text: null });
    } finally {
      client.close();
      server.close();
    }
  });
});
