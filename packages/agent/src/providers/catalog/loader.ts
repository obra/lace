// ABOUTME: Catalog loading utilities - ensures provider catalog is loaded before use

import { EntErrorCodes } from '@lace/ent-protocol';
import type { AgentServerState } from '@lace/agent/server-types';
import { logger } from '@lace/agent/utils/logger';

/**
 * Ensures the provider catalog is loaded into state.
 * Attempts to load catalogs and validates that at least one provider is available.
 * Throws an ACP error if loading fails.
 *
 * Safe to call multiple times - only loads once per session.
 */
export async function ensureProviderCatalogLoaded(state: AgentServerState): Promise<void> {
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
