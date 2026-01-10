// ABOUTME: Provider management RPC handlers for listing and refreshing AI providers

import type { JsonRpcPeer } from '@lace/ent-protocol';
import { EntErrorCodes } from '@lace/ent-protocol';
import { ProviderRegistry } from '../../providers/registry';
import { SUPPORTED_PROVIDER_TYPES } from '../../server-types';
import { logger } from '../../utils/logger';
import { assertInitialized } from '../utils';
import type { AgentServerState } from '../../server-types';

/**
 * Ensures the provider catalog is loaded into state.
 * Attempts to load catalogs and validates that at least one provider is available.
 * Throws an ACP error if loading fails.
 */
async function ensureProviderCatalogLoaded(state: AgentServerState): Promise<void> {
  if (state.providerCatalogLoaded) return;
  try {
    await state.providerCatalog.loadCatalogs();
    if (state.providerCatalog.getAvailableProviders().length === 0) {
      throw new Error('provider catalog empty after load');
    }
    state.providerCatalogLoaded = true;
  } catch (error) {
    logger.error('catalog.load.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    state.providerCatalogLoaded = false;
    throw {
      code: EntErrorCodes.ProviderError,
      message: 'Provider catalog unavailable',
      data: { category: 'provider', reason: 'CatalogLoadFailed' },
    };
  }
}

/**
 * Register provider management handlers with the peer.
 * - list: Returns available provider types supported by the system
 * - catalog: Returns model catalog information from the provider registry
 * - refresh: Reloads the provider catalog and optionally validates a specific provider
 */
export function registerProviderHandlers(peer: JsonRpcPeer, state: AgentServerState): void {
  peer.onRequest('ent/providers/list', async (_params: unknown) => {
    assertInitialized(state);

    await ensureProviderCatalogLoaded(state);

    const providers = state.providerCatalog
      .getAvailableProviders()
      .filter((p) => SUPPORTED_PROVIDER_TYPES.has(p.type.toLowerCase()))
      .map((p) => ({
        providerId: p.id,
        displayName: p.name,
        supportsConnections: true,
        supportsCatalogRefresh: true,
      }));

    return { providers };
  });

  peer.onRequest('ent/providers/catalog', async (_params: unknown) => {
    assertInitialized(state);

    const registry = ProviderRegistry.getInstance();
    const providers = await registry.getCatalogProviders();
    return { providers };
  });

  peer.onRequest('ent/providers/refresh', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { providerId?: string } | undefined;
    const providerId = parsed?.providerId;

    await state.providerCatalog.loadCatalogs();
    state.providerCatalogLoaded = true;

    if (providerId) {
      const provider = state.providerCatalog.getProvider(providerId);
      if (!provider) {
        return {
          ok: false,
          refreshedAt: new Date().toISOString(),
          error: `Unknown providerId: ${providerId}`,
        };
      }
    }

    return { ok: true, refreshedAt: new Date().toISOString() };
  });
}
