// ABOUTME: Tests for Anthropic dynamic catalog integration with the registry
// ABOUTME: Validates that getCatalogProvider and getCatalogForInstance use dynamic discovery

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProviderRegistry } from '../registry';
import type { ProviderInstancesConfig, Credential } from '../catalog/types';

describe('Anthropic Dynamic Catalog Integration', () => {
  let registry: ProviderRegistry;
  let tempDir: string;
  let originalLaceDir: string | undefined;
  let originalAnthropicKey: string | undefined;
  let originalAnthropicApiKey: string | undefined;
  let originalDisableDynamic: string | undefined;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    originalAnthropicKey = process.env.ANTHROPIC_KEY;
    originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    originalDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;

    delete process.env.ANTHROPIC_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    // Clear singleton for tests
    ProviderRegistry.clearInstance();
    registry = ProviderRegistry.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();

    // Cleanup
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }

    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_KEY;
    else process.env.ANTHROPIC_KEY = originalAnthropicKey;

    if (originalAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;

    if (originalDisableDynamic === undefined) delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    else process.env.LACE_DISABLE_DYNAMIC_CATALOGS = originalDisableDynamic;

    fs.rmSync(tempDir, { recursive: true, force: true });
    // Clear singleton after test
    ProviderRegistry.clearInstance();
  });

  describe('getCatalogProvider', () => {
    it('should fall back to static catalog when no Anthropic instances configured', async () => {
      const catalogProvider = await registry.getCatalogProvider('anthropic');
      expect(catalogProvider).toBeDefined();
      expect(catalogProvider?.id).toBe('anthropic');
      expect(catalogProvider?.models.length).toBeGreaterThan(0);
    });

    it('should attempt dynamic catalog when Anthropic instance with API key exists', async () => {
      // Set up Anthropic instance with API key
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

      // Mock fetch to simulate API response
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: 'claude-sonnet-4-20250514',
                type: 'model',
                display_name: 'Claude Sonnet 4',
                created_at: '2025-05-14T00:00:00Z',
              },
            ],
            has_more: false,
            first_id: 'claude-sonnet-4-20250514',
            last_id: 'claude-sonnet-4-20250514',
          }),
      } as Response);

      const catalogProvider = await registry.getCatalogProvider('anthropic');

      expect(fetchSpy).toHaveBeenCalled();
      expect(catalogProvider).toBeDefined();
      expect(catalogProvider?.id).toBe('anthropic');
      // Should only have the model that API returned
      expect(catalogProvider?.models).toHaveLength(1);
      expect(catalogProvider?.models[0].id).toBe('claude-sonnet-4-20250514');
    });

    it('should fall back to static catalog when API fetch fails', async () => {
      // Set up Anthropic instance with API key
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

      // Mock fetch to fail
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const catalogProvider = await registry.getCatalogProvider('anthropic');

      expect(catalogProvider).toBeDefined();
      expect(catalogProvider?.id).toBe('anthropic');
      // Should have all static models as fallback
      expect(catalogProvider?.models.length).toBeGreaterThan(1);
    });

    it('should skip dynamic catalog when LACE_DISABLE_DYNAMIC_CATALOGS is set', async () => {
      process.env.LACE_DISABLE_DYNAMIC_CATALOGS = '1';

      // Set up Anthropic instance with API key
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

      const fetchSpy = vi.spyOn(global, 'fetch');

      const catalogProvider = await registry.getCatalogProvider('anthropic');

      // Should NOT call fetch when dynamic catalogs disabled
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(catalogProvider).toBeDefined();
      expect(catalogProvider?.id).toBe('anthropic');
    });
  });

  describe('getCatalogForInstance', () => {
    it('should use dynamic catalog for Anthropic instance', async () => {
      // Set up Anthropic instance with API key
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

      // Mock fetch to simulate API response with limited models
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: 'claude-3-5-haiku-20241022',
                type: 'model',
                display_name: 'Claude 3.5 Haiku',
                created_at: '2024-10-22T00:00:00Z',
              },
            ],
            has_more: false,
            first_id: 'claude-3-5-haiku-20241022',
            last_id: 'claude-3-5-haiku-20241022',
          }),
      } as Response);

      const catalogProvider = await registry.getCatalogForInstance('anthropic-test');

      expect(fetchSpy).toHaveBeenCalled();
      expect(catalogProvider).toBeDefined();
      expect(catalogProvider?.models).toHaveLength(1);
      expect(catalogProvider?.models[0].id).toBe('claude-3-5-haiku-20241022');
      // Should preserve rich metadata from static catalog
      expect(catalogProvider?.models[0].cost_per_1m_in).toBeDefined();
    });

    it('should return null for non-existent instance', async () => {
      const catalogProvider = await registry.getCatalogForInstance('non-existent');
      expect(catalogProvider).toBeNull();
    });

    it('should return null for instance without credentials', async () => {
      const config: ProviderInstancesConfig = {
        version: '1.0',
        instances: {
          'anthropic-no-creds': {
            displayName: 'Anthropic No Creds',
            catalogProviderId: 'anthropic',
          },
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'provider-instances.json'),
        JSON.stringify(config, null, 2)
      );

      const catalogProvider = await registry.getCatalogForInstance('anthropic-no-creds');
      expect(catalogProvider).toBeNull();
    });
  });
});
