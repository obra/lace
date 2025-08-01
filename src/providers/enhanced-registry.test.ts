// ABOUTME: Tests for enhanced provider registry with catalog and instance support
// ABOUTME: Validates integration of catalog system with provider instance management

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EnhancedProviderRegistry } from './enhanced-registry';
import type { ProviderInstancesConfig, Credential } from './catalog/types';

describe('EnhancedProviderRegistry', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;
  let registry: EnhancedProviderRegistry;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
    registry = new EnhancedProviderRegistry();
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

  describe('initialization', () => {
    it('loads catalogs and instances on initialization', async () => {
      await registry.initialize();
      
      // Should have loaded built-in catalog providers
      const catalogProviders = registry.getCatalogProviders();
      expect(catalogProviders.length).toBeGreaterThan(0);
      
      const anthropic = catalogProviders.find(p => p.id === 'anthropic');
      expect(anthropic).toBeTruthy();
      expect(anthropic?.models.length).toBeGreaterThan(0);
    });

    it('handles missing instance configuration gracefully', async () => {
      await registry.initialize();
      
      const instances = registry.getConfiguredInstances();
      expect(instances).toEqual([]);
    });
  });

  describe('provider instance management', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('creates provider instance from catalog and credentials', async () => {
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

      const credential: Credential = {
        apiKey: 'sk-test123',
      };

      // Save config and credential
      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const credentialsDir = path.join(tempDir, 'credentials');
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        path.join(credentialsDir, 'openai-test.json'),
        JSON.stringify(credential, null, 2)
      );

      // Reload instances
      await registry.initialize();

      // Should have the configured instance
      const instances = registry.getConfiguredInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('openai-test');
      expect(instances[0].displayName).toBe('OpenAI Test');
      expect(instances[0].catalogProviderId).toBe('openai');
    });

    it('creates AI provider from instance configuration', async () => {
      // Set up test instance
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

      // Save config and credential
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

      // Should be able to create provider from instance
      const provider = await registry.createProviderFromInstance('anthropic-test');
      expect(provider).toBeTruthy();
      expect(provider.providerName).toBe('anthropic');
    });

    it('throws error for non-existent instance', async () => {
      await expect(
        registry.createProviderFromInstance('non-existent')
      ).rejects.toThrow('Provider instance not found: non-existent');
    });

    it('throws error for instance without credentials', async () => {
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

      await expect(
        registry.createProviderFromInstance('no-creds')
      ).rejects.toThrow('No credentials found for instance: no-creds');
    });
  });

  describe('model resolution', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('resolves model from catalog provider', () => {
      const model = registry.getModelFromCatalog('anthropic', 'claude-3-5-haiku-20241022');
      expect(model).toBeTruthy();
      expect(model?.id).toBe('claude-3-5-haiku-20241022');
      expect(model?.name).toBe('Claude 3.5 Haiku');
    });

    it('returns null for non-existent model', () => {
      const model = registry.getModelFromCatalog('anthropic', 'non-existent-model');
      expect(model).toBeNull();
    });

    it('returns null for non-existent provider', () => {
      const model = registry.getModelFromCatalog('non-existent', 'some-model');
      expect(model).toBeNull();
    });
  });

  describe('backward compatibility', () => {
    it('maintains existing provider registry methods', async () => {
      await registry.initialize();

      // Should still support legacy methods
      expect(typeof registry.getProvider).toBe('function');
      expect(typeof registry.getAllProviders).toBe('function');
      expect(typeof registry.getProviderNames).toBe('function');
      expect(typeof registry.registerProvider).toBe('function');
      expect(typeof registry.createProvider).toBe('function');
    });

    it('supports legacy provider creation by name', async () => {
      await registry.initialize();

      // Should still work with old environment variable approach
      process.env.ANTHROPIC_KEY = 'sk-test-legacy';

      const provider = registry.createProvider('anthropic');
      expect(provider).toBeTruthy();
      expect(provider.providerName).toBe('anthropic');

      delete process.env.ANTHROPIC_KEY;
    });
  });

  describe('configuration management', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('provides available catalog providers', () => {
      const providers = registry.getCatalogProviders();
      expect(providers.length).toBeGreaterThan(0);
      
      const anthropic = providers.find(p => p.id === 'anthropic');
      expect(anthropic).toBeTruthy();
      expect(anthropic?.name).toBe('Anthropic');
    });

    it('provides configured instances', async () => {
      // Initially empty
      expect(registry.getConfiguredInstances()).toEqual([]);

      // Add an instance
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'test-instance': {
            displayName: 'Test Instance',
            catalogProviderId: 'openai',
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
      expect(instances[0].id).toBe('test-instance');
    });
  });
});