// ABOUTME: Manages provider catalogs from shipped data and user extensions
// ABOUTME: Provides unified interface for browsing available providers and models

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getLaceDir } from '~/config/lace-dir';
import { CatalogProvider, CatalogProviderSchema, CatalogModel } from '~/providers/catalog/types';

// Load builtin provider catalogs from filesystem (server-side)
async function loadBuiltinProviderCatalogs(): Promise<CatalogProvider[]> {
  const catalogs: CatalogProvider[] = [];
  
  // Use the same pattern as prompt templates - get current module directory + data
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const catalogDir = path.join(currentDir, 'data');
  
  try {
    const files = await fs.promises.readdir(catalogDir);
    
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const filePath = path.join(catalogDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const provider = CatalogProviderSchema.parse(JSON.parse(content));
        catalogs.push(provider);
      } catch (error) {
        console.warn(`Failed to load catalog file ${file}:`, error);
      }
    }
  } catch (error) {
    console.warn('Failed to read catalog directory:', error);
  }
  
  return catalogs;
}

export class ProviderCatalogManager {
  private shippedCatalogDir: string;
  private userCatalogDir: string;
  private catalogCache: Map<string, CatalogProvider> = new Map();

  constructor() {
    this.shippedCatalogDir = path.resolve(__dirname, 'data');
    this.userCatalogDir = path.join(getLaceDir(), 'user-catalog');
  }

  async loadCatalogs(): Promise<void> {
    this.catalogCache.clear();

    // Load builtin catalogs from filesystem
    const builtinCatalogs = await loadBuiltinProviderCatalogs();
    for (const provider of builtinCatalogs) {
      this.catalogCache.set(provider.id, provider);
    }

    // Load user catalog extensions (override shipped if same ID)
    if (await this.directoryExists(this.userCatalogDir)) {
      await this.loadCatalogDirectory(this.userCatalogDir);
    }
  }

  private async loadCatalogDirectory(dirPath: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(dirPath);

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(dirPath, file);
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const provider = CatalogProviderSchema.parse(JSON.parse(content));
            this.catalogCache.set(provider.id, provider);
          } catch (_error) {
            console.warn(`Failed to load catalog file ${file}:`, _error);
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

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
