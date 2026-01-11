import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/agent/test-utils/provider-instances';

const PROVIDER_ID = 'openai';
const MODEL_A = 'gpt-4o';
const MODEL_B = 'gpt-4.1-mini';

describe('ent/models enable/disable (provider-global gating)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-gating', enableTestProvider: false });
  const instances: string[] = [];

  beforeEach(async () => {
    ctx.setup();

    const instanceId = await createTestProviderInstance({
      catalogId: PROVIDER_ID,
      models: [MODEL_A, MODEL_B],
    });
    instances.push(instanceId);
  });

  afterEach(async () => {
    await cleanupTestProviderInstances(instances);
    instances.length = 0;
    await ctx.teardown();
  });

  it('disables and re-enables models globally for the provider', async () => {
    ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

    await withTimeout(
      ctx.agent.peer.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'approve', connectionId: instances[0] } })
      ),
      2_000,
      'initialize'
    );

    await withTimeout(
      ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
      2_000,
      'session/new'
    );

    const initialList = (await withTimeout(
      ctx.agent.peer.request('ent/models/list', { connectionId: instances[0] }),
      2_000,
      'ent/models/list'
    )) as { models: Array<{ modelId: string }> };

    const initialIds = initialList.models.map((m) => m.modelId);
    expect(initialIds).toEqual(expect.arrayContaining([MODEL_A, MODEL_B]));

    const disabled = (await withTimeout(
      ctx.agent.peer.request('ent/models/disable', {
        providerId: PROVIDER_ID,
        modelIds: [MODEL_B],
      }),
      2_000,
      'ent/models/disable'
    )) as { disabled: string[] };
    expect(disabled.disabled).toContain(MODEL_B);

    const afterDisable = (await withTimeout(
      ctx.agent.peer.request('ent/models/list', { connectionId: instances[0] }),
      2_000,
      'ent/models/list after disable'
    )) as { models: Array<{ modelId: string; disabled?: boolean }> };
    const modelB = afterDisable.models.find((m) => m.modelId === MODEL_B);
    expect(modelB).toBeDefined();
    expect(modelB?.disabled).toBe(true);

    const enabled = (await withTimeout(
      ctx.agent.peer.request('ent/models/enable', { providerId: PROVIDER_ID, modelIds: [MODEL_B] }),
      2_000,
      'ent/models/enable'
    )) as { enabled: string[] };
    expect(enabled.enabled).toContain(MODEL_B);

    const afterEnable = (await withTimeout(
      ctx.agent.peer.request('ent/models/list', { connectionId: instances[0] }),
      2_000,
      'ent/models/list after enable'
    )) as { models: Array<{ modelId: string; disabled?: boolean }> };
    const modelBAfter = afterEnable.models.find((m) => m.modelId === MODEL_B);
    expect(modelBAfter?.disabled).not.toBe(true);
  });
});
