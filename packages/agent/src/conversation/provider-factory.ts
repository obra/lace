// ABOUTME: Provider factory functions for conversation turns and model pricing

import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import { isTestProviderEnabled } from '@lace/agent/rpc/utils';
import type { AgentServerState } from '@lace/agent/server-types';
import { ensureProviderCatalogLoaded } from '@lace/agent/providers/catalog';
import { logger } from '@lace/agent/utils/logger';

// Re-export createProviderForTurn from its canonical location in providers/
export { createProviderForTurn } from '@lace/agent/providers/turn-factory';

/**
 * Pricing for a model in USD per 1M tokens.
 *
 * `cacheCreation` is the rate billed for tokens written into the prompt
 * cache (Anthropic charges a premium over the base input rate — 1.25× for
 * 5-minute ephemeral, 2.0× for 1-hour ephemeral). `cacheRead` is the rate
 * billed for tokens served from cache (Anthropic discounts at 0.1× of base).
 *
 * Non-Anthropic providers that don't expose cache accounting return
 * `cacheCreation` and `cacheRead` equal to `input` so the cost formula
 * collapses to the uncached path.
 */
export interface ModelPricing {
  costPer1mIn: number;
  costPer1mOut: number;
  /** USD per 1M tokens for cache-creation input. Defaults to costPer1mIn. */
  costPer1mCacheCreation: number;
  /** USD per 1M tokens for cache-read input. Defaults to costPer1mIn. */
  costPer1mCacheRead: number;
}

/**
 * Get model pricing from the catalog.
 * Returns pricing per million tokens (input, output, cache creation, cache
 * read) or null if unavailable. For test provider, returns mock pricing for
 * testing budget enforcement.
 *
 * The state-owned `providerCatalog` is lazily loaded on first
 * read. Callers that need pricing (today: the conversation runner) hit this
 * function on every turn — if the catalog isn't loaded yet we'd return null
 * and the persisted `costUsd` field would silently be 0 forever. Force the
 * load here so the function is safe to call from any path, not just ones
 * that have already gone through an RPC handler that pre-loads the catalog.
 */
export async function getModelPricing(
  state: AgentServerState,
  connectionId?: string,
  modelId?: string
): Promise<ModelPricing | null> {
  // Test provider: get pricing from the provider itself
  if (isTestProviderEnabled()) {
    const p = TestAgentProvider.getPricing();
    return {
      costPer1mIn: p.costPer1mIn,
      costPer1mOut: p.costPer1mOut,
      costPer1mCacheCreation: p.costPer1mIn,
      costPer1mCacheRead: p.costPer1mIn,
    };
  }

  if (!connectionId || !modelId) return null;

  try {
    // Ensure catalog loaded BEFORE getProvider — otherwise the cache miss is
    // silent and costUsd stays at 0 for every turn until something else
    // (catalog list, models list) populates the cache.
    await ensureProviderCatalogLoaded(state);

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) {
      logger.debug('pricing.lookup.no_instance', { connectionId });
      return null;
    }

    const catalogProvider = state.providerCatalog.getProvider(instance.catalogProviderId);
    if (!catalogProvider) {
      logger.debug('pricing.lookup.no_catalog_provider', {
        catalogProviderId: instance.catalogProviderId,
      });
      return null;
    }

    const model = catalogProvider.models.find((m) => m.id === modelId);
    if (!model) {
      logger.debug('pricing.lookup.no_model', {
        catalogProviderId: instance.catalogProviderId,
        modelId,
      });
      return null;
    }

    // Model pricing is optional - some models may not have pricing data
    if (model.cost_per_1m_in === undefined || model.cost_per_1m_out === undefined) {
      return null;
    }

    // Cache pricing defaults to the base input rate when the catalog entry
    // omits it — collapses the cost formula to the uncached path for
    // providers without cache accounting.
    return {
      costPer1mIn: model.cost_per_1m_in,
      costPer1mOut: model.cost_per_1m_out,
      costPer1mCacheCreation: model.cost_per_1m_in_cached ?? model.cost_per_1m_in,
      costPer1mCacheRead: model.cost_per_1m_out_cached ?? model.cost_per_1m_in,
    };
  } catch (err) {
    logger.debug('pricing.lookup.error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
