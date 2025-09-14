// ABOUTME: API endpoint to manually refresh OpenRouter catalog for an instance
// ABOUTME: Fetches latest models from OpenRouter API and updates cache

import type { Route } from './+types/api.provider.instances.$instanceId.refresh';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { ProviderRegistry, OpenRouterDynamicProvider } from '@/lib/server/lace-imports';
import { logger } from '~/utils/logger';

export async function action({ params, request }: Route.ActionArgs) {
  try {
    const { instanceId } = params;

    if (request.method !== 'POST') {
      return createErrorResponse('Method not allowed', 405);
    }

    // Get instance configuration
    const registry = ProviderRegistry.getInstance();
    const instanceManager = registry.getInstanceManager();
    const instances = await instanceManager.loadInstances();
    const instance = instances.instances[instanceId];

    if (!instance) {
      return createErrorResponse(`Instance not found: ${instanceId}`, 404);
    }

    // Only support OpenRouter instances
    if (instance.catalogProviderId !== 'openrouter') {
      return createErrorResponse('Refresh only supported for OpenRouter instances', 400);
    }

    // Get API key from credentials
    const credential = instanceManager.loadCredential(instanceId);
    if (!credential?.apiKey) {
      return createErrorResponse('API key required for refresh', 401);
    }

    // Force refresh the catalog
    const dynamicProvider = new OpenRouterDynamicProvider(instanceId);
    const catalog = await dynamicProvider.refreshCatalog(credential.apiKey);

    logger.info('Catalog refreshed', {
      instanceId,
      modelCount: catalog.models.length,
    });

    return createSuperjsonResponse({
      success: true,
      modelCount: catalog.models.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error: unknown) {
    logger.error('Failed to refresh catalog', { error });
    const errorMessage = error instanceof Error ? error.message : 'Failed to refresh catalog';
    return createErrorResponse(errorMessage, 500);
  }
}
