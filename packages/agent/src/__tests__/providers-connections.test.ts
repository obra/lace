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

describe('ent/providers + ent/connections', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-provider-test-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates connections and manages credentials without leaking secrets', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    const providers = (await client.request('ent/providers/list')) as {
      providers: Array<{ providerId: string }>;
    };
    expect(providers.providers.length).toBeGreaterThan(0);

    const providerId =
      providers.providers.find((p) => p.providerId === 'openai')?.providerId ??
      providers.providers[0].providerId;

    const upsert = (await client.request('ent/connections/upsert', {
      providerId,
      connection: { name: 'Test Connection', config: {} },
    })) as { connectionId: string; providerId: string; created: boolean };

    expect(upsert).toMatchObject({ connectionId: expect.any(String), providerId, created: true });

    const list1 = (await client.request('ent/connections/list')) as {
      connections: Array<{ connectionId: string; credentialState?: string }>;
    };
    expect(list1.connections.map((c) => c.connectionId)).toContain(upsert.connectionId);
    expect(list1.connections.find((c) => c.connectionId === upsert.connectionId)).toMatchObject({
      credentialState: 'missing',
    });

    const start = (await client.request('ent/connections/credentials/start', {
      connectionId: upsert.connectionId,
    })) as { kind: string };
    expect(start.kind).toBe('needs_input');

    const statusMissing = (await client.request('ent/connections/credentials/status', {
      connectionId: upsert.connectionId,
    })) as { state: string };
    expect(statusMissing.state).toBe('missing');

    const submit = (await client.request('ent/connections/credentials/submit', {
      connectionId: upsert.connectionId,
      values: { apiKey: 'sk-test-do-not-use' },
    })) as { ok: boolean };
    expect(submit.ok).toBe(true);

    const statusReady = (await client.request('ent/connections/credentials/status', {
      connectionId: upsert.connectionId,
    })) as { state: string };
    expect(statusReady.state).toBe('ready');

    const models = (await client.request('ent/models/list', {
      connectionId: upsert.connectionId,
    })) as { providerId: string; connectionId: string; models: Array<{ modelId: string }> };
    expect(models.providerId).toBe(providerId);
    expect(models.connectionId).toBe(upsert.connectionId);
    expect(models.models.length).toBeGreaterThan(0);

    const cleared = (await client.request('ent/connections/credentials/clear', {
      connectionId: upsert.connectionId,
    })) as { ok: boolean };
    expect(cleared.ok).toBe(true);

    const statusAfterClear = (await client.request('ent/connections/credentials/status', {
      connectionId: upsert.connectionId,
    })) as { state: string };
    expect(statusAfterClear.state).toBe('missing');

    const deleted = (await client.request('ent/connections/delete', {
      connectionId: upsert.connectionId,
    })) as { ok: boolean };
    expect(deleted.ok).toBe(true);

    const list2 = (await client.request('ent/connections/list')) as {
      connections: Array<{ connectionId: string }>;
    };
    expect(list2.connections.map((c) => c.connectionId)).not.toContain(upsert.connectionId);

    client.close();
    server.close();
  });
});
