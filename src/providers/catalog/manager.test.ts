// ABOUTME: Tests for provider catalog manager
// ABOUTME: Validates catalog loading from shipped data and user extensions

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProviderCatalogManager } from './manager';

describe('ProviderCatalogManager', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;
  let manager: ProviderCatalogManager;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
    manager = new ProviderCatalogManager();
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

  describe('loadCatalogs', () => {
    it('loads built-in catalog data from shipped directory', async () => {
      await manager.loadCatalogs();
      
      const providers = manager.getAvailableProviders();
      expect(providers.length).toBeGreaterThan(0);
      
      // Should have Anthropic from shipped data
      const anthropic = manager.getProvider('anthropic');
      expect(anthropic).toBeTruthy();
      expect(anthropic?.name).toBe('Anthropic');
      expect(anthropic?.models.length).toBeGreaterThan(0);
    });

    it('loads user catalog extensions when they exist', async () => {
      // Create user catalog directory
      const userCatalogDir = path.join(tempDir, 'user-catalog');
      fs.mkdirSync(userCatalogDir, { recursive: true });

      // Create custom provider
      const customProvider = {
        name: 'Local Ollama',
        id: 'local-ollama',
        type: 'ollama',
        default_large_model_id: 'llama2',
        default_small_model_id: 'llama2',
        models: [
          {
            id: 'llama2',
            name: 'Llama 2',
            cost_per_1m_in: 0,
            cost_per_1m_out: 0,
            context_window: 4096,
            default_max_tokens: 2048,
          },
        ],
      };

      fs.writeFileSync(
        path.join(userCatalogDir, 'local-ollama.json'),
        JSON.stringify(customProvider, null, 2)
      );

      await manager.loadCatalogs();

      const customProviderLoaded = manager.getProvider('local-ollama');
      expect(customProviderLoaded).toBeTruthy();
      expect(customProviderLoaded?.name).toBe('Local Ollama');
    });

    it('handles user catalog overriding shipped catalog', async () => {
      // Create user catalog directory
      const userCatalogDir = path.join(tempDir, 'user-catalog');
      fs.mkdirSync(userCatalogDir, { recursive: true });

      // Create custom Anthropic override
      const customAnthropic = {
        name: 'Custom Anthropic',
        id: 'anthropic',
        type: 'anthropic',
        default_large_model_id: 'custom-model',
        default_small_model_id: 'custom-model',
        models: [
          {
            id: 'custom-model',
            name: 'Custom Model',
            cost_per_1m_in: 1,
            cost_per_1m_out: 2,
            context_window: 1000,
            default_max_tokens: 500,
          },
        ],
      };

      fs.writeFileSync(
        path.join(userCatalogDir, 'anthropic.json'),
        JSON.stringify(customAnthropic, null, 2)
      );

      await manager.loadCatalogs();

      const anthropic = manager.getProvider('anthropic');
      expect(anthropic?.name).toBe('Custom Anthropic'); // Should use user override
      expect(anthropic?.models[0]?.name).toBe('Custom Model');
    });

    it('handles invalid JSON files gracefully', async () => {
      const userCatalogDir = path.join(tempDir, 'user-catalog');
      fs.mkdirSync(userCatalogDir, { recursive: true });

      // Create invalid JSON file
      fs.writeFileSync(path.join(userCatalogDir, 'invalid.json'), '{ invalid json');

      // Should not throw, just warn
      await expect(manager.loadCatalogs()).resolves.not.toThrow();
      
      // Should still load valid providers
      const providers = manager.getAvailableProviders();
      expect(providers.length).toBeGreaterThan(0);
    });

    it('handles non-existent user catalog directory gracefully', async () => {
      // User catalog directory doesn't exist
      await expect(manager.loadCatalogs()).resolves.not.toThrow();
      
      const providers = manager.getAvailableProviders();
      expect(providers.length).toBeGreaterThan(0);
    });
  });

  describe('getProvider', () => {
    beforeEach(async () => {
      await manager.loadCatalogs();
    });

    it('returns provider by id', () => {
      const openai = manager.getProvider('openai');
      expect(openai).toBeTruthy();
      expect(openai?.id).toBe('openai');
      expect(openai?.name).toBe('OpenAI');
    });

    it('returns null for non-existent provider', () => {
      const nonExistent = manager.getProvider('non-existent');
      expect(nonExistent).toBeNull();
    });
  });

  describe('getProviderModels', () => {
    beforeEach(async () => {
      await manager.loadCatalogs();
    });

    it('returns models for existing provider', () => {
      const models = manager.getProviderModels('anthropic');
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('name');
      expect(models[0]).toHaveProperty('cost_per_1m_in');
    });

    it('returns empty array for non-existent provider', () => {
      const models = manager.getProviderModels('non-existent');
      expect(models).toEqual([]);
    });
  });

  describe('getModel', () => {
    beforeEach(async () => {
      await manager.loadCatalogs();
    });

    it('returns specific model from provider', () => {
      const model = manager.getModel('anthropic', 'claude-3-5-haiku-20241022');
      expect(model).toBeTruthy();
      expect(model?.id).toBe('claude-3-5-haiku-20241022');
      expect(model?.name).toBe('Claude 3.5 Haiku');
    });

    it('returns null for non-existent model', () => {
      const model = manager.getModel('anthropic', 'non-existent-model');
      expect(model).toBeNull();
    });

    it('returns null for model from non-existent provider', () => {
      const model = manager.getModel('non-existent', 'some-model');
      expect(model).toBeNull();
    });
  });

  describe('saveUserCatalog', () => {
    it('saves provider to user catalog directory', async () => {
      const customProvider = {
        name: 'Test Provider',
        id: 'test-provider',
        type: 'custom',
        default_large_model_id: 'test-model',
        default_small_model_id: 'test-model',
        models: [{
          id: 'test-model',
          name: 'Test Model',
          cost_per_1m_in: 1,
          cost_per_1m_out: 2,
          context_window: 1000,
          default_max_tokens: 500,
        }],
      };

      await manager.saveUserCatalog('test-provider', customProvider);

      // Verify file was created
      const userCatalogPath = path.join(tempDir, 'user-catalog', 'test-provider.json');
      expect(fs.existsSync(userCatalogPath)).toBe(true);

      // Verify content
      const savedContent = JSON.parse(fs.readFileSync(userCatalogPath, 'utf-8'));
      expect(savedContent).toEqual(customProvider);

      // Verify it's available in manager
      const provider = manager.getProvider('test-provider');
      expect(provider).toEqual(customProvider);
    });

    it('creates user catalog directory if it does not exist', async () => {
      const customProvider = {
        name: 'Test Provider',
        id: 'test-provider',
        type: 'custom',
        default_large_model_id: 'test-model',
        default_small_model_id: 'test-model',
        models: [],
      };

      // Ensure directory doesn't exist
      const userCatalogDir = path.join(tempDir, 'user-catalog');
      expect(fs.existsSync(userCatalogDir)).toBe(false);

      await manager.saveUserCatalog('test-provider', customProvider);

      // Directory should now exist
      expect(fs.existsSync(userCatalogDir)).toBe(true);
    });
  });
});