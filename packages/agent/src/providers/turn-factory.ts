// ABOUTME: Factory for creating AI providers for conversation turns

import { ProviderRegistry } from '@lace/agent/providers/registry';
import type { AIProvider } from '@lace/agent/providers/base-provider';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import {
  throwInvalidParams,
  toNonEmptyString,
  isTestProviderEnabled,
  isTestProviderStrictConfigEnabled,
} from '@lace/agent/rpc/utils';

/**
 * Create an AI provider for a turn.
 *
 * When LACE_AGENT_TEST_PROVIDER=1 is set, returns a TestAgentProvider for testing.
 * Otherwise requires both connectionId and modelId to create a real provider.
 *
 * @throws InvalidParams error (code -32602) if connectionId or modelId is missing in non-test mode
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
