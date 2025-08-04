// ABOUTME: Provider discovery API endpoint
// ABOUTME: Returns all available providers with their models and configuration status

import { NextResponse } from 'next/server';
import { ProviderRegistry, ProviderCatalogManager } from '@/lib/server/lace-imports';
import type { ProviderInfo, ModelInfo } from '@/types/core';
import type { CatalogProvider, ProviderInstance } from '~/providers/catalog/types';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export interface ProviderWithModels extends ProviderInfo {
  models: ModelInfo[];
  configured: boolean;
  instanceId?: string;
}

export interface ProvidersResponse {
  providers: ProviderWithModels[];
}

export async function GET(): Promise<NextResponse> {
  try {
    // Use new provider instance system instead of auto-discovery
    const registry = new ProviderRegistry();
    await registry.initialize();
    
    const configuredInstances = await registry.getConfiguredInstances();
    
    // If no instances are configured, return empty array
    if (configuredInstances.length === 0) {
      return createSuperjsonResponse({ providers: [] });
    }
    
    // Get catalog manager to access provider and model information
    const catalogManager = new ProviderCatalogManager();
    await catalogManager.loadCatalogs();
    
    // Build providers array - one entry per instance as requested
    const providers: ProviderWithModels[] = configuredInstances.map(instance => {
      const catalogProvider = catalogManager.getProvider(instance.catalogProviderId);
      if (!catalogProvider) {
        throw new Error(`Catalog provider ${instance.catalogProviderId} not found for instance ${instance.id}`);
      }
      
      const models = catalogManager.getProviderModels(instance.catalogProviderId);
      
      return {
        id: catalogProvider.id,
        name: catalogProvider.name,
        displayName: instance.displayName, // Use instance display name, not catalog name
        type: catalogProvider.type,
        requiresApiKey: catalogProvider.requiresApiKey || false,
        configurationHint: catalogProvider.configurationHint,
        models,
        configured: true, // All returned providers are configured by definition
        instanceId: instance.id,
      };
    });

    return createSuperjsonResponse({ providers });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to retrieve providers';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
