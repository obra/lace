import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { ProviderRegistry } from '../providers/registry';

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

describe('ent/models/list dynamic catalogs (OpenAI)', () => {
  let originalLaceDir: string | undefined;
  let originalDisable: string | undefined;
  let originalFetch: typeof globalThis.fetch | undefined;
  let laceDir: string;

  beforeEach(() => {
    ProviderRegistry.clearInstance();
    originalLaceDir = process.env.LACE_DIR;
    originalDisable = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-openai-dyn-'));
    process.env.LACE_DIR = laceDir;
    delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    ProviderRegistry.clearInstance();
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    if (originalDisable === undefined) delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    else process.env.LACE_DISABLE_DYNAMIC_CATALOGS = originalDisable;

    if (originalFetch) globalThis.fetch = originalFetch;
    rmSync(laceDir, { recursive: true, force: true });
  });

  it('returns discovered models when OpenAI credentials exist (enrich + infer)', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { id: 'gpt-4o', object: 'model', created: 0, owned_by: 'openai' },
            { id: 'new-model', object: 'model', created: 0, owned_by: 'openai' },
          ],
        }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    await client.request('initialize', defaultInitializeParams());

    const upsert = (await client.request('ent/connections/upsert', {
      providerId: 'openai',
      connection: { name: 'openai-dyn', config: {} },
    })) as { connectionId: string };

    await client.request('ent/connections/credentials/submit', {
      connectionId: upsert.connectionId,
      values: { apiKey: 'sk-test-dynamic' },
    });

    const list = (await client.request('ent/models/list', {
      connectionId: upsert.connectionId,
    })) as { models: Array<{ modelId: string; name: string }> };

    const ids = list.models.map((m) => m.modelId);
    expect(ids).toEqual(expect.arrayContaining(['gpt-4o', 'new-model']));

    const inferred = list.models.find((m) => m.modelId === 'new-model');
    expect(inferred?.name).toContain('(new-model)');

    // Ensure we actually attempted discovery
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.close();
    server.close();
  });

  it('ent/models/refresh forces a re-fetch for OpenAI', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [{ id: 'gpt-4o', object: 'model', created: 0, owned_by: 'openai' }],
        }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    await client.request('initialize', defaultInitializeParams());

    const upsert = (await client.request('ent/connections/upsert', {
      providerId: 'openai',
      connection: { name: 'openai-refresh', config: {} },
    })) as { connectionId: string };

    await client.request('ent/connections/credentials/submit', {
      connectionId: upsert.connectionId,
      values: { apiKey: 'sk-test-dynamic' },
    });

    await client.request('ent/models/list', { connectionId: upsert.connectionId });
    await client.request('ent/models/refresh', { connectionId: upsert.connectionId });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    client.close();
    server.close();
  });
});
