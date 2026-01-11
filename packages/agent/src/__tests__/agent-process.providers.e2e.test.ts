import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent provider config (E2E over stdio)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-provider', enableTestProvider: false });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it('can create a connection and rotate credentials', { timeout: 15_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
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

  it('rejects ent/connections/upsert with invalid config', { timeout: 15_000 }, async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
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

    await expect(
      ctx.agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'Bad Connection', config: { apiKey: 'sk-should-not-be-here' } },
      })
    ).rejects.toMatchObject({ code: -32602, message: 'InvalidParams' });

    await expect(
      ctx.agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'Bad Connection', config: { endpoint: 'not-a-url' } },
      })
    ).rejects.toMatchObject({ code: -32602, message: 'InvalidParams' });

    await expect(
      ctx.agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'Bad Connection', config: { modelConfig: 'nope' } },
      })
    ).rejects.toMatchObject({ code: -32602, message: 'InvalidParams' });
  });
});
