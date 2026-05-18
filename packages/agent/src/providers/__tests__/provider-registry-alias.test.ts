// ABOUTME: Tests that ProviderRegistry resolves model aliases (haiku/sonnet/opus) before catalog lookup
// ABOUTME: Verifies the resolved concrete model id flows into ProviderConfig.model and error messaging

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderRegistry } from '../registry';
import { ProviderInstanceManager } from '../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import type { ProviderInstancesConfig, CatalogProvider } from '../catalog/types';

describe('ProviderRegistry model alias resolution', () => {
  const _tempLaceDir = setupCoreTest();
  let registry: ProviderRegistry;
  let instanceManager: ProviderInstanceManager;
  let previousDisableDynamic: string | undefined;

  beforeEach(async () => {
    // Force static catalogs so we test the alias resolver against known fixture data
    // (dynamic catalog fetching would either hit the network or fail silently)
    previousDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    process.env.LACE_DISABLE_DYNAMIC_CATALOGS = '1';

    const testCatalogDir = path.join(process.env.LACE_DIR!, 'user-catalog');
    fs.mkdirSync(testCatalogDir, { recursive: true });

    // Anthropic catalog with multiple haiku/sonnet generations so we exercise the
    // "newest by date" tiebreaker in resolveModelAlias.
    const anthropicCatalog: CatalogProvider = {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      default_large_model_id: 'claude-opus-4-20250101',
      default_small_model_id: 'claude-haiku-4-5-20251001',
      models: [
        {
          id: 'claude-3-haiku-20240307',
          name: 'Claude 3 Haiku',
          cost_per_1m_in: 0.25,
          cost_per_1m_out: 1.25,
          context_window: 200000,
          default_max_tokens: 4096,
        },
        {
          id: 'claude-haiku-4-5-20251001',
          name: 'Claude Haiku 4.5',
          cost_per_1m_in: 1.0,
          cost_per_1m_out: 5.0,
          context_window: 200000,
          default_max_tokens: 8192,
        },
        {
          id: 'claude-3-5-sonnet-20240620',
          name: 'Claude 3.5 Sonnet (June)',
          cost_per_1m_in: 3.0,
          cost_per_1m_out: 15.0,
          context_window: 200000,
          default_max_tokens: 8192,
        },
        {
          id: 'claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet (October)',
          cost_per_1m_in: 3.0,
          cost_per_1m_out: 15.0,
          context_window: 200000,
          default_max_tokens: 8192,
        },
        {
          id: 'claude-opus-4-20250101',
          name: 'Claude Opus 4',
          cost_per_1m_in: 15.0,
          cost_per_1m_out: 75.0,
          context_window: 200000,
          default_max_tokens: 4096,
        },
      ],
    };

    fs.writeFileSync(
      path.join(testCatalogDir, 'anthropic.json'),
      JSON.stringify(anthropicCatalog, null, 2)
    );

    instanceManager = new ProviderInstanceManager();

    const testInstanceConfig: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'sen-anthropic': {
          displayName: 'Sen Anthropic',
          catalogProviderId: 'anthropic',
          timeout: 30000,
        },
      },
    };

    fs.writeFileSync(
      path.join(process.env.LACE_DIR!, 'provider-instances.json'),
      JSON.stringify(testInstanceConfig, null, 2)
    );

    await instanceManager.saveCredential('sen-anthropic', { apiKey: 'test-anthropic-key' });

    ProviderRegistry.clearInstance();
    registry = ProviderRegistry.getInstance();
    await registry.ensureInitialized();
  });

  afterEach(() => {
    ProviderRegistry.clearInstance();
    if (previousDisableDynamic === undefined) {
      delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    } else {
      process.env.LACE_DISABLE_DYNAMIC_CATALOGS = previousDisableDynamic;
    }
  });

  describe('createProviderFromInstanceAndModel', () => {
    it('resolves the "haiku" alias to the newest haiku catalog id', async () => {
      const provider = await registry.createProviderFromInstanceAndModel('sen-anthropic', 'haiku');

      expect(provider.providerName).toBe('anthropic');
      // The provider must see the concrete catalog id, not the alias
      expect(provider.config.model).toBe('claude-haiku-4-5-20251001');
      expect(provider.config.model).not.toBe('haiku');
    });

    it('passes an explicit catalog id through unchanged (no spurious resolution)', async () => {
      const provider = await registry.createProviderFromInstanceAndModel(
        'sen-anthropic',
        'claude-3-haiku-20240307'
      );

      expect(provider.config.model).toBe('claude-3-haiku-20240307');
    });

    it('throws with the original modelId in the error when alias resolution fails', async () => {
      await expect(
        registry.createProviderFromInstanceAndModel('sen-anthropic', 'not-a-real-model')
      ).rejects.toThrow(
        'Model not found in catalog: not-a-real-model for instance sen-anthropic (provider anthropic)'
      );
    });
  });

  describe('getModelFromCatalog', () => {
    it('resolves the "sonnet" alias to the newest sonnet catalog entry', async () => {
      const model = await registry.getModelFromCatalog('anthropic', 'sonnet');

      expect(model).not.toBeNull();
      expect(model?.id).toBe('claude-3-5-sonnet-20241022');
    });
  });
});
