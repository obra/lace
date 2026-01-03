import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';

describe('lace-agent provider config (E2E over stdio)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-provider-e2e-'));
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }

    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(laceDir, { recursive: true, force: true });
  });

  it('can create a connection and rotate credentials', { timeout: 15_000 }, async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(
      agent.peer.request('initialize', { protocolVersion: '1.0' }),
      2_000,
      'initialize'
    );

    const providers = (await withTimeout(
      agent.peer.request('ent/providers/list'),
      2_000,
      'ent/providers/list'
    )) as { providers: Array<{ providerId: string }> };

    expect(providers.providers.length).toBeGreaterThan(0);
    const providerId =
      providers.providers.find((p) => p.providerId === 'openai')?.providerId ??
      providers.providers[0].providerId;

    const created = (await withTimeout(
      agent.peer.request('ent/connections/upsert', {
        providerId,
        connection: { name: 'E2E Connection', config: {} },
      }),
      2_000,
      'ent/connections/upsert'
    )) as { connectionId: string };

    const firstKey = (await withTimeout(
      agent.peer.request('ent/connections/credentials/submit', {
        connectionId: created.connectionId,
        values: { apiKey: 'sk-e2e-1' },
      }),
      2_000,
      'credentials/submit (1)'
    )) as { ok: boolean };
    expect(firstKey.ok).toBe(true);

    const rotatedKey = (await withTimeout(
      agent.peer.request('ent/connections/credentials/submit', {
        connectionId: created.connectionId,
        values: { apiKey: 'sk-e2e-2' },
      }),
      2_000,
      'credentials/submit (2)'
    )) as { ok: boolean };
    expect(rotatedKey.ok).toBe(true);

    const status = (await withTimeout(
      agent.peer.request('ent/connections/credentials/status', {
        connectionId: created.connectionId,
      }),
      2_000,
      'credentials/status'
    )) as { state: string };
    expect(status.state).toBe('ready');
  });
});
