// ABOUTME: Failing tests that pin down kata #30 — bare aliases (haiku/sonnet/opus) must
// ABOUTME: resolve even when the dynamic catalog reaching the resolver lacks those entries.

/*
 * Why these tests exist
 * ---------------------
 * Commits 390233a07 + f5785a2dc shipped a resolveModelAlias helper and integrated it at
 * two lookup sites in ProviderRegistry. The unit + integration tests for that fix used
 * a hand-built static catalog already containing haiku entries — the resolver always
 * had something to match.
 *
 * The 2026-05-17 production smoke retry reproduced the original failure:
 *
 *   Model not found in catalog: haiku for instance my-anthropic (provider anthropic)
 *
 * Working hypothesis (from the kata reopen comment): the catalog that actually reaches
 * the resolver in production — the result of `getCatalogForInstance` for an Anthropic
 * instance — does not contain models whose id includes "haiku" at the moment of the
 * lookup. resolveModelAlias's filter (`m.id.toLowerCase().includes('haiku')`) then
 * returns an empty match list, the alias passes through unchanged, and `find` throws
 * with the original alias string in the error.
 *
 * These tests reproduce that surface deterministically by pre-populating the
 * AnthropicDynamicProvider on-disk cache (which `getCatalogForInstance` consults
 * before any API call). With a fresh-but-incomplete cache, the dynamic catalog
 * returned to the resolver lacks haiku entries even though the built-in static
 * catalog has them.
 *
 * What a correct fix must do
 * --------------------------
 * Any fix that closes this kata must make the alias resolvable through *some*
 * catalog source available to ProviderRegistry. The simplest correct shape:
 * if alias resolution against the dynamic/instance catalog yields no candidates,
 * fall back to the static (built-in) catalog via this.catalogManager.getProvider().
 * Any other approach that produces the same observable behavior (success with a
 * concrete dated haiku id flowing into ProviderConfig.model) is fine — these
 * tests pin behavior, not implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderRegistry } from '../registry';
import { ProviderInstanceManager } from '../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import type { ProviderInstancesConfig, CatalogProvider } from '../catalog/types';

describe('ProviderRegistry alias resolution — production catalog paths', () => {
  // setupCoreTest assigns a fresh temp LACE_DIR per test via beforeEach
  setupCoreTest();

  let previousDisableDynamic: string | undefined;

  // Build a cached "dynamic catalog" for the test provider instance that contains sonnet & opus but
  // NO haiku entries. Pre-populate it on disk so getCatalogForInstance reads it from
  // cache without any network call. This mirrors the production state where the
  // catalog visible to the resolver lacks alias-matching entries.
  function writeDynamicCatalogCacheWithoutHaiku(): void {
    const cacheDir = path.join(process.env.LACE_DIR!, 'catalogs');
    fs.mkdirSync(cacheDir, { recursive: true });

    const provider: CatalogProvider = {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      default_large_model_id: 'claude-opus-4-5-20251101',
      default_small_model_id: 'claude-3-5-sonnet-20241022',
      models: [
        {
          id: 'claude-opus-4-5-20251101',
          name: 'Claude Opus 4.5',
          context_window: 200000,
          default_max_tokens: 8192,
        },
        {
          id: 'claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          context_window: 200000,
          default_max_tokens: 8192,
        },
      ],
    };

    const cachePayload = {
      _meta: {
        fetchedAt: new Date().toISOString(),
        version: '1.0',
        availableModelCount: provider.models.length,
        source: 'https://api.anthropic.com/v1/models',
      },
      provider,
    };

    fs.writeFileSync(
      path.join(cacheDir, 'anthropic-sen-anthropic.json'),
      JSON.stringify(cachePayload, null, 2)
    );
  }

  async function configureSenAnthropicInstance(): Promise<void> {
    const instanceConfig: ProviderInstancesConfig = {
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
      JSON.stringify(instanceConfig, null, 2)
    );

    const instanceManager = new ProviderInstanceManager();
    await instanceManager.saveCredential('sen-anthropic', { apiKey: 'test-anthropic-key' });
  }

  beforeEach(async () => {
    // Production runs WITHOUT LACE_DISABLE_DYNAMIC_CATALOGS=1, so we must too.
    // The existing alias test forces static-only mode and therefore can't see this bug.
    previousDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    delete process.env.LACE_DISABLE_DYNAMIC_CATALOGS;

    await configureSenAnthropicInstance();

    ProviderRegistry.clearInstance();
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
    /*
     * PRODUCTION REPRO. Dynamic catalog returned by getCatalogForInstance contains
     * only sonnet and opus. A persona declares `model: haiku`. The resolver finds no
     * candidates with "haiku" in their id and gives up. find() returns undefined and
     * the throw fires with the production error string. This test fails today with
     * the exact production error shape.
     *
     * Pass condition: the call succeeds and ProviderConfig.model is a concrete dated
     * haiku id from SOMEWHERE the registry knows about (built-in static catalog has
     * claude-haiku-4-5-20251001). The exact id is not asserted here — only that it is
     * a real haiku id, not the alias string, and not undefined.
     */
    it('resolves "haiku" when the dynamic catalog for sen-anthropic has no haiku entries', async () => {
      writeDynamicCatalogCacheWithoutHaiku();

      const registry = ProviderRegistry.getInstance();
      await registry.ensureInitialized();

      const provider = await registry.createProviderFromInstanceAndModel('sen-anthropic', 'haiku');

      const resolvedModel = provider.config.model;
      expect(resolvedModel, 'ProviderConfig.model must not remain the bare alias').not.toBe(
        'haiku'
      );
      expect(typeof resolvedModel).toBe('string');
      expect(resolvedModel as string).toMatch(/haiku/i);
    });

    /*
     * Stronger form of the above. The dynamic catalog returns an EMPTY models list
     * (e.g. a transient API error during refresh causes the filtered list to collapse
     * for that provider). The alias still must resolve via the built-in static
     * catalog. Today this also throws the production error.
     */
    it('resolves "haiku" when the dynamic catalog for sen-anthropic has zero models', async () => {
      const cacheDir = path.join(process.env.LACE_DIR!, 'catalogs');
      fs.mkdirSync(cacheDir, { recursive: true });
      const emptyProvider: CatalogProvider = {
        id: 'anthropic',
        name: 'Anthropic',
        type: 'anthropic',
        default_large_model_id: 'claude-opus-4-5-20251101',
        default_small_model_id: 'claude-haiku-4-5-20251001',
        models: [],
      };
      fs.writeFileSync(
        path.join(cacheDir, 'anthropic-sen-anthropic.json'),
        JSON.stringify(
          {
            _meta: {
              fetchedAt: new Date().toISOString(),
              version: '1.0',
              availableModelCount: 0,
              source: 'https://api.anthropic.com/v1/models',
            },
            provider: emptyProvider,
          },
          null,
          2
        )
      );

      const registry = ProviderRegistry.getInstance();
      await registry.ensureInitialized();

      const provider = await registry.createProviderFromInstanceAndModel('sen-anthropic', 'haiku');

      const resolvedModel = provider.config.model;
      expect(resolvedModel, 'ProviderConfig.model must not remain the bare alias').not.toBe(
        'haiku'
      );
      expect(typeof resolvedModel).toBe('string');
      expect(resolvedModel as string).toMatch(/haiku/i);
    });
  });

  describe('getModelFromCatalog', () => {
    /*
     * The OTHER lookup site patched by f5785a2dc. Same root condition: dynamic
     * catalog visible to the resolver lacks haiku entries. Today this returns null
     * (because getModelFromCatalog falls back to the static catalog only with the
     * original, unresolved modelId, and the static catalog has no entry whose id is
     * literally "haiku"). A fix must yield a real CatalogModel whose id is a
     * concrete dated haiku id.
     */
    it('returns a concrete haiku CatalogModel when the dynamic anthropic catalog lacks haiku entries', async () => {
      writeDynamicCatalogCacheWithoutHaiku();

      // Note: getModelFromCatalog calls getCatalogProvider(providerId), not
      // getCatalogForInstance. The Anthropic branch in getCatalogProvider also
      // discovers the configured Anthropic instance (it scans loaded instances for one
      // with catalogProviderId === 'anthropic') and uses the same on-disk cache
      // path, so the cache we wrote above is the catalog this method will see.
      const registry = ProviderRegistry.getInstance();
      await registry.ensureInitialized();

      const model = await registry.getModelFromCatalog('anthropic', 'haiku');

      expect(model).not.toBeNull();
      expect(model?.id).toMatch(/haiku/i);
      expect(model?.id).not.toBe('haiku');
    });
  });
});
