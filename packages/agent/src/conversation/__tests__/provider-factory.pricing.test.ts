// ABOUTME: PRI-1817 tests — getModelPricing returns cache-tier pricing and
// ensures the provider catalog is loaded before lookup. This is the bug fix
// for "costUsd is always 0.00 in production": the state-owned catalog was
// silently unloaded on first session/prompt.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getModelPricing, type ModelPricing } from '../provider-factory';
import type { AgentServerState } from '@lace/agent/server-types';
import type { CatalogProvider, CatalogModel } from '@lace/agent/providers/catalog/types';

function makeAnthropicCatalog(): CatalogProvider {
  const models: CatalogModel[] = [
    {
      id: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      cost_per_1m_in: 5,
      cost_per_1m_out: 25,
      cost_per_1m_in_cached: 6.25,
      cost_per_1m_out_cached: 0.5,
      context_window: 200000,
      default_max_tokens: 50000,
    },
    {
      id: 'no-cache-model',
      name: 'No cache pricing',
      cost_per_1m_in: 3,
      cost_per_1m_out: 15,
      context_window: 100000,
      default_max_tokens: 4000,
    },
  ];
  return {
    name: 'Anthropic',
    id: 'anthropic',
    type: 'anthropic',
    default_large_model_id: 'claude-opus-4-7',
    default_small_model_id: 'claude-opus-4-7',
    models,
  };
}

function makeMockState(opts: {
  catalog?: CatalogProvider;
  alreadyLoaded?: boolean;
  loadCatalogs?: () => Promise<void>;
  instances?: Record<string, { catalogProviderId: string; displayName: string }>;
}): AgentServerState {
  let catalogLoaded = opts.alreadyLoaded ?? false;
  const catalog = opts.catalog;
  const providers: CatalogProvider[] = catalog ? [catalog] : [];
  return {
    providerCatalog: {
      loadCatalogs:
        opts.loadCatalogs ??
        (async () => {
          catalogLoaded = true;
        }),
      getAvailableProviders: () => providers,
      getProvider: (id: string) =>
        catalogLoaded ? (providers.find((p) => p.id === id) ?? null) : null,
    } as unknown as AgentServerState['providerCatalog'],
    get providerCatalogLoaded() {
      return catalogLoaded;
    },
    set providerCatalogLoaded(v: boolean) {
      catalogLoaded = v;
    },
    providerInstances: {
      loadInstances: vi.fn().mockResolvedValue({
        version: '1.0',
        instances: opts.instances ?? {
          'sen-anthropic': { catalogProviderId: 'anthropic', displayName: 'x' },
        },
      }),
    } as unknown as AgentServerState['providerInstances'],
  } as unknown as AgentServerState;
}

describe('getModelPricing (PRI-1817)', () => {
  // Save and clear any test-provider env so isTestProviderEnabled() returns false.
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    savedEnv.LACE_AGENT_TEST_PROVIDER = process.env.LACE_AGENT_TEST_PROVIDER;
    delete process.env.LACE_AGENT_TEST_PROVIDER;
  });
  afterEach(() => {
    if (savedEnv.LACE_AGENT_TEST_PROVIDER === undefined) {
      delete process.env.LACE_AGENT_TEST_PROVIDER;
    } else {
      process.env.LACE_AGENT_TEST_PROVIDER = savedEnv.LACE_AGENT_TEST_PROVIDER;
    }
  });

  it('returns null when connectionId or modelId is missing', async () => {
    const state = makeMockState({ catalog: makeAnthropicCatalog() });
    expect(await getModelPricing(state, undefined, 'claude-opus-4-7')).toBeNull();
    expect(await getModelPricing(state, 'sen-anthropic', undefined)).toBeNull();
  });

  it('forces catalog load before lookup (fixes costUsd=0 production bug)', async () => {
    // Pre-bug behavior: state.providerCatalog never had loadCatalogs() called
    // before the first prompt, so getProvider returned null, pricing was null,
    // and every persisted costUsd was 0. The fix calls
    // ensureProviderCatalogLoaded inside getModelPricing.
    const loadCatalogs = vi.fn().mockImplementation(async () => {
      /* loadCatalogs side-effects set internal state */
    });
    const state = makeMockState({
      catalog: makeAnthropicCatalog(),
      alreadyLoaded: false,
      loadCatalogs,
    });
    const pricing = await getModelPricing(state, 'sen-anthropic', 'claude-opus-4-7');
    expect(loadCatalogs).toHaveBeenCalled();
    expect(pricing).not.toBeNull();
  });

  it('returns cache pricing fields populated from cost_per_1m_in_cached and cost_per_1m_out_cached', async () => {
    const state = makeMockState({ catalog: makeAnthropicCatalog(), alreadyLoaded: true });
    const pricing = await getModelPricing(state, 'sen-anthropic', 'claude-opus-4-7');
    expect(pricing).not.toBeNull();
    const p = pricing as ModelPricing;
    expect(p.costPer1mIn).toBe(5);
    expect(p.costPer1mOut).toBe(25);
    expect(p.costPer1mCacheCreation).toBe(6.25); // from cost_per_1m_in_cached
    expect(p.costPer1mCacheRead).toBe(0.5); // from cost_per_1m_out_cached
  });

  it('defaults cache pricing to base input rate when catalog omits cache fields', async () => {
    const state = makeMockState({ catalog: makeAnthropicCatalog(), alreadyLoaded: true });
    const pricing = await getModelPricing(state, 'sen-anthropic', 'no-cache-model');
    expect(pricing).not.toBeNull();
    const p = pricing as ModelPricing;
    expect(p.costPer1mIn).toBe(3);
    expect(p.costPer1mOut).toBe(15);
    // Fallback: cache fields collapse to base input rate so cost stays
    // conservative (over-counts) rather than silently zeroing.
    expect(p.costPer1mCacheCreation).toBe(3);
    expect(p.costPer1mCacheRead).toBe(3);
  });

  it('returns null when connectionId is not in instances config', async () => {
    const state = makeMockState({ catalog: makeAnthropicCatalog(), alreadyLoaded: true });
    expect(await getModelPricing(state, 'unknown-conn', 'claude-opus-4-7')).toBeNull();
  });
});
