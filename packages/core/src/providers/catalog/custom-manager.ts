// ABOUTME: Comprehensive custom provider catalog management system
// ABOUTME: Provides CRUD operations, validation, templates, and import/export for user catalogs

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir } from '~/config/lace-dir';
import {
  CatalogProvider,
  CatalogProviderSchema,
  CatalogModel,
  CatalogModelSchema,
} from '~/providers/catalog/types';
import { ProviderCatalogManager } from '~/providers/catalog/manager';
import { logger } from '~/utils/logger';

interface CustomCatalogTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
  template: Partial<CatalogProvider>;
}

interface CatalogValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface CatalogImportResult {
  success: boolean;
  catalogId: string;
  errors: string[];
  warnings: string[];
}

export class CustomProviderCatalogManager {
  private catalogManager: ProviderCatalogManager;
  private userCatalogDir: string;
  private backupDir: string;

  constructor(catalogManager: ProviderCatalogManager) {
    this.catalogManager = catalogManager;
    this.userCatalogDir = path.join(getLaceDir(), 'user-catalog');
    this.backupDir = path.join(getLaceDir(), 'catalog-backups');
  }

  /**
   * Create a new custom provider catalog
   */
  async createCatalog(catalogData: Partial<CatalogProvider>): Promise<CatalogProvider> {
    // Validate required fields
    if (!catalogData.id || !catalogData.name || !catalogData.type) {
      throw new Error('Missing required fields: id, name, and type are required');
    }

    // Check if catalog already exists
    const existing = this.catalogManager.getProvider(catalogData.id);
    if (existing) {
      throw new Error(`Catalog with ID '${catalogData.id}' already exists`);
    }

    // Create complete catalog with defaults
    const catalog: CatalogProvider = {
      id: catalogData.id,
      name: catalogData.name,
      type: catalogData.type,
      default_large_model_id: catalogData.default_large_model_id || '',
      default_small_model_id: catalogData.default_small_model_id || '',
      models: catalogData.models || [],
      ...catalogData,
    };

    // Validate the complete catalog
    const validation = this.validateCatalog(catalog);
    if (!validation.isValid) {
      throw new Error(`Catalog validation failed: ${validation.errors.join(', ')}`);
    }

    // Save to filesystem
    await this.saveCatalog(catalog);

    logger.info('Created custom provider catalog', {
      catalogId: catalog.id,
      name: catalog.name,
      type: catalog.type,
      modelCount: catalog.models.length,
    });

    return catalog;
  }

  /**
   * Update an existing custom catalog
   */
  async updateCatalog(
    catalogId: string,
    updates: Partial<CatalogProvider>
  ): Promise<CatalogProvider> {
    const existing = this.catalogManager.getProvider(catalogId);
    if (!existing) {
      throw new Error(`Catalog with ID '${catalogId}' not found`);
    }

    // Check if this is a user catalog (can be modified)
    const isUserCatalog = await this.isUserCatalog(catalogId);
    if (!isUserCatalog) {
      throw new Error(
        `Cannot modify built-in catalog '${catalogId}'. Create a custom catalog instead.`
      );
    }

    // Create backup before updating
    await this.backupCatalog(catalogId);

    // Merge updates with existing catalog
    const updated: CatalogProvider = {
      ...existing,
      ...updates,
      id: catalogId, // Prevent ID changes
    };

    // Validate updated catalog
    const validation = this.validateCatalog(updated);
    if (!validation.isValid) {
      throw new Error(`Catalog validation failed: ${validation.errors.join(', ')}`);
    }

    // Save updated catalog
    await this.saveCatalog(updated);

    logger.info('Updated custom provider catalog', {
      catalogId: updated.id,
      changes: Object.keys(updates),
    });

    return updated;
  }

