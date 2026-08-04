// ABOUTME: Dynamic provider for Anthropic that filters static catalog by API availability
// ABOUTME: Combines API client and static catalog to show only currently available models

import { AnthropicClient } from './client';
import type { AnthropicModel } from './types';
import type { CatalogProvider, CatalogModel } from '../catalog/types';
import { getLaceDir } from '@lace/agent/config/lace-dir';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '@lace/agent/utils/logger';

// Fallbacks for a model the static catalog does not describe. Both are guesses;
// they are sized so a wrong guess degrades cost, not correctness. A too-small
// output budget is the dangerous direction — thinking tokens count against
// max_tokens, so a low cap truncates a turn mid-answer with no error.
const INFERRED_MAX_OUTPUT_TOKENS = 32_000;
const INFERRED_CONTEXT_WINDOW = 200_000;

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
    // Check cache first (unless force refresh). A cache hit is reconciled
    // against the CURRENT static catalog rather than returned as-is: the TTL is
    // 24h, so a cache written before a deploy that ADDS a model would otherwise
    // keep serving that model's inferred placeholder metadata long after the
    // real entry shipped. That is not cosmetic — an inferred entry carries a
    // deliberately conservative output cap, and with adaptive thinking counted
    // against max_tokens a too-small cap truncates turns instead of erroring.
    if (!forceRefresh) {
      const cached = await this.loadCache();
      if (cached && !this.isCacheStale(cached)) {
        return this.reconcileWithStatic(cached.provider, staticCatalog);
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

  /**
   * Metadata for a model the API reports but the static catalog has never heard
   * of. Everything here is a guess, so it is deliberately shaped to fail loudly
   * rather than quietly: the output budget is large enough that a real turn is
   * not truncated mid-response (a small "conservative" cap is the more harmful
   * guess — with thinking counted against max_tokens it silently cuts answers
   * off), and the context window follows the current-generation default.
   *
   * The right fix for any model that shows up here is a static catalog entry.
   */
  private inferModelMetadata(apiModel: AnthropicModel): CatalogModel {
    return {
      id: apiModel.id,
      name: apiModel.display_name,
      context_window: INFERRED_CONTEXT_WINDOW,
      default_max_tokens: INFERRED_MAX_OUTPUT_TOKENS,
    };
  }

  /**
   * Merge a cached (or otherwise inferred) catalog with the current static one:
   * availability comes from the cache, metadata from the static catalog whenever
   * it knows the model. Never widens availability — a model absent from the
   * cache stays absent.
   */
  private reconcileWithStatic(
    cachedProvider: CatalogProvider,
    staticCatalog: CatalogProvider
  ): CatalogProvider {
    const staticById = new Map(staticCatalog.models.map((m) => [m.id, m]));
    let upgraded = 0;
    const models = cachedProvider.models.map((cachedModel) => {
      const staticModel = staticById.get(cachedModel.id);
      if (!staticModel) return cachedModel;
      if (staticModel !== cachedModel) upgraded += 1;
      return staticModel;
    });
    if (upgraded > 0) {
      logger.debug('Reconciled cached Anthropic catalog against static metadata', {
        instanceId: this.instanceId,
        upgraded,
      });
    }
    return { ...cachedProvider, models };
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
