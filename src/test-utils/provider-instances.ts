// ABOUTME: Test utilities for creating real provider instances for tests
// ABOUTME: Provides factory functions to set up actual provider instances instead of mocks

import { ProviderInstanceManager } from '~/providers/instance/manager';
import { ProviderCatalogManager } from '~/providers/catalog/manager';
import type { ProviderInstance, Credential } from '~/providers/catalog/types';
import { logger } from '~/utils/logger';

interface TestProviderConfig {
  catalogId: string; // Use specific catalog ID instead of type
  models: string[];
  displayName?: string;
  endpoint?: string;
  apiKey?: string;
}

/**
 * Creates an actual provider instance in the registry and returns its ID
 * Tests use these real instance IDs instead of provider strings
 *
 * @param config - Configuration for the test provider instance
 * @returns Promise that resolves to the created instance ID
 */
export async function createTestProviderInstance(config: TestProviderConfig): Promise<string> {
  logger.debug('Creating test provider instance', {
    catalogId: config.catalogId,
    models: config.models,
  });

  const instanceManager = new ProviderInstanceManager();
  const catalogManager = new ProviderCatalogManager();

  // Load catalogs to find the appropriate catalog provider
  await catalogManager.loadCatalogs();

  const catalogProviders = catalogManager.getAvailableProviders();
  const catalogProvider = catalogProviders.find((p) => p.id === config.catalogId);

  if (!catalogProvider) {
    throw new Error(`No catalog provider found for id: ${config.catalogId}`);
  }

  // Verify all requested models exist in the catalog
  for (const modelId of config.models) {
    const model = catalogManager.getModel(catalogProvider.id, modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found in catalog for provider ${catalogProvider.id}`);
    }
  }

  // Generate predictable instance ID for tests
  const instanceId = `test-${config.catalogId}`;

  // Create provider instance configuration
  const instance: ProviderInstance = {
    displayName: config.displayName || `Test ${catalogProvider.name}`,
    catalogProviderId: catalogProvider.id,
    ...(config.endpoint && { endpoint: config.endpoint }),
  };

  // Create credentials
  const credential: Credential = {
    apiKey: config.apiKey || getTestApiKey(config.catalogId),
  };

  // Save instance and credentials
  const instancesConfig = await instanceManager.loadInstances();
  instancesConfig.instances[instanceId] = instance;
  await instanceManager.saveInstances(instancesConfig);
  await instanceManager.saveCredential(instanceId, credential);

  logger.debug('Test provider instance created', {
    instanceId,
    catalogId: config.catalogId,
    displayName: instance.displayName,
  });

  return instanceId;
}

/**
 * Cleans up test provider instances by removing them from storage
 * Call this in test teardown to avoid polluting other tests
 *
 * @param instanceIds - Array of instance IDs to remove
 */
export async function cleanupTestProviderInstances(instanceIds: string[]): Promise<void> {
  logger.debug('Cleaning up test provider instances', { instanceIds });

  const instanceManager = new ProviderInstanceManager();

  // Process sequentially to avoid race conditions that could cause partial failures
  for (const instanceId of instanceIds) {
    try {
      logger.debug('Deleting provider instance', { instanceId });
      await instanceManager.deleteInstance(instanceId);
      logger.debug('Successfully deleted provider instance', { instanceId });
    } catch (error) {
      logger.warn('Failed to cleanup test provider instance', { instanceId, error });
      // Continue processing other instances even if one fails
    }
  }

  logger.debug('Test provider instances cleaned up', { instanceIds });
}

/**
 * Gets appropriate test API key for provider catalog ID
 * Uses environment variables or placeholder keys for testing
 */
function getTestApiKey(catalogId: string): string {
  switch (catalogId.toLowerCase()) {
    case 'anthropic':
      return process.env.ANTHROPIC_KEY || 'test-anthropic-key';
    case 'openai':
      return process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || 'test-openai-key';
    case 'lmstudio':
    case 'ollama':
      // Local providers don't need API keys
      return 'not-required';
    default:
      return 'test-api-key';
  }
}
