// ABOUTME: Resolves provider type strings to actual configured provider instance IDs
// ABOUTME: Used during migration to help find real provider instances for tests/code

import { ProviderRegistry } from '~/providers/registry';
import { logger } from '~/utils/logger';

/**
 * Resolves provider type strings to actual configured provider instance IDs
 * Used during migration to help find real provider instances for tests/code
 * 
 * @param providerType - Provider type ('anthropic', 'openai', 'lmstudio', 'ollama')
 * @param modelId - Model ID to verify exists in provider's catalog
 * @returns Promise that resolves to provider instance ID
 * @throws Error if no configured instances found - no fallbacks
 */
export async function findProviderInstanceForType(
  providerType: string, 
  modelId: string
): Promise<string> {
  logger.debug('Finding provider instance for type', { providerType, modelId });
  
  // Create registry and initialize it
  const registry = new ProviderRegistry();
  await registry.initialize();
  
  // Get all configured instances
  const configuredInstances = await registry.getConfiguredInstances();
  
  if (configuredInstances.length === 0) {
    throw new Error(
      `No provider instances configured. Please configure at least one provider instance to use model ${modelId}.`
    );
  }
  
  // Find instances matching the provider type
  const matchingInstances = configuredInstances.filter(instance => {
    // Get catalog provider for this instance
    const catalogProvider = registry.getCatalogProviders()
      .find(p => p.id === instance.catalogProviderId);
    
    if (!catalogProvider) {
      logger.warn('Catalog provider not found for instance', { 
        instanceId: instance.id, 
        catalogProviderId: instance.catalogProviderId 
      });
      return false;
    }
    
    // Check if provider type matches
    const isTypeMatch = catalogProvider.type.toLowerCase() === providerType.toLowerCase();
    
    // Check if the model exists in this provider's catalog
    const hasModel = registry.getModelFromCatalog(catalogProvider.id, modelId) !== null;
    
    // Only include instances with credentials
    return isTypeMatch && hasModel && instance.hasCredentials;
  });
  
  if (matchingInstances.length === 0) {
    const catalogProviders = registry.getCatalogProviders();
    const matchingCatalogProvider = catalogProviders.find(p => 
      p.type.toLowerCase() === providerType.toLowerCase()
    );
    
    if (!matchingCatalogProvider) {
      throw new Error(`Unknown provider type: ${providerType}`);
    }
    
    const hasModel = registry.getModelFromCatalog(matchingCatalogProvider.id, modelId) !== null;
    if (!hasModel) {
      throw new Error(
        `Model ${modelId} not found in catalog for provider type ${providerType}`
      );
    }
    
    throw new Error(
      `No configured provider instances found for ${providerType} with model ${modelId}. ` +
      `Please configure a provider instance for ${matchingCatalogProvider.name}.`
    );
  }
  
  // Return the first matching instance
  const selectedInstance = matchingInstances[0];
  logger.debug('Provider instance found', { 
    providerType, 
    modelId, 
    instanceId: selectedInstance.id,
    displayName: selectedInstance.displayName
  });
  
  return selectedInstance.id;
}

/**
 * Maps legacy provider type strings to normalized provider types
 * Handles common variations and aliases
 */
export function normalizeProviderType(providerType: string): string {
  const normalized = providerType.toLowerCase().trim();
  
  switch (normalized) {
    case 'claude':
    case 'anthropic':
      return 'anthropic';
    case 'gpt':
    case 'openai':
    case 'chatgpt':
      return 'openai';
    case 'lmstudio':
    case 'lm-studio':
    case 'lm_studio':
      return 'lmstudio';
    case 'ollama':
      return 'ollama';
    default:
      return normalized;
  }
}

/**
 * Validates that a provider instance exists and can be used with the specified model
 * 
 * @param instanceId - Provider instance ID to validate
 * @param modelId - Model ID to verify exists in provider's catalog
 * @throws Error if instance doesn't exist or doesn't support the model
 */
export async function validateProviderInstance(
  instanceId: string,
  modelId: string
): Promise<void> {
  logger.debug('Validating provider instance', { instanceId, modelId });
  
  const registry = new ProviderRegistry();
  await registry.initialize();
  
  const configuredInstances = await registry.getConfiguredInstances();
  const instance = configuredInstances.find(i => i.id === instanceId);
  
  if (!instance) {
    throw new Error(`Provider instance not found: ${instanceId}`);
  }
  
  if (!instance.hasCredentials) {
    throw new Error(`Provider instance ${instanceId} has no credentials configured`);
  }
  
  // Verify model exists in catalog
  const hasModel = registry.getModelFromCatalog(instance.catalogProviderId, modelId) !== null;
  if (!hasModel) {
    throw new Error(
      `Model ${modelId} not supported by provider instance ${instanceId} (${instance.displayName})`
    );
  }
  
  logger.debug('Provider instance validated', { instanceId, modelId, displayName: instance.displayName });
}