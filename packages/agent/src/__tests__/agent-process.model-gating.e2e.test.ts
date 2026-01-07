import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/agent/test-utils/provider-instances';

const PROVIDER_ID = 'openai';
const MODEL_A = 'gpt-4o';
const MODEL_B = 'gpt-4.1-mini';

describe('ent/models enable/disable (provider-global gating)', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;
  const instances: string[] = [];

  beforeEach(async () => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-gating-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-gating-wd-'));
    process.env.LACE_DIR = laceDir;

    const instanceId = await createTestProviderInstance({
      catalogId: PROVIDER_ID,
      models: [MODEL_A, MODEL_B],
    });
    instances.push(instanceId);
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }
    await cleanupTestProviderInstances(instances);

    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('disables and re-enables models globally for the provider', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'approve', connectionId: instances[0] } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    const initialList = (await withTimeout(
      agent.peer.request('ent/models/list', { connectionId: instances[0] }),
      2_000,
      'ent/models/list'
    )) as { models: Array<{ modelId: string }> };

    const initialIds = initialList.models.map((m) => m.modelId);
    expect(initialIds).toEqual(expect.arrayContaining([MODEL_A, MODEL_B]));

    const disabled = (await withTimeout(
      agent.peer.request('ent/models/disable', { providerId: PROVIDER_ID, modelIds: [MODEL_B] }),
      2_000,
      'ent/models/disable'
    )) as { disabled: string[] };
    expect(disabled.disabled).toContain(MODEL_B);

    const afterDisable = (await withTimeout(
      agent.peer.request('ent/models/list', { connectionId: instances[0] }),
      2_000,
      'ent/models/list after disable'
    )) as { models: Array<{ modelId: string; disabled?: boolean }> };
    const modelB = afterDisable.models.find((m) => m.modelId === MODEL_B);
    expect(modelB).toBeDefined();
    expect(modelB?.disabled).toBe(true);

    const enabled = (await withTimeout(
      agent.peer.request('ent/models/enable', { providerId: PROVIDER_ID, modelIds: [MODEL_B] }),
      2_000,
      'ent/models/enable'
    )) as { enabled: string[] };
    expect(enabled.enabled).toContain(MODEL_B);

    const afterEnable = (await withTimeout(
      agent.peer.request('ent/models/list', { connectionId: instances[0] }),
      2_000,
      'ent/models/list after enable'
    )) as { models: Array<{ modelId: string; disabled?: boolean }> };
    const modelBAfter = afterEnable.models.find((m) => m.modelId === MODEL_B);
    expect(modelBAfter?.disabled).not.toBe(true);
  });
});