  /**
   * Delete a custom catalog
   */
  async deleteCatalog(catalogId: string): Promise<void> {
    const existing = this.catalogManager.getProvider(catalogId);
    if (!existing) {
      throw new Error(`Catalog with ID '${catalogId}' not found`);
    }

    // Check if this is a user catalog (can be deleted)
    const isUserCatalog = await this.isUserCatalog(catalogId);
    if (!isUserCatalog) {
      throw new Error(`Cannot delete built-in catalog '${catalogId}'`);
    }

    // Create backup before deleting
    await this.backupCatalog(catalogId);

    // Delete catalog file
    const catalogPath = path.join(this.userCatalogDir, `${catalogId}.json`);
    await fs.promises.unlink(catalogPath);

    // Reload catalogs to update cache
    await this.catalogManager.loadCatalogs();

    logger.info('Deleted custom provider catalog', { catalogId });
  }

  /**
   * Add a model to an existing catalog
   */
  async addModel(catalogId: string, model: CatalogModel): Promise<CatalogProvider> {
    const catalog = this.catalogManager.getProvider(catalogId);
    if (!catalog) {
      throw new Error(`Catalog with ID '${catalogId}' not found`);
    }

    // Check if model already exists
    const existingModel = catalog.models.find((m) => m.id === model.id);
    if (existingModel) {
      throw new Error(`Model with ID '${model.id}' already exists in catalog '${catalogId}'`);
    }

    // Validate model
    const validatedModel = CatalogModelSchema.parse(model);

    // Add model to catalog
    const updatedCatalog = {
      ...catalog,
      models: [...catalog.models, validatedModel],
    };

    return this.updateCatalog(catalogId, updatedCatalog);
  }

  /**
   * Update a model in an existing catalog
   */
  async updateModel(
    catalogId: string,
    modelId: string,
    updates: Partial<CatalogModel>
  ): Promise<CatalogProvider> {
    const catalog = this.catalogManager.getProvider(catalogId);
    if (!catalog) {
      throw new Error(`Catalog with ID '${catalogId}' not found`);
    }

    const modelIndex = catalog.models.findIndex((m) => m.id === modelId);
    if (modelIndex === -1) {
      throw new Error(`Model with ID '${modelId}' not found in catalog '${catalogId}'`);
    }

    // Update model
    const updatedModels = [...catalog.models];
    updatedModels[modelIndex] = {
      ...updatedModels[modelIndex],
      ...updates,
      id: modelId, // Prevent ID changes
    };

    // Validate updated model
    CatalogModelSchema.parse(updatedModels[modelIndex]);

    const updatedCatalog = {
      ...catalog,
      models: updatedModels,
    };

    return this.updateCatalog(catalogId, updatedCatalog);
  }

  /**
   * Remove a model from a catalog
   */
  async removeModel(catalogId: string, modelId: string): Promise<CatalogProvider> {
    const catalog = this.catalogManager.getProvider(catalogId);
    if (!catalog) {
      throw new Error(`Catalog with ID '${catalogId}' not found`);
    }

    const modelExists = catalog.models.some((m) => m.id === modelId);
    if (!modelExists) {
      throw new Error(`Model with ID '${modelId}' not found in catalog '${catalogId}'`);
    }

    // Check if model is used as default
    if (catalog.default_large_model_id === modelId || catalog.default_small_model_id === modelId) {
      throw new Error(`Cannot remove model '${modelId}' as it is set as a default model`);
    }

    const updatedCatalog = {
      ...catalog,
      models: catalog.models.filter((m) => m.id !== modelId),
    };

    return this.updateCatalog(catalogId, updatedCatalog);
  }

