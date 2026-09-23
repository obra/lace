// ABOUTME: Pins the model ids the fleet runs on LunaRoute against the SHIPPED static
// ABOUTME: catalog, resolved through the real ProviderRegistry, because an unlisted id
// ABOUTME: makes createProviderFromInstanceAndModel throw "Model not found in catalog".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderRegistry } from '../../registry';
import { ProviderInstanceManager } from '../../instance/manager';
import { setupCoreTest } from '@lace/agent/test-utils/core-test-setup';
import type { ProviderInstancesConfig } from '../types';

const LUNAROUTE_MODEL_IDS = ['deepseek-4.1-flash', 'deepseek-4.1-flash-background'];

describe('shipped LunaRoute catalog', () => {
  const _tempLaceDir = setupCoreTest();
  let registry: ProviderRegistry;
  let previousDisableDynamic: string | undefined;

  beforeEach(async () => {
    // Static catalogs only: this pins what lace ships, not what a live gateway lists.
    previousDisableDynamic = process.env.LACE_DISABLE_DYNAMIC_CATALOGS;
    process.env.LACE_DISABLE_DYNAMIC_CATALOGS = '1';

    const instances: ProviderInstancesConfig = {
      version: '1.0',
      instances: {
        'sen-lunaroute': {
          displayName: 'Sen LunaRoute',
          catalogProviderId: 'lunaroute',
        },
      },
    };
    fs.writeFileSync(
      path.join(process.env.LACE_DIR!, 'provider-instances.json'),
      JSON.stringify(instances, null, 2)
    );
    await new ProviderInstanceManager().saveCredential('sen-lunaroute', {
      apiKey: 'test-lunaroute-key',
    });

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

  for (const modelId of LUNAROUTE_MODEL_IDS) {
    it(`resolves ${modelId} through the registry`, async () => {
      const provider = await registry.createProviderFromInstanceAndModel('sen-lunaroute', modelId);

      expect(provider.config.model).toBe(modelId);
    });
  }
});
