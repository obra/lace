// ABOUTME: Cache manager for OpenRouter model catalogs
// ABOUTME: Handles saving, loading, and staleness detection for cached API responses

import * as fs from 'fs';
import * as path from 'path';
import type { OpenRouterModel } from '~/providers/openrouter/types';

export interface CachedCatalog {
  _meta: {
    fetchedAt: string;
    version: string;
    modelCount: number;
    source: string;
  };
  provider: {
    name: string;
    id: string;
    models: OpenRouterModel[];
  };
}

export class CatalogCacheManager {
  private cacheDir: string;
  private maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(baseDir: string) {
    this.cacheDir = path.join(baseDir, 'catalogs');
  }

  async save(instanceId: string, catalog: CachedCatalog): Promise<void> {
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
    const filePath = this.getCachePath(instanceId);
    await fs.promises.writeFile(filePath, JSON.stringify(catalog, null, 2));
  }

  async load(instanceId: string): Promise<CachedCatalog | null> {
    try {
      const filePath = this.getCachePath(instanceId);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as CachedCatalog;
    } catch (_error) {
      return null;
    }
  }

  async isStale(instanceId: string, maxAgeMs?: number): Promise<boolean> {
    const catalog = await this.load(instanceId);
    if (!catalog) return true;

    const age = Date.now() - new Date(catalog._meta.fetchedAt).getTime();
    return age > (maxAgeMs ?? this.maxAgeMs);
  }

  private getCachePath(instanceId: string): string {
    return path.join(this.cacheDir, `openrouter-${instanceId}.json`);
  }
}
