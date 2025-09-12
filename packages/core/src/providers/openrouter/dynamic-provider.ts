// ABOUTME: Dynamic provider for OpenRouter that fetches fresh model data
// ABOUTME: Combines API client, caching, and filtering into a complete catalog provider

import { OpenRouterClient } from './client';
import { CatalogCacheManager } from './cache-manager';
import { ModelFilterService } from './filter-service';
import type { ModelConfig, CatalogProvider, CatalogModel } from '../catalog/types';
import type { OpenRouterModel } from './types';
import { getLaceDir } from '~/config/lace-dir';
import { convertPricing } from './utils';

export class OpenRouterDynamicProvider {
  private client: OpenRouterClient;
  private cacheManager: CatalogCacheManager;
  private filterService: ModelFilterService;
  private instanceId: string;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
    this.client = new OpenRouterClient();
    this.cacheManager = new CatalogCacheManager(getLaceDir());
    this.filterService = new ModelFilterService();
  }

  async getCatalog(apiKey?: string): Promise<CatalogProvider> {
    // Check cache first
    const cached = await this.cacheManager.load(this.instanceId);
    const isStale = await this.cacheManager.isStale(this.instanceId);

    if (cached && !isStale) {
      return this.transformToCatalogProvider(cached.provider);
    }

    // Fetch fresh data
    try {
      const response = await this.client.fetchModels(apiKey);
      const catalog = {
        _meta: {
          fetchedAt: new Date().toISOString(),
          version: '1.0',
          modelCount: response.data.length,
          source: 'https://openrouter.ai/api/v1/models',
        },
        provider: {
          name: 'OpenRouter',
          id: 'openrouter',
          models: response.data,
        },
      };

      await this.cacheManager.save(this.instanceId, catalog);

      return this.transformToCatalogProvider(catalog.provider);
    } catch (error) {
      // Fall back to cache if available
      if (cached) {
        return this.transformToCatalogProvider(cached.provider);
      }

      throw error;
    }
  }

  async getCatalogWithConfig(
    apiKey: string | undefined,
    config: ModelConfig
  ): Promise<CatalogProvider> {
    const catalog = await this.getCatalog(apiKey);

    // Apply filters - need to convert back to OpenRouter format for filtering
    const openRouterModels = this.convertToOpenRouterModels(catalog.models);
    const filtered = this.filterService.filterModels(openRouterModels, config);

    return {
      ...catalog,
      models: this.transformModels(filtered),
    };
  }

  private transformToCatalogProvider(provider: any): CatalogProvider {
    return {
      name: provider.name,
      id: provider.id,
      type: 'openai', // OpenRouter uses OpenAI-compatible API
      api_endpoint: 'https://openrouter.ai/api/v1',
      default_large_model_id: 'anthropic/claude-3.5-sonnet',
      default_small_model_id: 'anthropic/claude-3.5-haiku',
      models: this.transformModels(provider.models),
    };
  }

  private transformModels(openRouterModels: OpenRouterModel[]): CatalogModel[] {
    return openRouterModels.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      cost_per_1m_in: convertPricing(model.pricing.prompt),
      cost_per_1m_out: convertPricing(model.pricing.completion),
      context_window: model.context_length,
      default_max_tokens: Math.min(4096, Math.floor(model.context_length / 4)),
      supports_attachments: model.supported_parameters?.includes('vision') ?? false,
      can_reason: model.supported_parameters?.includes('reasoning') ?? false,
    }));
  }

  private convertToOpenRouterModels(catalogModels: CatalogModel[]): OpenRouterModel[] {
    return catalogModels.map((model) => ({
      id: model.id,
      name: model.name,
      context_length: model.context_window,
      pricing: {
        prompt: (model.cost_per_1m_in / 1000000).toString(),
        completion: (model.cost_per_1m_out / 1000000).toString(),
      },
      supported_parameters: [
        ...(model.supports_attachments ? ['vision'] : []),
        ...(model.can_reason ? ['reasoning'] : []),
      ],
    }));
  }
}
