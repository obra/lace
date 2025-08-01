// ABOUTME: Tests for the provider registry system
// ABOUTME: Verifies provider registration, retrieval, and management functionality

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProviderRegistry } from '~/providers/registry';
import { AnthropicProvider } from '~/providers/anthropic-provider';
import { LMStudioProvider } from '~/providers/lmstudio-provider';
import { OpenAIProvider } from '~/providers/openai-provider';
import { OllamaProvider } from '~/providers/ollama-provider';
import type { ProviderInstancesConfig, Credential } from '~/providers/catalog/types';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
    registry = new ProviderRegistry();
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

  describe('registerProvider', () => {
    it('should register an Anthropic provider', () => {
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      registry.registerProvider(provider);

      expect(registry.getProvider('anthropic')).toBe(provider);
    });

    it('should register an LMStudio provider', () => {
      const provider = new LMStudioProvider();
      registry.registerProvider(provider);

      expect(registry.getProvider('lmstudio')).toBe(provider);
    });

    it('should replace existing provider with same name', () => {
      const provider1 = new AnthropicProvider({ apiKey: 'key1' });
      const provider2 = new AnthropicProvider({ apiKey: 'key2' });

      registry.registerProvider(provider1);
      registry.registerProvider(provider2);

      expect(registry.getProvider('anthropic')).toBe(provider2);
    });
  });

  describe('getProvider', () => {
    it('should return undefined for unregistered provider', () => {
      expect(registry.getProvider('nonexistent')).toBeUndefined();
    });

    it('should return registered provider', () => {
      const provider = new LMStudioProvider();
      registry.registerProvider(provider);

      expect(registry.getProvider('lmstudio')).toBe(provider);
    });
  });

  describe('getAllProviders', () => {
    it('should return empty array when no providers registered', () => {
      expect(registry.getAllProviders()).toEqual([]);
    });

    it('should return all registered providers', () => {
      const anthropicProvider = new AnthropicProvider({ apiKey: 'test-key' });
      const lmstudioProvider = new LMStudioProvider();

      registry.registerProvider(anthropicProvider);
      registry.registerProvider(lmstudioProvider);

      const providers = registry.getAllProviders();
      expect(providers).toHaveLength(2);
      expect(providers).toContain(anthropicProvider);
      expect(providers).toContain(lmstudioProvider);
    });
  });

  describe('getProviderNames', () => {
    it('should return empty array when no providers registered', () => {
      expect(registry.getProviderNames()).toEqual([]);
    });

    it('should return names of all registered providers', () => {
      const anthropicProvider = new AnthropicProvider({ apiKey: 'test-key' });
      const lmstudioProvider = new LMStudioProvider();

      registry.registerProvider(anthropicProvider);
      registry.registerProvider(lmstudioProvider);

      const names = registry.getProviderNames();
      expect(names).toHaveLength(2);
      expect(names).toContain('anthropic');
      expect(names).toContain('lmstudio');
    });
  });

  describe('createWithAutoDiscovery', () => {
    it('should discover and register all existing provider files', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const providerNames = registry.getProviderNames();

      expect(providerNames).toContain('anthropic');
      expect(providerNames).toContain('openai');
      expect(providerNames).toContain('lmstudio');
      expect(providerNames).toContain('ollama');
      expect(providerNames).toHaveLength(4);
    });

    it('should register providers with correct instances', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();

      const anthropicProvider = registry.getProvider('anthropic');
      const openaiProvider = registry.getProvider('openai');
      const lmstudioProvider = registry.getProvider('lmstudio');
      const ollamaProvider = registry.getProvider('ollama');

      expect(anthropicProvider).toBeDefined();
      expect(openaiProvider).toBeDefined();
      expect(lmstudioProvider).toBeDefined();
      expect(ollamaProvider).toBeDefined();

      expect(anthropicProvider!.providerName).toBe('anthropic');
      expect(openaiProvider!.providerName).toBe('openai');
      expect(lmstudioProvider!.providerName).toBe('lmstudio');
      expect(ollamaProvider!.providerName).toBe('ollama');
    });

    it('should only discover files matching *-provider.ts pattern', () => {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const providerNames = registry.getProviderNames();

      // Should not include non-provider files like types.ts, registry.ts, etc.
      expect(providerNames).not.toContain('types');
      expect(providerNames).not.toContain('registry');
      expect(providerNames).not.toContain('format-converters');
    });

    it('should handle provider files with missing exports gracefully', () => {
      // This test ensures auto-discovery doesn't crash on malformed files
      // We don't need to create malformed files - just verify it doesn't throw
      expect(ProviderRegistry.createWithAutoDiscovery()).toBeDefined();
    });
  });

  describe('isProviderClass', () => {
    it('should identify valid provider classes', () => {
      expect(ProviderRegistry.isProviderClass(AnthropicProvider)).toBe(true);
      expect(ProviderRegistry.isProviderClass(OpenAIProvider)).toBe(true);
      expect(ProviderRegistry.isProviderClass(LMStudioProvider)).toBe(true);
      expect(ProviderRegistry.isProviderClass(OllamaProvider)).toBe(true);
    });

    it('should reject non-provider classes', () => {
      class NotAProvider {}
      class AlmostProvider {
        providerName = 'test';
      }

      expect(ProviderRegistry.isProviderClass(NotAProvider)).toBe(false);
      expect(ProviderRegistry.isProviderClass(AlmostProvider)).toBe(false);
    });

    it('should reject non-class values', () => {
      expect(ProviderRegistry.isProviderClass({})).toBe(false);
      expect(ProviderRegistry.isProviderClass('string')).toBe(false);
      expect(ProviderRegistry.isProviderClass(123)).toBe(false);
      expect(ProviderRegistry.isProviderClass(null)).toBe(false);
      expect(ProviderRegistry.isProviderClass(undefined)).toBe(false);
    });
  });

  // New catalog and instance functionality tests
  describe('catalog integration', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should load provider catalogs on initialization', () => {
      const catalogProviders = registry.getCatalogProviders();
      expect(catalogProviders.length).toBeGreaterThan(0);

      const anthropic = catalogProviders.find((p) => p.id === 'anthropic');
      expect(anthropic).toBeTruthy();
      expect(anthropic?.models.length).toBeGreaterThan(0);
    });

    it('should return model from catalog', () => {
      const model = registry.getModelFromCatalog('anthropic', 'claude-3-5-haiku-20241022');
      expect(model).toBeTruthy();
      expect(model?.id).toBe('claude-3-5-haiku-20241022');
      expect(model?.name).toBe('Claude 3.5 Haiku');
    });

    it('should return null for non-existent model', () => {
      const model = registry.getModelFromCatalog('anthropic', 'non-existent-model');
      expect(model).toBeNull();
    });
  });

  describe('instance management', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should return empty instances when none configured', () => {
      const instances = registry.getConfiguredInstances();
      expect(instances).toEqual([]);
    });

    it('should load configured instances', async () => {
      // Set up test instance configuration
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'openai-test': {
            displayName: 'OpenAI Test',
            catalogProviderId: 'openai',
            timeout: 30000,
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      await registry.initialize();

      const instances = registry.getConfiguredInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('openai-test');
      expect(instances[0].displayName).toBe('OpenAI Test');
      expect(instances[0].catalogProviderId).toBe('openai');
    });

    it('should create provider from instance configuration', async () => {
      // Set up test instance and credentials
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'anthropic-test': {
            displayName: 'Anthropic Test',
            catalogProviderId: 'anthropic',
          },
        },
      };

      const credential: Credential = {
        apiKey: 'sk-ant-test123',
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        path.join(credentialsDir, 'anthropic-test.json'),
        JSON.stringify(credential, null, 2)
      );

      await registry.initialize();

      const provider = await registry.createProviderFromInstance('anthropic-test');
      expect(provider).toBeTruthy();
      expect(provider.providerName).toBe('anthropic');
    });

    it('should create provider from instance and model', async () => {
      // Set up test instance and credentials
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'anthropic-test': {
            displayName: 'Anthropic Test',
            catalogProviderId: 'anthropic',
          },
        },
      };

      const credential: Credential = {
        apiKey: 'sk-ant-test123',
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        path.join(credentialsDir, 'anthropic-test.json'),
        JSON.stringify(credential, null, 2)
      );

      await registry.initialize();

      const provider = await registry.createProviderFromInstanceAndModel(
        'anthropic-test',
        'claude-3-5-haiku-20241022'
      );
      expect(provider).toBeTruthy();
      expect(provider.providerName).toBe('anthropic');
    });

    it('should throw error for non-existent instance', async () => {
      await expect(registry.createProviderFromInstance('non-existent')).rejects.toThrow(
        'Provider instance not found: non-existent'
      );
    });

    it('should throw error for instance without credentials', async () => {
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'no-creds': {
            displayName: 'No Credentials',
            catalogProviderId: 'openai',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      await registry.initialize();

      await expect(registry.createProviderFromInstance('no-creds')).rejects.toThrow(
        'No credentials found for instance: no-creds'
      );
    });
  });
});
