// ABOUTME: Provider factory functions for conversation turns and model pricing

import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import { isTestProviderEnabled } from '@lace/agent/rpc/utils';
import type { AgentServerState } from '@lace/agent/server-types';

// Re-export createProviderForTurn from its canonical location in providers/
export { createProviderForTurn } from '@lace/agent/providers/turn-factory';

/**
 * Get model pricing from the catalog.
 * Returns pricing per million tokens (input and output) or null if unavailable.
 * For test provider, returns mock pricing for testing budget enforcement.
 */
export async function getModelPricing(
  state: AgentServerState,
  connectionId?: string,
  modelId?: string
): Promise<{ costPer1mIn: number; costPer1mOut: number } | null> {
  // Test provider: get pricing from the provider itself
  if (isTestProviderEnabled()) {
    return TestAgentProvider.getPricing();
  }

  if (!connectionId || !modelId) return null;

  try {
    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) return null;

    const catalogProvider = state.providerCatalog.getProvider(instance.catalogProviderId);
    if (!catalogProvider) return null;

    const model = catalogProvider.models.find((m) => m.id === modelId);
    if (!model) return null;

    // Model pricing is optional - some models may not have pricing data
    if (model.cost_per_1m_in === undefined || model.cost_per_1m_out === undefined) {
      return null;
    }

    return {
      costPer1mIn: model.cost_per_1m_in,
      costPer1mOut: model.cost_per_1m_out,
    };
  } catch {
    return null;
  }
}
