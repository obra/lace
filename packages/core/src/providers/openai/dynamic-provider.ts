// ABOUTME: Dynamic provider for OpenAI that filters static catalog by API availability
// ABOUTME: Combines API client and static catalog to show only currently available models

import { OpenAIClient } from './client';
import type { CatalogProvider } from '@lace/core/providers/catalog/types';
import type { OpenAIModel } from './types';
import { getLaceDir } from '@lace/core/config/lace-dir';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '@lace/core/utils/logger';

interface CachedCatalog {
  _meta: {
    fetchedAt: string;
    version: string;
    availableModelCount: number;
    source: string;
  };
  provider: CatalogProvider;
}

export class OpenAIDynamicProvider {
  private client: OpenAIClient;
  private cacheDir: string;
  private instanceId: string;
  // Cache TTL: 24 hours - balances freshness with API rate limits.
  // OpenAI model availability rarely changes, and we gracefully fall back to static catalog on errors.
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
    this.client = new OpenAIClient();
    this.cacheDir = path.join(getLaceDir(), 'catalogs');
  }

  async getCatalog(apiKey: string, staticCatalog: CatalogProvider): Promise<CatalogProvider> {
    // Check cache first
    // Note: Potential race condition if multiple concurrent requests hit stale/missing cache.
    // Both will fetch from API simultaneously. This is acceptable because:
    // 1. Duplicate fetches are idempotent and infrequent (24hr TTL)
    // 2. File system writes are atomic (last write wins)
    // 3. Adding deduplication adds complexity for minimal benefit
    const cached = await this.loadCache();
    if (cached && !this.isCacheStale(cached)) {
      return cached.provider;
    }

    // Fetch fresh data
    try {
      const response = await this.client.fetchModels(apiKey);
      const filteredCatalog = this.filterStaticCatalog(staticCatalog, response.data);

      const cache: CachedCatalog = {
        _meta: {
          fetchedAt: new Date().toISOString(),
          version: '1.0',
          availableModelCount: filteredCatalog.models.length,
          source: 'https://api.openai.com/v1/models',
        },
        provider: filteredCatalog,
      };

      await this.saveCache(cache);
      return filteredCatalog;
    } catch (error) {
      logger.warn('Failed to fetch OpenAI models, using cached or static catalog', { error });
      // Fall back to cache if available, otherwise use full static catalog
      return cached?.provider ?? staticCatalog;
    }
  }

  private filterStaticCatalog(
    staticCatalog: CatalogProvider,
    availableModels: OpenAIModel[]
  ): CatalogProvider {
    const availableIds = new Set(availableModels.map((m) => m.id));

    // Simple ID-based filtering is sufficient for OpenAI because:
    // 1. OpenAI's API returns all models available to the account
    // 2. Model capabilities (vision, reasoning, etc.) are static and defined in our catalog
    // 3. Unlike OpenRouter which aggregates many providers, OpenAI's model IDs are stable
    // 4. Access control happens at the API level (models not in /v1/models aren't available)
    const filteredModels = staticCatalog.models.filter((model) => availableIds.has(model.id));

    logger.info('Filtered OpenAI catalog by API availability', {
      staticCount: staticCatalog.models.length,
      availableCount: availableModels.length,
      filteredCount: filteredModels.length,
    });

    return {
      ...staticCatalog,
      models: filteredModels,
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
        logger.debug('Invalid OpenAI catalog cache structure', { instanceId: this.instanceId });
        return null;
      }

      return parsed as CachedCatalog;
    } catch (error) {
      logger.debug('Failed to load OpenAI catalog cache', { error, instanceId: this.instanceId });
      return null;
    }
  }

  private async saveCache(cache: CachedCatalog): Promise<void> {
    try {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      const cachePath = this.getCachePath();
      await fs.promises.writeFile(cachePath, JSON.stringify(cache, null, 2));
    } catch (error) {
      logger.warn('Failed to save OpenAI catalog cache', { error });
    }
  }

  private isCacheStale(cache: CachedCatalog): boolean {
    const fetchedAt = new Date(cache._meta.fetchedAt);
    const now = new Date();
    return now.getTime() - fetchedAt.getTime() > OpenAIDynamicProvider.CACHE_TTL_MS;
  }

  private getCachePath(): string {
    return path.join(this.cacheDir, `openai-${this.instanceId}.json`);
  }
}
