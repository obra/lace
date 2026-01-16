// ABOUTME: Dynamic provider for OpenAI that filters static catalog by API availability
// ABOUTME: Combines API client and static catalog to show only currently available models

import { OpenAIClient } from './client';
import type { CatalogProvider, CatalogModel } from '../catalog/types';
import type { OpenAIModel } from './types';
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

export class OpenAIDynamicProvider {
  private client: OpenAIClient;
  private cacheDir: string;
  private instanceId: string;
  private baseUrl?: string;
  // Cache TTL: 24 hours - balances freshness with API rate limits.
  // OpenAI model availability rarely changes, and we gracefully fall back to static catalog on errors.
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(instanceId: string, baseUrl?: string) {
    this.instanceId = instanceId;
    this.baseUrl = baseUrl;
    this.client = new OpenAIClient(baseUrl);
    this.cacheDir = path.join(getLaceDir(), 'catalogs');
  }

  async getCatalog(
    apiKey: string,
    staticCatalog: CatalogProvider,
    forceRefresh = false
  ): Promise<CatalogProvider> {
    // Check cache first (unless force refresh)
    // Note: Potential race condition if multiple concurrent requests hit stale/missing cache.
    // Both will fetch from API simultaneously. This is acceptable because:
    // 1. Duplicate fetches are idempotent and infrequent (24hr TTL)
    // 2. File system writes are atomic (last write wins)
    // 3. Adding deduplication adds complexity for minimal benefit
    if (!forceRefresh) {
      const cached = await this.loadCache();
      if (cached && !this.isCacheStale(cached)) {
        return cached.provider;
      }
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
      // Fall back to cache if available (even if stale), otherwise use full static catalog
      const cached = await this.loadCache();
      return cached?.provider ?? staticCatalog;
    }
  }

  /**
   * Determines if a model supports chat-style APIs (Chat Completions or Responses API).
   * Filters out known non-chat models (embeddings, audio, image, legacy completions).
   * Unknown models are included by default - if a new model appears, let users try it.
   */
  private isChatCompatibleModel(modelId: string): boolean {
    // Explicit exclusion patterns - these never work with chat APIs
    const excludePatterns = [
      /^text-embedding-/, // Embedding models
      /^whisper/, // Speech-to-text
      /^tts-/, // Text-to-speech
      /^dall-e/, // Image generation
      /-embed-/, // Any embed model
      /^babbage/, // Legacy completion models
      /^davinci/, // Legacy completion models (without gpt prefix)
      /^curie/, // Legacy completion models
      /^ada$/, // Legacy ada model (exact match)
      /^gpt-3\.5-turbo-instruct/, // Completion-only instruct model
      /^ft:davinci/, // Fine-tuned legacy models
      /^ft:babbage/, // Fine-tuned legacy models
      /^ft:curie/, // Fine-tuned legacy models
      /^ft:ada/, // Fine-tuned legacy models
      /^text-davinci/, // Legacy text completion models
      /^text-curie/, // Legacy text completion models
      /^text-babbage/, // Legacy text completion models
      /^text-ada/, // Legacy text completion models
      /^code-davinci/, // Legacy code completion models
      /^code-cushman/, // Legacy code completion models
      /-search-/, // Search/embedding models
      /-similarity-/, // Similarity models
      /^moderation/, // Content moderation models
      /^omni-moderation/, // Content moderation models
    ];

    for (const pattern of excludePatterns) {
      if (pattern.test(modelId)) {
        return false;
      }
    }

    // Unknown models are included by default - let users try new models
    return true;
  }

  private filterStaticCatalog(
    staticCatalog: CatalogProvider,
    availableModels: OpenAIModel[]
  ): CatalogProvider {
    // Create lookup map for static catalog models
    const staticModelsMap = new Map(staticCatalog.models.map((m) => [m.id, m]));

    // Filter to only chat-compatible models, then enrich with metadata
    const chatCompatibleModels = availableModels.filter((apiModel) => {
      // If it's in the static catalog, it's been manually verified as chat-compatible
      if (staticModelsMap.has(apiModel.id)) {
        return true;
      }
      // Otherwise, use heuristic detection
      return this.isChatCompatibleModel(apiModel.id);
    });

    const discoveredModels = chatCompatibleModels.map((apiModel) => {
      const staticModel = staticModelsMap.get(apiModel.id);

      if (staticModel) {
        // Use full metadata from static catalog
        return staticModel;
      }

      // Infer metadata for unknown model
      return this.inferModelMetadata(apiModel);
    });

    const filteredCount = availableModels.length - chatCompatibleModels.length;

    logger.info('Discovered OpenAI models with chat-compatibility filtering', {
      staticCount: staticCatalog.models.length,
      availableCount: availableModels.length,
      filteredOutCount: filteredCount,
      enrichedCount: discoveredModels.filter((m) => staticModelsMap.has(m.id)).length,
      inferredCount: discoveredModels.filter((m) => !staticModelsMap.has(m.id)).length,
      totalCount: discoveredModels.length,
    });

    return {
      ...staticCatalog,
      models: discoveredModels,
    };
  }

  private inferModelMetadata(apiModel: OpenAIModel): CatalogModel {
    const modelId = apiModel.id;

    // Minimal metadata for unknown models - users should check OpenAI docs for pricing details
    // Omit pricing fields to indicate unknown cost (rather than showing as free)
    return {
      id: modelId,
      name: this.formatModelName(modelId),
      context_window: 128000, // Conservative default
      default_max_tokens: 4096, // Conservative default
    };
  }

  private formatModelName(modelId: string): string {
    // Convert model ID to human-readable name with original ID in parens
    // e.g., "gpt-4o-mini" -> "GPT-4o Mini (gpt-4o-mini)"
    const formatted = modelId
      .split('-')
      .map((part) => {
        // Keep special prefixes uppercase
        if (part === 'gpt' || part.startsWith('o')) {
          return part.toUpperCase();
        }
        // Capitalize first letter of other parts
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');

    return `${formatted} (${modelId})`;
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