  /**
   * Validate a catalog structure
   */
  validateCatalog(catalog: CatalogProvider): CatalogValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Schema validation
      CatalogProviderSchema.parse(catalog);
    } catch (error) {
      if (error instanceof Error) {
        errors.push(`Schema validation failed: ${error.message}`);
      }
    }

    // Business logic validation
    if (catalog.models.length === 0) {
      warnings.push('Catalog has no models defined');
    }

    // Check default models exist
    if (
      catalog.default_large_model_id &&
      !catalog.models.some((m) => m.id === catalog.default_large_model_id)
    ) {
      errors.push(`Default large model '${catalog.default_large_model_id}' not found in models`);
    }

    if (
      catalog.default_small_model_id &&
      !catalog.models.some((m) => m.id === catalog.default_small_model_id)
    ) {
      errors.push(`Default small model '${catalog.default_small_model_id}' not found in models`);
    }

    // Check for duplicate model IDs
    const modelIds = catalog.models.map((m) => m.id);
    const duplicateIds = modelIds.filter((id, index) => modelIds.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      errors.push(`Duplicate model IDs found: ${duplicateIds.join(', ')}`);
    }

    // Check for reasonable cost values
    for (const model of catalog.models) {
      if (model.cost_per_1m_in > 1000) {
        warnings.push(`Model '${model.id}' has very high input cost: $${model.cost_per_1m_in}`);
      }
      if (model.cost_per_1m_out > 5000) {
        warnings.push(`Model '${model.id}' has very high output cost: $${model.cost_per_1m_out}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Import a catalog from JSON
   */
  async importCatalog(
    catalogJson: string,
    options: { overwrite?: boolean } = {}
  ): Promise<CatalogImportResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const catalogData = JSON.parse(catalogJson) as CatalogProvider;

      // Validate structure
      const validation = this.validateCatalog(catalogData);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);

      if (validation.isValid) {
        // Check if catalog exists
        const exists = this.catalogManager.getProvider(catalogData.id);
        if (exists && !options.overwrite) {
          errors.push(
            `Catalog '${catalogData.id}' already exists. Use overwrite option to replace it.`
          );
        }

        if (errors.length === 0) {
          if (exists && options.overwrite) {
            await this.updateCatalog(catalogData.id, catalogData);
            warnings.push(`Overwrote existing catalog '${catalogData.id}'`);
          } else {
            await this.createCatalog(catalogData);
          }

          return {
            success: true,
            catalogId: catalogData.id,
            errors,
            warnings,
          };
        }
      }

      return {
        success: false,
        catalogId: catalogData.id || 'unknown',
        errors,
        warnings,
      };
    } catch (error) {
      return {
        success: false,
        catalogId: 'unknown',
        errors: [
          `JSON parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
        warnings,
      };
    }
  }

  /**
   * Export a catalog to JSON
   */
  exportCatalog(catalogId: string): string {
    const catalog = this.catalogManager.getProvider(catalogId);
    if (!catalog) {
      throw new Error(`Catalog with ID '${catalogId}' not found`);
    }

    return JSON.stringify(catalog, null, 2);
  }

  /**
   * Get available catalog templates
   */
  getTemplates(): CustomCatalogTemplate[] {
    return [
      {
        id: 'openai-compatible',
        name: 'OpenAI Compatible API',
        description: 'Template for OpenAI-compatible providers (like Groq, Together, etc.)',
        type: 'openai',
        template: {
          type: 'openai',
          api_endpoint: 'https://api.example.com/v1',
          models: [
            {
              id: 'example-model',
              name: 'Example Model',
              cost_per_1m_in: 0.5,
              cost_per_1m_out: 1.5,
              context_window: 8192,
              default_max_tokens: 4096,
              can_reason: false,
              supports_attachments: false,
            },
          ],
        },
      },
      {
        id: 'anthropic-compatible',
        name: 'Anthropic Compatible API',
        description: 'Template for Anthropic-compatible providers',
        type: 'anthropic',
        template: {
          type: 'anthropic',
          api_endpoint: 'https://api.example.com',
          models: [
            {
              id: 'example-claude',
              name: 'Example Claude Model',
              cost_per_1m_in: 3.0,
              cost_per_1m_out: 15.0,
              context_window: 200000,
              default_max_tokens: 8192,
              can_reason: false,
              supports_attachments: true,
            },
          ],
        },
      },
      {
        id: 'local-server',
        name: 'Local Server',
        description: 'Template for local AI servers (Ollama, LMStudio, etc.)',
        type: 'ollama',
        template: {
          type: 'ollama',
          api_endpoint: 'http://localhost:11434',
          models: [
            {
              id: 'local-model',
              name: 'Local Model',
              cost_per_1m_in: 0.0,
              cost_per_1m_out: 0.0,
              context_window: 4096,
              default_max_tokens: 2048,
              can_reason: false,
              supports_attachments: false,
            },
          ],
        },
      },
    ];
  }

  /**
   * Create catalog from template
   */
  async createFromTemplate(
    templateId: string,
    catalogId: string,
    catalogName: string
  ): Promise<CatalogProvider> {
    const template = this.getTemplates().find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`Template with ID '${templateId}' not found`);
    }

    const catalogData: Partial<CatalogProvider> = {
      ...template.template,
      id: catalogId,
      name: catalogName,
      default_large_model_id: template.template.models?.[0]?.id || '',
      default_small_model_id: template.template.models?.[0]?.id || '',
    };

    return this.createCatalog(catalogData);
  }

  /**
   * List all user-created catalogs
   */
  async getUserCatalogs(): Promise<CatalogProvider[]> {
    const allCatalogs = this.catalogManager.getAvailableProviders();
    const userCatalogs: CatalogProvider[] = [];

    for (const catalog of allCatalogs) {
      if (await this.isUserCatalog(catalog.id)) {
        userCatalogs.push(catalog);
      }
    }

    return userCatalogs;
  }

  /**
   * Get catalog statistics
   */
  getCatalogStats(catalogId: string): {
    modelCount: number;
    avgInputCost: number;
    avgOutputCost: number;
    minContextWindow: number;
    maxContextWindow: number;
    reasoningModels: number;
    attachmentSupport: number;
  } {
    const catalog = this.catalogManager.getProvider(catalogId);
    if (!catalog) {
      throw new Error(`Catalog with ID '${catalogId}' not found`);
    }

    const models = catalog.models;
    const inputCosts = models.map((m) => m.cost_per_1m_in);
    const outputCosts = models.map((m) => m.cost_per_1m_out);
    const contextWindows = models.map((m) => m.context_window);

    return {
      modelCount: models.length,
      avgInputCost: inputCosts.reduce((a, b) => a + b, 0) / inputCosts.length || 0,
      avgOutputCost: outputCosts.reduce((a, b) => a + b, 0) / outputCosts.length || 0,
      minContextWindow: Math.min(...contextWindows),
      maxContextWindow: Math.max(...contextWindows),
      reasoningModels: models.filter((m) => m.can_reason).length,
      attachmentSupport: models.filter((m) => m.supports_attachments).length,
    };
  }

  /**
   * Private helper methods
   */
  private async saveCatalog(catalog: CatalogProvider): Promise<void> {
    await fs.promises.mkdir(this.userCatalogDir, { recursive: true });
    const filePath = path.join(this.userCatalogDir, `${catalog.id}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(catalog, null, 2));

    // Update the main catalog manager cache
    await this.catalogManager.loadCatalogs();
  }

  private async isUserCatalog(catalogId: string): Promise<boolean> {
    const filePath = path.join(this.userCatalogDir, `${catalogId}.json`);
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async backupCatalog(catalogId: string): Promise<void> {
    const catalog = this.catalogManager.getProvider(catalogId);
    if (!catalog) return;

    await fs.promises.mkdir(this.backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.backupDir, `${catalogId}-${timestamp}.json`);
    await fs.promises.writeFile(backupPath, JSON.stringify(catalog, null, 2));

    logger.info('Created catalog backup', { catalogId, backupPath });
  }
}
