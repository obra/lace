import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';

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

describe('durable events', () => {
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

  it('writes and replays durable events for a prompt', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', { protocolVersion: '1.0' });
    const created = await client.request('session/new', { workDir: process.cwd() });

    const promptResult = await client.request('session/prompt', {
      content: [{ type: 'text', text: 'hi' }],
    });
    expect(promptResult).toMatchObject({ turnId: expect.any(String), stopReason: 'end_turn' });

    const eventsResult = await client.request('ent/session/events', { limit: 50 });
    expect(eventsResult).toMatchObject({
      events: expect.any(Array),
      hasMore: expect.any(Boolean),
    });

    const types = (eventsResult as any).events.map((e: any) => e.type);
    expect(types).toEqual(['prompt', 'turn_start', 'message', 'turn_end']);
    expect((eventsResult as any).events[0]).toMatchObject({
      eventSeq: 1,
      turnId: promptResult.turnId,
    });

    client.close();
    server.close();
    expect(created).toBeTruthy();
  });
});
