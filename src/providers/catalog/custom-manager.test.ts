// ABOUTME: Tests for custom provider catalog management system
// ABOUTME: Covers CRUD operations, validation, templates, and import/export functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CustomProviderCatalogManager } from '~/providers/catalog/custom-manager';
import { ProviderCatalogManager } from '~/providers/catalog/manager';
import { CatalogProvider, CatalogModel } from '~/providers/catalog/types';

describe('CustomProviderCatalogManager', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;
  let catalogManager: ProviderCatalogManager;
  let customManager: CustomProviderCatalogManager;

  beforeEach(async () => {
    // Setup temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-custom-catalog-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    // Create catalog managers
    catalogManager = new ProviderCatalogManager();
    customManager = new CustomProviderCatalogManager(catalogManager);

    // Initialize with empty catalogs
    await catalogManager.loadCatalogs();
  });

  afterEach(() => {
    // Cleanup
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createCatalog', () => {
    it('should create a new custom catalog', async () => {
      const catalogData: Partial<CatalogProvider> = {
        id: 'custom-test',
        name: 'Custom Test Provider',
        type: 'openai',
        default_large_model_id: 'test-large',
        default_small_model_id: 'test-small',
        models: [
          {
            id: 'test-large',
            name: 'Test Large Model',
            cost_per_1m_in: 1.0,
            cost_per_1m_out: 2.0,
            context_window: 8192,
            default_max_tokens: 4096,
          },
          {
            id: 'test-small',
            name: 'Test Small Model',
            cost_per_1m_in: 0.5,
            cost_per_1m_out: 1.0,
            context_window: 4096,
            default_max_tokens: 2048,
          }
        ]
      };

      const created = await customManager.createCatalog(catalogData);

      expect(created.id).toBe('custom-test');
      expect(created.name).toBe('Custom Test Provider');
      expect(created.models).toHaveLength(2);

      // Verify it was saved and can be retrieved
      const retrieved = catalogManager.getProvider('custom-test');
      expect(retrieved).toBeTruthy();
      expect(retrieved!.name).toBe('Custom Test Provider');
    });

    it('should reject catalog with missing required fields', async () => {
      const invalidCatalog = {
        name: 'Invalid Catalog'
        // Missing id and type
      };

      await expect(
        customManager.createCatalog(invalidCatalog)
      ).rejects.toThrow('Missing required fields: id, name, and type are required');
    });

    it('should reject catalog with duplicate ID', async () => {
      const catalogData: Partial<CatalogProvider> = {
        id: 'duplicate-test',
        name: 'First Catalog',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model1',
        models: [{
          id: 'model1',
          name: 'Model 1',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      };

      await customManager.createCatalog(catalogData);

      // Try to create another with same ID
      await expect(
        customManager.createCatalog({ ...catalogData, name: 'Second Catalog' })
      ).rejects.toThrow('Catalog with ID \'duplicate-test\' already exists');
    });
  });

  describe('updateCatalog', () => {
    beforeEach(async () => {
      // Create a test catalog to update
      await customManager.createCatalog({
        id: 'update-test',
        name: 'Update Test',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model1',
        models: [{
          id: 'model1',
          name: 'Model 1',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      });
    });

    it('should update an existing catalog', async () => {
      const updates = {
        name: 'Updated Test Catalog',
        api_endpoint: 'https://updated.example.com'
      };

      const updated = await customManager.updateCatalog('update-test', updates);

      expect(updated.name).toBe('Updated Test Catalog');
      expect(updated.api_endpoint).toBe('https://updated.example.com');
      expect(updated.id).toBe('update-test'); // ID should remain unchanged
    });

    it('should reject update for non-existent catalog', async () => {
      await expect(
        customManager.updateCatalog('non-existent', { name: 'New Name' })
      ).rejects.toThrow('Catalog with ID \'non-existent\' not found');
    });
  });

  describe('deleteCatalog', () => {
    beforeEach(async () => {
      await customManager.createCatalog({
        id: 'delete-test',
        name: 'Delete Test',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model1',
        models: [{
          id: 'model1',
          name: 'Model 1',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      });
    });

    it('should delete a custom catalog', async () => {
      // Verify catalog exists
      expect(catalogManager.getProvider('delete-test')).toBeTruthy();

      await customManager.deleteCatalog('delete-test');

      // Verify catalog is gone
      expect(catalogManager.getProvider('delete-test')).toBeNull();
    });

    it('should reject delete for non-existent catalog', async () => {
      await expect(
        customManager.deleteCatalog('non-existent')
      ).rejects.toThrow('Catalog with ID \'non-existent\' not found');
    });
  });

  describe('model management', () => {
    beforeEach(async () => {
      await customManager.createCatalog({
        id: 'model-test',
        name: 'Model Test',
        type: 'openai',
        default_large_model_id: 'existing-model',
        default_small_model_id: 'existing-model',
        models: [{
          id: 'existing-model',
          name: 'Existing Model',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      });
    });

    it('should add a model to a catalog', async () => {
      const newModel: CatalogModel = {
        id: 'new-model',
        name: 'New Model',
        cost_per_1m_in: 0.5,
        cost_per_1m_out: 1.0,
        context_window: 8192,
        default_max_tokens: 4096,
      };

      const updated = await customManager.addModel('model-test', newModel);

      expect(updated.models).toHaveLength(2);
      expect(updated.models.find(m => m.id === 'new-model')).toBeTruthy();
    });

    it('should reject adding duplicate model', async () => {
      const duplicateModel: CatalogModel = {
        id: 'existing-model',
        name: 'Duplicate Model',
        cost_per_1m_in: 0.5,
        cost_per_1m_out: 1.0,
        context_window: 8192,
        default_max_tokens: 4096,
      };

      await expect(
        customManager.addModel('model-test', duplicateModel)
      ).rejects.toThrow('Model with ID \'existing-model\' already exists');
    });

    it('should update a model in a catalog', async () => {
      const updates = {
        name: 'Updated Model Name',
        cost_per_1m_in: 1.5
      };

      const updated = await customManager.updateModel('model-test', 'existing-model', updates);

      const updatedModel = updated.models.find(m => m.id === 'existing-model');
      expect(updatedModel!.name).toBe('Updated Model Name');
      expect(updatedModel!.cost_per_1m_in).toBe(1.5);
    });

    it('should remove a model from a catalog', async () => {
      // First add another model to avoid removing the default
      await customManager.addModel('model-test', {
        id: 'removable-model',
        name: 'Removable Model',
        cost_per_1m_in: 0.5,
        cost_per_1m_out: 1.0,
        context_window: 4096,
        default_max_tokens: 2048,
      });

      const updated = await customManager.removeModel('model-test', 'removable-model');

      expect(updated.models).toHaveLength(1);
      expect(updated.models.find(m => m.id === 'removable-model')).toBeFalsy();
    });

    it('should reject removing default model', async () => {
      await expect(
        customManager.removeModel('model-test', 'existing-model')
      ).rejects.toThrow('Cannot remove model \'existing-model\' as it is set as a default model');
    });
  });

  describe('validation', () => {
    it('should validate a correct catalog', async () => {
      const validCatalog: CatalogProvider = {
        id: 'valid-test',
        name: 'Valid Test',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model1',
        models: [{
          id: 'model1',
          name: 'Model 1',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      };

      const result = await customManager.validateCatalog(validCatalog);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing default models', async () => {
      const invalidCatalog: CatalogProvider = {
        id: 'invalid-test',
        name: 'Invalid Test',
        type: 'openai',
        default_large_model_id: 'non-existent-model',
        default_small_model_id: 'model1',
        models: [{
          id: 'model1',
          name: 'Model 1',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      };

      const result = await customManager.validateCatalog(invalidCatalog);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Default large model \'non-existent-model\' not found in models');
    });

    it('should detect duplicate model IDs', async () => {
      const invalidCatalog: CatalogProvider = {
        id: 'duplicate-models-test',
        name: 'Duplicate Models Test',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model1',
        models: [
          {
            id: 'model1',
            name: 'Model 1',
            cost_per_1m_in: 1.0,
            cost_per_1m_out: 2.0,
            context_window: 4096,
            default_max_tokens: 2048,
          },
          {
            id: 'model1', // Duplicate ID
            name: 'Model 1 Duplicate',
            cost_per_1m_in: 1.0,
            cost_per_1m_out: 2.0,
            context_window: 4096,
            default_max_tokens: 2048,
          }
        ]
      };

      const result = await customManager.validateCatalog(invalidCatalog);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Duplicate model IDs found: model1');
    });
  });

  describe('import/export', () => {
    it('should import a valid catalog from JSON', async () => {
      const catalogJson = JSON.stringify({
        id: 'imported-test',
        name: 'Imported Test',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model1',
        models: [{
          id: 'model1',
          name: 'Model 1',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      });

      const result = await customManager.importCatalog(catalogJson);

      expect(result.success).toBe(true);
      expect(result.catalogId).toBe('imported-test');
      expect(result.errors).toHaveLength(0);

      // Verify catalog was created
      const imported = catalogManager.getProvider('imported-test');
      expect(imported).toBeTruthy();
    });

    it('should reject invalid JSON', async () => {
      const invalidJson = '{ invalid json';

      const result = await customManager.importCatalog(invalidJson);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/JSON parsing failed/);
    });

    it('should export a catalog to JSON', async () => {
      // Create a catalog to export
      await customManager.createCatalog({
        id: 'export-test',
        name: 'Export Test',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model1',
        models: [{
          id: 'model1',
          name: 'Model 1',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      });

      const exported = await customManager.exportCatalog('export-test');
      const parsed = JSON.parse(exported);

      expect(parsed.id).toBe('export-test');
      expect(parsed.name).toBe('Export Test');
      expect(parsed.models).toHaveLength(1);
    });
  });

  describe('templates', () => {
    it('should provide catalog templates', () => {
      const templates = customManager.getTemplates();

      expect(templates).toHaveLength(3);
      expect(templates.map(t => t.id)).toContain('openai-compatible');
      expect(templates.map(t => t.id)).toContain('anthropic-compatible');
      expect(templates.map(t => t.id)).toContain('local-server');
    });

    it('should create catalog from template', async () => {
      const created = await customManager.createFromTemplate(
        'openai-compatible',
        'from-template-test',
        'From Template Test'
      );

      expect(created.id).toBe('from-template-test');
      expect(created.name).toBe('From Template Test');
      expect(created.type).toBe('openai');
      expect(created.models).toHaveLength(1);
    });

    it('should reject unknown template', async () => {
      await expect(
        customManager.createFromTemplate('unknown-template', 'test', 'Test')
      ).rejects.toThrow('Template with ID \'unknown-template\' not found');
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      await customManager.createCatalog({
        id: 'stats-test',
        name: 'Stats Test',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model2',
        models: [
          {
            id: 'model1',
            name: 'Model 1',
            cost_per_1m_in: 1.0,
            cost_per_1m_out: 2.0,
            context_window: 4096,
            default_max_tokens: 2048,
            can_reason: true,
            supports_attachments: true,
          },
          {
            id: 'model2',
            name: 'Model 2',
            cost_per_1m_in: 2.0,
            cost_per_1m_out: 4.0,
            context_window: 8192,
            default_max_tokens: 4096,
            can_reason: false,
            supports_attachments: false,
          }
        ]
      });
    });

    it('should calculate catalog statistics', async () => {
      const stats = await customManager.getCatalogStats('stats-test');

      expect(stats.modelCount).toBe(2);
      expect(stats.avgInputCost).toBe(1.5);
      expect(stats.avgOutputCost).toBe(3.0);
      expect(stats.minContextWindow).toBe(4096);
      expect(stats.maxContextWindow).toBe(8192);
      expect(stats.reasoningModels).toBe(1);
      expect(stats.attachmentSupport).toBe(1);
    });
  });

  describe('getUserCatalogs', () => {
    it('should list only user-created catalogs', async () => {
      // Create user catalogs
      await customManager.createCatalog({
        id: 'user-catalog-1',
        name: 'User Catalog 1',
        type: 'openai',
        default_large_model_id: 'model1',
        default_small_model_id: 'model1',
        models: [{
          id: 'model1',
          name: 'Model 1',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 2.0,
          context_window: 4096,
          default_max_tokens: 2048,
        }]
      });

      await customManager.createCatalog({
        id: 'user-catalog-2',
        name: 'User Catalog 2',
        type: 'anthropic',
        default_large_model_id: 'model2',
        default_small_model_id: 'model2',
        models: [{
          id: 'model2',
          name: 'Model 2',
          cost_per_1m_in: 3.0,
          cost_per_1m_out: 15.0,
          context_window: 200000,
          default_max_tokens: 8192,
        }]
      });

      const userCatalogs = await customManager.getUserCatalogs();

      expect(userCatalogs).toHaveLength(2);
      expect(userCatalogs.map(c => c.id)).toContain('user-catalog-1');
      expect(userCatalogs.map(c => c.id)).toContain('user-catalog-2');
    });
  });
});