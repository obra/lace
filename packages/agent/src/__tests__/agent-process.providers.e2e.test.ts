import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeSseStream } from '../providers/__tests__/anthropic-sse-stream';
import { ProviderInstanceManager } from '../providers/instance/manager';
import {
  AGENT_BOOT_TIMEOUT_MS,
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
  E2E_TEST_TIMEOUT_MS,
} from './helpers';

describe('lace-agent provider config (E2E over stdio)', { timeout: E2E_TEST_TIMEOUT_MS }, () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-provider', enableTestProvider: false });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('can create a connection and rotate credentials', async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      AGENT_BOOT_TIMEOUT_MS,
      'initialize'
    );

    const providers = (await withTimeout(
      ctx.agent.peer.request('ent/providers/list'),
      2_000,
      'ent/providers/list'
    )) as { providers: Array<{ providerId: string }> };

    expect(providers.providers.length).toBeGreaterThan(0);
    const providerId =
      providers.providers.find((p) => p.providerId === 'openai')?.providerId ??
      providers.providers[0].providerId;

    const created = (await withTimeout(
      ctx.agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'E2E Connection', config: {} },
      }),
      2_000,
      'ent/connections/upsert'
    )) as { connectionId: string };

    const firstKey = (await withTimeout(
      ctx.agent.peer.request('ent/connections/credentials/submit', {
        connectionId: created.connectionId,
        values: { apiKey: 'sk-e2e-1' },
      }),
      2_000,
      'credentials/submit (1)'
    )) as { ok: boolean };
    expect(firstKey.ok).toBe(true);

    const rotatedKey = (await withTimeout(
      ctx.agent.peer.request('ent/connections/credentials/submit', {
        connectionId: created.connectionId,
        values: { apiKey: 'sk-e2e-2' },
      }),
      2_000,
      'credentials/submit (2)'
    )) as { ok: boolean };
    expect(rotatedKey.ok).toBe(true);

    const status = (await withTimeout(
      ctx.agent.peer.request('ent/connections/credentials/status', {
        connectionId: created.connectionId,
      }),
      2_000,
      'credentials/status'
    )) as { state: string };
    expect(status.state).toBe('ready');
  });

  it('rejects ent/connections/upsert with invalid config', async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      AGENT_BOOT_TIMEOUT_MS,
      'initialize'
    );

    const providers = (await withTimeout(
      ctx.agent.peer.request('ent/providers/list'),
      2_000,
      'ent/providers/list'
    )) as { providers: Array<{ providerId: string }> };

    expect(providers.providers.length).toBeGreaterThan(0);
    const providerId =
      providers.providers.find((p) => p.providerId === 'openai')?.providerId ??
      providers.providers[0].providerId;

    // Credentials should be rejected
    await expect(
      ctx.agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'Bad Connection', config: { apiKey: 'sk-should-not-be-here' } },
      })
    ).rejects.toMatchObject({ code: -32602 });

    // Invalid endpoint URL should be rejected
    await expect(
      ctx.agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'Bad Connection', config: { endpoint: 'not-a-url' } },
      })
    ).rejects.toMatchObject({ code: -32602 });

    // Invalid modelConfig should be rejected
    await expect(
      ctx.agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'Bad Connection', config: { modelConfig: 'nope' } },
      })
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('answers with an exact Anthropic model without waiting for discovery', async () => {
    const connectionId = 'local-anthropic';
    const modelId = 'claude-sonnet-4-20250514';
    const messageModels: string[] = [];
    let reportDiscovery!: (url: string) => void;
    const discovery = new Promise<string>((resolve) => {
      reportDiscovery = resolve;
    });
    const server = createServer(async (req, res) => {
      const pathname = req.url?.split('?')[0];
      if (req.method === 'GET' && pathname === '/models') {
        // Hold discovery open so it can never unblock the turn.
        reportDiscovery(pathname);
        return;
      }
      if (req.method === 'POST' && pathname === '/v1/messages') {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string };
        messageModels.push(body.model);
        writeSseStream(res, modelId);
        return;
      }
      res.writeHead(404).end();
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const instances = new ProviderInstanceManager();
      await instances.saveInstances({
        version: '1.0',
        instances: {
          [connectionId]: {
            displayName: 'Local Anthropic',
            catalogProviderId: 'anthropic',
            endpoint,
          },
        },
      });
      await instances.saveCredential(connectionId, { apiKey: 'sk-ant-test' });

      ctx.agent = spawnAgentProcess({
        laceDir: ctx.laceDir,
        env: { LACE_DISABLE_DYNAMIC_CATALOGS: '0', LACE_AGENT_TEST_PROVIDER: '0' },
      });
      const { peer } = ctx.agent;
      await withTimeout(
        peer.request('initialize', defaultInitializeParams({ config: { connectionId, modelId } })),
        AGENT_BOOT_TIMEOUT_MS,
        'initialize'
      );
      await withTimeout(
        peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      const answer = await withTimeout(
        Promise.race([
          peer.request('session/prompt', { content: [{ type: 'text', text: 'hello' }] }),
          discovery.then((url) => {
            throw new Error(
              `Unexpected Anthropic model discovery during an exact-model turn: ${url}`
            );
          }),
        ]),
        10_000,
        'session/prompt'
      );
      expect(answer).toMatchObject({
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });
      expect(messageModels).toEqual([modelId]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
    }
  });
});
