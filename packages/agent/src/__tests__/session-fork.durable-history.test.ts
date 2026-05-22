import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { loadSession, writeSessionState } from '../storage/session-store';
import { buildDefaultBoundedHostRuntimeBinding } from '../tools/runtime/validation';
import type { RuntimeExecutionBinding } from '../tools/runtime/types';

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

describe('session/fork durable history', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-test-'));
    process.env.LACE_DIR = tempDir;

    // Avoid real provider calls; we are only exercising session + durable storage.
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('copies all durable events when forking a session (including > 100)', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());

      const created = (await client.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })) as any;
      expect(created).toMatchObject({ sessionId: expect.any(String), created: expect.any(String) });

      // Create enough durable events to exceed readDurableEvents default limit (100).
      const injectedCount = 120;
      for (let i = 0; i < injectedCount; i++) {
        await client.request('ent/session/inject', {
          content: [{ type: 'text', text: `event_${i}` }],
          priority: 'normal',
        });
      }

      const sourceEventsResult = (await client.request('ent/session/events', {
        afterEventSeq: 0,
        limit: 2000,
      })) as any;
      expect(sourceEventsResult.hasMore).toBe(false);

      const sourceEvents = sourceEventsResult.events as any[];
      expect(sourceEvents.length).toBeGreaterThan(100);
      const sourceLast = sourceEvents.at(-1);
      expect(sourceLast).toMatchObject({ type: 'context_injected' });
      expect(sourceLast.data).toMatchObject({
        content: [{ type: 'text', text: `event_${injectedCount - 1}` }],
      });

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
      })) as any;
      expect(forked).toMatchObject({
        sessionId: expect.any(String),
        forkedFrom: created.sessionId,
      });

      await client.request('session/load', {
        sessionId: forked.sessionId,
        cwd: process.cwd(),
        mcpServers: [],
      });
      const forkedEventsResult = (await client.request('ent/session/events', {
        afterEventSeq: 0,
        limit: 2000,
      })) as any;
      expect(forkedEventsResult.hasMore).toBe(false);

      const forkedEvents = forkedEventsResult.events as any[];
      expect(forkedEvents.length).toBe(sourceEvents.length);
      expect(forkedEvents.at(-1)).toMatchObject({
        eventSeq: sourceLast.eventSeq,
        type: sourceLast.type,
        data: sourceLast.data,
      });
    } finally {
      client.close();
      server.close();
    }
  });

  it('rebuilds runtime binding identity and cwd when forking to a new cwd', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    const sourceCwd = join(tempDir, 'source');
    const forkedCwd = join(tempDir, 'forked');
    const sourceRuntimeBinding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_source_session' },
      agentPlacement: 'host',
      toolRuntime: { type: 'boundedHost', root: sourceCwd, cwd: sourceCwd },
    };

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: sourceCwd,
        mcpServers: [],
        config: { runtimeBinding: sourceRuntimeBinding },
      })) as { sessionId: string };

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
        cwd: forkedCwd,
      })) as { sessionId: string };

      expect(loadSession(created.sessionId).state.config?.runtimeBinding).toEqual(
        sourceRuntimeBinding
      );
      expect(loadSession(forked.sessionId).state.config?.runtimeBinding).toEqual(
        buildDefaultBoundedHostRuntimeBinding({ sessionId: forked.sessionId, cwd: forkedCwd })
      );
    } finally {
      client.close();
      server.close();
    }
  });

  it('defaults direct MCP override placement when forking a session', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      })) as { sessionId: string };

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
        mcpServers: [
          { name: 'missing-transport', command: 'mcp-default' },
          { name: 'stdio-transport', command: 'mcp-stdio', transport: 'stdio' },
          { name: 'http-transport', command: 'mcp-http', transport: 'http' },
          { name: 'sse-transport', command: 'mcp-sse', transport: 'sse' },
          {
            name: 'explicit-host',
            command: 'mcp-explicit',
            transport: 'stdio',
            placement: 'host',
          },
        ],
      })) as { sessionId: string };

      expect(loadSession(forked.sessionId).state.config?.mcpServers).toEqual([
        { name: 'missing-transport', command: 'mcp-default', placement: 'toolRuntime' },
        {
          name: 'stdio-transport',
          command: 'mcp-stdio',
          transport: 'stdio',
          placement: 'toolRuntime',
        },
        {
          name: 'http-transport',
          command: 'mcp-http',
          transport: 'http',
          placement: 'host',
        },
        { name: 'sse-transport', command: 'mcp-sse', transport: 'sse', placement: 'host' },
        {
          name: 'explicit-host',
          command: 'mcp-explicit',
          transport: 'stdio',
          placement: 'host',
        },
      ]);
    } finally {
      client.close();
      server.close();
    }
  });

  it('defaults legacy source MCP placement when forking without overrides', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request('initialize', defaultInitializeParams());
      const created = (await client.request('session/new', {
        cwd: tempDir,
        mcpServers: [],
      })) as { sessionId: string };
      const source = loadSession(created.sessionId);
      writeSessionState(source.dir, {
        ...source.state,
        config: {
          ...source.state.config,
          mcpServers: [
            { name: 'legacy-stdio', command: 'mcp-stdio' },
            { name: 'legacy-http', command: 'mcp-http', transport: 'http' },
          ],
        },
      });

      const forked = (await client.request('session/fork', {
        sessionId: created.sessionId,
      })) as { sessionId: string };

      expect(loadSession(forked.sessionId).state.config?.mcpServers).toEqual([
        { name: 'legacy-stdio', command: 'mcp-stdio', placement: 'toolRuntime' },
        { name: 'legacy-http', command: 'mcp-http', transport: 'http', placement: 'host' },
      ]);
    } finally {
      client.close();
      server.close();
    }
  });
});
