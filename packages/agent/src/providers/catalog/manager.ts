// ABOUTME: Manages provider catalogs from shipped data and user extensions
// ABOUTME: Provides unified interface for browsing available providers and models

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir } from '@lace/agent/config/lace-dir';
import { CatalogProvider, CatalogProviderSchema, CatalogModel } from './types';
import { resolveDataDirectory } from '@lace/agent/utils/resource-resolver';
import { logger } from '@lace/agent/utils/logger';

// Helper function to read and validate provider catalog JSON
async function readProviderCatalog(filePath: string): Promise<CatalogProvider> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return CatalogProviderSchema.parse(JSON.parse(content));
}

// Load builtin provider catalogs from embedded files or filesystem
async function loadBuiltinProviderCatalogs(): Promise<CatalogProvider[]> {
  const catalogs: CatalogProvider[] = [];

  // Try Bun embedded files first (only if available)
  if (typeof Bun !== 'undefined' && 'embeddedFiles' in Bun && Bun.embeddedFiles) {
    for (const file of Bun.embeddedFiles) {
      if (
        (file as File).name.includes('providers/catalog/data') &&
        (file as File).name.endsWith('.json')
      ) {
        try {
          const content = await file.text();
          const provider = CatalogProviderSchema.parse(JSON.parse(content));
          catalogs.push(provider);
        } catch (error) {
          logger.warn('catalog.load.embedded_failed', {
            fileName: (file as File).name,
            error: String(error),
          });
        }
      }
    }

    if (catalogs.length > 0) {
      logger.info('catalog.load.complete', { count: catalogs.length, mode: 'embedded' });
      return catalogs;
    }
  }

  // Original working filesystem approach (Node.js/test/development)
  const catalogDir = resolveDataDirectory(import.meta.url);

  try {
    const files = await fs.promises.readdir(catalogDir);

    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        const filePath = path.join(catalogDir, file);
        const provider = await readProviderCatalog(filePath);
        catalogs.push(provider);
      } catch (error) {
        logger.warn('catalog.load.builtin_failed', { file, error: String(error) });
      }
    }
  } catch (error) {
    logger.warn('catalog.load.read_dir_failed', { dir: catalogDir, error: String(error) });
  }

  return catalogs;
}

export class ProviderCatalogManager {
  private userCatalogDir: string;
  private catalogCache: Map<string, CatalogProvider> = new Map();
  private modelGatingFile: string;
  private modelGating = new Map<string, { enabled?: string[]; disabled?: string[] }>();

  constructor() {
    this.userCatalogDir = path.join(getLaceDir(), 'user-catalog');
    this.modelGatingFile = path.join(getLaceDir(), 'provider-model-gating.json');
  }

  async loadCatalogs(): Promise<void> {
    this.catalogCache.clear();
    this.modelGating.clear();

    // Load builtin catalogs from filesystem
    const builtinCatalogs = await loadBuiltinProviderCatalogs();
    for (const provider of builtinCatalogs) {
      this.catalogCache.set(provider.id, provider);
    }

    // Load user catalog extensions (override shipped if same ID)
    if (await this.directoryExists(this.userCatalogDir)) {
      await this.loadCatalogDirectory(this.userCatalogDir);
    }

    await this.loadModelGating();
  }

  private async loadCatalogDirectory(dirPath: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(dirPath);

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(dirPath, file);
            const provider = await readProviderCatalog(filePath);
            this.catalogCache.set(provider.id, provider);
          } catch (_error) {
            logger.warn('catalog.load.user_failed', { dir: dirPath, file, error: String(_error) });
          }
        }
      }
    } catch (_error) {
      // Directory doesn't exist or can't be read, just continue
    }
  }

  getAvailableProviders(): CatalogProvider[] {
    return Array.from(this.catalogCache.values());
  }

  getProvider(providerId: string): CatalogProvider | null {
    return this.catalogCache.get(providerId) || null;
  }

  getProviderModels(providerId: string): CatalogModel[] {
    const provider = this.getProvider(providerId);
    return provider?.models || [];
  }

  getModel(providerId: string, modelId: string): CatalogModel | null {
    const models = this.getProviderModels(providerId);
    return models.find((m) => m.id === modelId) || null;
  }

  async saveUserCatalog(providerId: string, provider: CatalogProvider): Promise<void> {
    await fs.promises.mkdir(this.userCatalogDir, { recursive: true });
    const filePath = path.join(this.userCatalogDir, `${providerId}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(provider, null, 2));

    // Update cache
    this.catalogCache.set(provider.id, provider);
  }

  getModelGating(providerId: string): { enabled?: string[]; disabled?: string[] } {
    const gating = this.modelGating.get(providerId);
    return gating ? { ...gating } : {};
  }

  async setModelGating(
    providerId: string,
    gating: { enabled?: string[]; disabled?: string[] }
  ): Promise<void> {
    const unique = (arr?: string[]) =>
      arr ? Array.from(new Set(arr.filter((s) => s && s.trim().length > 0))) : undefined;

    const normalized = {
      enabled: unique(gating.enabled),
      disabled: unique(gating.disabled),
    };

    this.modelGating.set(providerId, normalized);
    await this.saveModelGating();
  }

  applyModelGating(providerId: string, models: CatalogModel[]): CatalogModel[] {
    const gating = this.modelGating.get(providerId);
    if (!gating) return models;

    if (gating.disabled && gating.disabled.length > 0) {
      const block = new Set(gating.disabled);
      return models.filter((m) => !block.has(m.id));
    }

    return models;
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async loadModelGating(): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.modelGatingFile, 'utf8');
      const parsed = JSON.parse(content) as Record<
        string,
        { enabled?: string[]; disabled?: string[] }
      >;
      for (const [providerId, gating] of Object.entries(parsed)) {
        this.modelGating.set(providerId, {
          enabled: Array.isArray(gating.enabled) ? gating.enabled : undefined,
          disabled: Array.isArray(gating.disabled) ? gating.disabled : undefined,
        });
      }
    } catch {
      // ignore missing/invalid file
    }
  }

  private async saveModelGating(): Promise<void> {
    const obj: Record<string, { enabled?: string[]; disabled?: string[] }> = {};
    for (const [providerId, gating] of this.modelGating.entries()) {
      obj[providerId] = {};
      if (gating.enabled && gating.enabled.length > 0) obj[providerId].enabled = gating.enabled;
      if (gating.disabled && gating.disabled.length > 0) obj[providerId].disabled = gating.disabled;
    }

    await fs.promises.mkdir(path.dirname(this.modelGatingFile), { recursive: true });
    await fs.promises.writeFile(this.modelGatingFile, JSON.stringify(obj, null, 2), 'utf8');
  }
}
