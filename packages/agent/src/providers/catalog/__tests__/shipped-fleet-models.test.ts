// ABOUTME: Pins the model ids the fleet runs against the SHIPPED static catalogs,
// ABOUTME: resolved through the real ProviderRegistry, because an unlisted id
// ABOUTME: makes createProviderFromInstanceAndModel throw "Model not found in catalog".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderRegistry } from '../../registry';
import { ProviderInstanceManager } from '../../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import type { ProviderInstancesConfig } from '../types';

/**
 * Per catalog provider, the model ids the fleet runs. Anthropic is here because
 * in Claude Platform mode lace's dynamic Anthropic catalog can be a stale cached
 * copy, so a new model must be resolvable from the static catalog alone.
 *
 * The LunaRoute limits are what the gateway's own GET /v1/models publishes for
 * both ids (fetched 2026-09-24): context_window 1048576, max_output_tokens
 * 262144, capabilities.vision true.
 */
const FLEET_MODELS: Record<
  string,
  Record<string, { contextWindow: number; maxOutputTokens: number; supportsAttachments: boolean }>
> = {
  lunaroute: {
    'deepseek-4.1-flash': {
      contextWindow: 1_048_576,
      maxOutputTokens: 262_144,
      supportsAttachments: true,
    },
    'deepseek-4.1-flash-background': {
      contextWindow: 1_048_576,
      maxOutputTokens: 262_144,
      supportsAttachments: true,
    },
  },
  anthropic: {
    'claude-opus-5': {
      contextWindow: 1_000_000,
      maxOutputTokens: 50_000,
      supportsAttachments: true,
    },
    'claude-opus-5-5': {
      contextWindow: 1_000_000,
      maxOutputTokens: 50_000,
      supportsAttachments: true,
    },
  },
};

const instanceIdFor = (catalogProviderId: string) => `sen-${catalogProviderId}`;

describe('shipped fleet model catalogs', () => {
  const _tempLaceDir = setupCoreTest();
  let registry: ProviderRegistry;
  let previousDisableDynamic: string | undefined;

  beforeEach(async () => {
    // Static catalogs only: this pins what lace ships, not what a live API lists.
    previousDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    process.env.LACE_DISABLE_DYNAMIC_CATALOGS = '1';

    const instances: ProviderInstancesConfig = { version: '1.0', instances: {} };
    for (const catalogProviderId of Object.keys(FLEET_MODELS)) {
      instances.instances[instanceIdFor(catalogProviderId)] = {
        displayName: `Sen ${catalogProviderId}`,
        catalogProviderId,
      };
    }
    fs.writeFileSync(
      path.join(process.env.LACE_DIR!, 'provider-instances.json'),
      JSON.stringify(instances, null, 2)
    );
    const instanceManager = new ProviderInstanceManager();
    for (const catalogProviderId of Object.keys(FLEET_MODELS)) {
      await instanceManager.saveCredential(instanceIdFor(catalogProviderId), {
        apiKey: `test-${catalogProviderId}-key`,
      });
    }

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

  for (const [catalogProviderId, models] of Object.entries(FLEET_MODELS)) {
    for (const [modelId, expected] of Object.entries(models)) {
      it(`resolves ${catalogProviderId}/${modelId} through the registry`, async () => {
        const provider = await registry.createProviderFromInstanceAndModel(
          instanceIdFor(catalogProviderId),
          modelId
        );

        expect(provider.config.model).toBe(modelId);
        // A model the provider's catalog does not describe still resolves, but
        // with a guessed 200K window and 8192-token output cap — so pin both.
        expect(provider.contextWindowForModel(modelId)).toBe(expected.contextWindow);
        const model = provider.getAvailableModels().find((m) => m.id === modelId);
        expect(model?.maxOutputTokens).toBe(expected.maxOutputTokens);
        expect(model?.capabilities?.includes('attachments') ?? false).toBe(
          expected.supportsAttachments
        );
      });
    }
  }
});
