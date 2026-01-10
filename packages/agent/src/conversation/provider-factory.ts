// ABOUTME: Provider factory for creating AI providers for conversation turns

import { ProviderRegistry } from '@lace/agent/providers/registry';
import { AIProvider } from '@lace/agent/providers/base-provider';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import { throwInvalidParams, toNonEmptyString, isTestProviderEnabled } from '@lace/agent/rpc/utils';
import type { AgentServerState } from '@lace/agent/server-types';

/**
 * Create an AI provider for a turn.
 */
export async function createProviderForTurn(options: {
  connectionId?: string;
  modelId?: string;
}): Promise<AIProvider> {
  if (isTestProviderEnabled()) {
    return new TestAgentProvider();
  }

  const connectionId = toNonEmptyString(options.connectionId);
  const modelId = toNonEmptyString(options.modelId);
  if (!connectionId || !modelId) {
    throwInvalidParams(
      'connectionId and modelId are required before prompting; call ent/session/configure'
    );
  }

  const registry = ProviderRegistry.getInstance();
  return await registry.createProviderFromInstanceAndModel(connectionId, modelId);
}

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
