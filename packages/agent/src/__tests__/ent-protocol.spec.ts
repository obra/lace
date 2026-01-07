import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';

/**
 * Contract-style coverage for key Ent protocol methods.
 * These tests exercise stdio JSON-RPC end-to-end against the built agent.
 */
describe('Ent protocol contract (selected coverage)', () => {
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-ent-protocol-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-ent-workdir-'));
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }
    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it(
    'supports provider catalog, connections, models (enable/disable) and session configure',
    { timeout: 25_000 },
    async () => {
      agent = spawnAgentProcess({ laceDir });

      await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

      // providers list
      const { providers } = (await withTimeout(
        agent.peer.request('ent/providers/list'),
        2_000,
        'providers/list'
      )) as { providers: Array<{ providerId: string; displayName?: string }> };
      expect(providers.length).toBeGreaterThan(0);

      const providerId =
        providers.find((p) => p.providerId === 'openai')?.providerId ?? providers[0].providerId;

      // connections upsert
      const { connectionId } = (await withTimeout(
        agent.peer.request('ent/connections/upsert', {
          providerId,
          connection: { name: 'ent-spec', config: {} },
        }),
        2_000,
        'connections/upsert'
      )) as { connectionId: string };
      expect(connectionId).toBeTruthy();

      // models list
      const modelsResp = (await withTimeout(
        agent.peer.request('ent/models/list', { connectionId }),
        2_000,
        'models/list'
      )) as { providerId: string; models: Array<{ modelId: string; disabled?: boolean }> };
      expect(modelsResp.providerId).toBe(providerId);
      expect(modelsResp.models.length).toBeGreaterThan(0);

      const targetModel = modelsResp.models[0].modelId;

      // disable + verify disabled flag appears
      await withTimeout(
        agent.peer.request('ent/models/disable', { providerId, modelIds: [targetModel] }),
        2_000,
        'models/disable'
      );
      const afterDisable = (await withTimeout(
        agent.peer.request('ent/models/list', { connectionId }),
        2_000,
        'models/list after disable'
      )) as { models: Array<{ modelId: string; disabled?: boolean }> };
      const disabledEntry = afterDisable.models.find((m) => m.modelId === targetModel);
      expect(disabledEntry?.disabled).toBe(true);

      // configure session with env + approvalMode
      const { sessionId } = (await withTimeout(
        agent.peer.request('session/new', { workDir }),
        2_000,
        'session/new'
      )) as { sessionId: string };
      expect(sessionId).toBeTruthy();

      const configureResult = (await withTimeout(
        agent.peer.request('ent/session/configure', {
          connectionId,
          modelId: targetModel,
          environment: { HELLO: 'WORLD' },
          approvalMode: 'approveReads',
        }),
        2_000,
        'session/configure'
      )) as { applied: string[]; config: Record<string, unknown> };

      expect(configureResult.applied).toEqual(
        expect.arrayContaining(['connectionId', 'modelId', 'environment', 'approvalMode'])
      );
      expect(configureResult.config).toMatchObject({
        connectionId,
        modelId: targetModel,
        environment: { HELLO: 'WORLD' },
        approvalMode: 'approveReads',
      });
    }
  );

  it('returns structured error for unknown provider refresh and models list invalid conn', async () => {
    agent = spawnAgentProcess({ laceDir });
    await withTimeout(agent.peer.request('initialize', defaultInitializeParams()), 2_000, 'init');

    const refresh = (await withTimeout(
      agent.peer.request('ent/providers/refresh', { providerId: 'does-not-exist' }),
      2_000,
      'providers/refresh'
    )) as { ok: boolean; error?: string };
    expect(refresh.ok).toBe(false);
    expect(refresh.error).toContain('Unknown providerId');

    await expect(
      agent.peer.request('ent/models/list', { connectionId: 'nope' })
    ).rejects.toMatchObject({
      code: 14,
      message: 'ConnectionNotFound',
    });
  });
});
