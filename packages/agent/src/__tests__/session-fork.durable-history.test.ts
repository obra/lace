import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
