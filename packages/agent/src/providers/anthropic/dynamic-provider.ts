// ABOUTME: Dynamic provider for Anthropic that filters static catalog by API availability
// ABOUTME: Combines API client and static catalog to show only currently available models

import { AnthropicClient } from './client';
import type { AnthropicModel } from './types';
import type { CatalogProvider, CatalogModel } from '../catalog/types';
import { getLaceDir } from '@lace/agent/config/lace-dir';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '@lace/agent/utils/logger';

interface CachedCatalog {
  _meta: {
    fetchedAt: string;
    version: string;
    availableModelCount: number;
    source: string;
  };
  provider: CatalogProvider;
}

export class AnthropicDynamicProvider {
  private client: AnthropicClient;
  private cacheDir: string;
  private instanceId: string;
  // Cache TTL: 24 hours - balances freshness with API rate limits.
  // Anthropic model availability changes infrequently.
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(instanceId: string, baseUrl?: string) {
    this.instanceId = instanceId;
    this.client = new AnthropicClient(baseUrl);
    this.cacheDir = path.join(getLaceDir(), 'catalogs');
  }

  async getCatalog(
    apiKey: string,
    staticCatalog: CatalogProvider,
    forceRefresh = false
  ): Promise<CatalogProvider> {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = await this.loadCache();
      if (cached && !this.isCacheStale(cached)) {
        return cached.provider;
      }
    }

    // Fetch fresh data
    try {
      const models = await this.client.fetchAllModels(apiKey);
      const filteredCatalog = this.filterStaticCatalog(staticCatalog, models);

      const cache: CachedCatalog = {
        _meta: {
          fetchedAt: new Date().toISOString(),
          version: '1.0',
          availableModelCount: filteredCatalog.models.length,
          source: 'https://api.anthropic.com/v1/models',
        },
        provider: filteredCatalog,
      };

      await this.saveCache(cache);
      return filteredCatalog;
    } catch (error) {
      logger.warn('Failed to fetch Anthropic models, using cached or static catalog', { error });
      // Fall back to cache if available (even if stale), otherwise use full static catalog
      const cached = await this.loadCache();
      return cached?.provider ?? staticCatalog;
    }
  }

  private filterStaticCatalog(
    staticCatalog: CatalogProvider,
    availableModels: AnthropicModel[]
  ): CatalogProvider {
    // Create lookup maps
    const staticModelsMap = new Map(staticCatalog.models.map((m) => [m.id, m]));
    const availableModelIds = new Set(availableModels.map((m) => m.id));

    const discoveredModels: CatalogModel[] = [];

    // Add available models that are in static catalog (preserving rich metadata)
    for (const apiModel of availableModels) {
      const staticModel = staticModelsMap.get(apiModel.id);

      if (staticModel) {
        // Use full metadata from static catalog
        discoveredModels.push(staticModel);
      } else {
        // New model not in static catalog - use API data with defaults
        discoveredModels.push(this.inferModelMetadata(apiModel));
      }
    }

    logger.info('Discovered Anthropic models', {
      staticCount: staticCatalog.models.length,
      availableCount: availableModels.length,
      enrichedCount: discoveredModels.filter((m) => staticModelsMap.has(m.id)).length,
      inferredCount: discoveredModels.filter((m) => !staticModelsMap.has(m.id)).length,
      unavailableCount: staticCatalog.models.filter((m) => !availableModelIds.has(m.id)).length,
      totalCount: discoveredModels.length,
    });

    return {
      ...staticCatalog,
      models: discoveredModels,
    };
  }

  private inferModelMetadata(apiModel: AnthropicModel): CatalogModel {
    // Use display_name from API for new models
    // Conservative defaults for context window and max tokens
    return {
      id: apiModel.id,
      name: apiModel.display_name,
      context_window: 200000, // All Claude models have 200k context
      default_max_tokens: 8192, // Conservative default
    };
  }

  private async loadCache(): Promise<CachedCatalog | null> {
    try {
      const cachePath = this.getCachePath();
      const content = await fs.promises.readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;

      // Basic validation of cache structure
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !('_meta' in parsed) ||
        !('provider' in parsed)
      ) {
        logger.debug('Invalid Anthropic catalog cache structure', { instanceId: this.instanceId });
        return null;
      }

      return parsed as CachedCatalog;
    } catch (error) {
      logger.debug('Failed to load Anthropic catalog cache', {
        error,
        instanceId: this.instanceId,
      });
      return null;
    }
  }

  private async saveCache(cache: CachedCatalog): Promise<void> {
    try {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      const cachePath = this.getCachePath();
      await fs.promises.writeFile(cachePath, JSON.stringify(cache, null, 2));
    } catch (error) {
      logger.warn('Failed to save Anthropic catalog cache', { error });
    }
  }

  private isCacheStale(cache: CachedCatalog): boolean {
    const fetchedAt = new Date(cache._meta.fetchedAt);
    const now = new Date();
    return now.getTime() - fetchedAt.getTime() > AnthropicDynamicProvider.CACHE_TTL_MS;
  }

  private getCachePath(): string {
    return path.join(this.cacheDir, `anthropic-${this.instanceId}.json`);
  }
}
