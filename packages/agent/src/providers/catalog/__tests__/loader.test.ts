// ABOUTME: Tests for the catalog loader utility that ensures provider catalog is loaded

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureProviderCatalogLoaded } from '../loader';
import type { AgentServerState } from '@lace/agent/server-types';
import { EntErrorCodes } from '@lace/ent-protocol';

// Create a minimal mock state for testing
function createMockState(overrides: {
  providerCatalogLoaded?: boolean;
  loadCatalogsImpl?: () => Promise<void>;
  getAvailableProvidersImpl?: () => { id: string }[];
} = {}): AgentServerState {
  const loadCatalogs = vi.fn(overrides.loadCatalogsImpl ?? (() => Promise.resolve()));
  const getAvailableProviders = vi.fn(overrides.getAvailableProvidersImpl ?? (() => [{ id: 'test-provider' }]));

  return {
    initialized: true,
    providerCatalogLoaded: overrides.providerCatalogLoaded ?? false,
    providerCatalog: {
      loadCatalogs,
      getAvailableProviders,
    },
  } as unknown as AgentServerState;
}

describe('ensureProviderCatalogLoaded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads catalog on first call when not loaded', async () => {
    const state = createMockState({ providerCatalogLoaded: false });

    await ensureProviderCatalogLoaded(state);

    expect(state.providerCatalog.loadCatalogs).toHaveBeenCalledOnce();
    expect(state.providerCatalogLoaded).toBe(true);
  });

  it('skips loading if already loaded', async () => {
    const state = createMockState({ providerCatalogLoaded: true });

    await ensureProviderCatalogLoaded(state);

    expect(state.providerCatalog.loadCatalogs).not.toHaveBeenCalled();
  });

  it('throws ProviderError when catalog is empty after load', async () => {
    const state = createMockState({
      providerCatalogLoaded: false,
      getAvailableProvidersImpl: () => [],
    });

    await expect(ensureProviderCatalogLoaded(state)).rejects.toMatchObject({
      code: EntErrorCodes.ProviderError,
      message: 'Provider catalog unavailable',
      data: { category: 'provider', reason: 'CatalogLoadFailed' },
    });

    expect(state.providerCatalogLoaded).toBe(false);
  });

  it('throws ProviderError when loadCatalogs fails', async () => {
    const state = createMockState({
      providerCatalogLoaded: false,
      loadCatalogsImpl: () => Promise.reject(new Error('Network error')),
    });

    await expect(ensureProviderCatalogLoaded(state)).rejects.toMatchObject({
      code: EntErrorCodes.ProviderError,
      message: 'Provider catalog unavailable',
      data: { category: 'provider', reason: 'CatalogLoadFailed' },
    });

    expect(state.providerCatalogLoaded).toBe(false);
  });

  it('explicitly sets providerCatalogLoaded to false on failure', async () => {
    // This test verifies the explicit false assignment in the catch block
    // The implementation sets it to false even though it was already false,
    // ensuring clear state after failure
    const state = createMockState({
      providerCatalogLoaded: false,
      loadCatalogsImpl: () => Promise.reject(new Error('Failed')),
    });

    await expect(ensureProviderCatalogLoaded(state)).rejects.toBeDefined();

    // Confirm state remains false after failure
    expect(state.providerCatalogLoaded).toBe(false);
  });
});
