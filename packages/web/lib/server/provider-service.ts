// ABOUTME: Provider domain service that handles provider-specific operations
// ABOUTME: Separates provider business logic from the pure HTTP api-client

import { api } from '@/lib/api-client';

export interface ProviderCatalogResponse {
  providers: unknown[];
}

export interface RefreshCatalogResponse {
  success: boolean;
  modelCount: number;
  lastUpdated: string;
}

export interface UpdateModelConfigResponse {
  success: boolean;
  message: string;
}

/**
 * Provider service that encapsulates all provider-related API operations.
 * This keeps the api-client pure while providing domain-specific functionality.
 */
export const providerService = {
  /**
   * Get the provider catalog containing all available providers and their models
   */
  getCatalog(): Promise<ProviderCatalogResponse> {
    return api.get<ProviderCatalogResponse>('/api/provider/catalog');
  },

  /**
   * Refresh the catalog for a specific provider instance
   */
  refreshCatalog(instanceId: string): Promise<RefreshCatalogResponse> {
    return api.post<RefreshCatalogResponse>(`/api/provider/instances/${instanceId}/refresh`);
  },

  /**
   * Update the model configuration for a provider instance
   */
  updateModelConfig(instanceId: string, modelConfig: unknown): Promise<UpdateModelConfigResponse> {
    return api.patch<UpdateModelConfigResponse>(`/api/provider/instances/${instanceId}/config`, {
      modelConfig,
    });
  },
} as const;
