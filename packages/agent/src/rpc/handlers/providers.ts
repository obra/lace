// ABOUTME: Provider management RPC handlers for listing and refreshing AI providers

import type { JsonRpcPeer } from '@lace/ent-protocol';
import { ProviderRegistry } from '../../providers/registry';
import { SUPPORTED_PROVIDER_TYPES } from '../../server-types';
import { ensureProviderCatalogLoaded } from '../../providers/catalog';
import { assertInitialized } from '../utils';
import type { AgentServerState } from '../../server-types';

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
