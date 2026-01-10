// ABOUTME: Model management RPC handlers for listing and configuring AI models

import type { JsonRpcPeer } from '@lace/ent-protocol';
import { EntErrorCodes } from '@lace/ent-protocol';
import { ProviderRegistry } from '../../providers/registry';
import { logger } from '../../utils/logger';
import {
  assertInitialized,
  mapCatalogModelToModelInfo,
  throwInvalidParams,
  toNonEmptyString,
} from '../utils';
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
 * Updates model gating (enable/disable status) for a provider.
 * Validates all model IDs exist in the provider and updates the catalog.
 */
async function updateModelGating(
  state: AgentServerState,
  providerId: string,
  modelIds: string[],
  action: 'enable' | 'disable'
): Promise<{ providerId: string; enabled: string[]; disabled: string[] }> {
  await ensureProviderCatalogLoaded(state);
  const provider = state.providerCatalog.getProvider(providerId);
  if (!provider) throwInvalidParams(`Unknown providerId: ${providerId}`);

  const providerModels = new Set(provider.models.map((m) => m.id));
  for (const id of modelIds) {
    if (!providerModels.has(id)) throwInvalidParams(`Unknown modelId for provider: ${id}`);
  }

  const gating = state.providerCatalog.getModelGating(providerId);
  const enabled = new Set(gating.enabled ?? []);
  const disabled = new Set(gating.disabled ?? []);

  if (action === 'enable') {
    for (const id of modelIds) {
      enabled.add(id);
      disabled.delete(id);
    }
  } else {
    for (const id of modelIds) {
      disabled.add(id);
      enabled.delete(id);
    }
  }

  const enabledArr = Array.from(enabled).sort();
  const disabledArr = Array.from(disabled).sort();
  await state.providerCatalog.setModelGating(providerId, {
    enabled: enabledArr,
    disabled: disabledArr,
  });

  return { providerId, enabled: enabledArr, disabled: disabledArr };
}

/**
 * Register model management handlers with the peer.
 * - list: Returns available models for a connection with gating status
 * - refresh: Refreshes the model catalog for a connection
 * - enable: Enables specific models for a provider
 * - disable: Disables specific models for a provider
 */
export function registerModelHandlers(peer: JsonRpcPeer, state: AgentServerState): void {
  peer.onRequest('ent/models/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance)
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    await ensureProviderCatalogLoaded(state);
    const providerId = instance.catalogProviderId;
    let provider = state.providerCatalog.getProvider(providerId);
    if (!provider) throwInvalidParams(`Unknown providerId: ${providerId}`);

    // Prefer per-connection dynamic catalogs when available (e.g. OpenAI, OpenRouter).
    const registry = ProviderRegistry.getInstance();
    const instanceCatalog = await registry.getCatalogForInstance(connectionId);
    if (instanceCatalog) provider = instanceCatalog;

    const gating = state.providerCatalog.getModelGating(providerId);
    const enabledSet =
      gating.enabled && gating.enabled.length > 0 ? new Set(gating.enabled) : undefined;
    const disabledSet = new Set(gating.disabled ?? []);

    const models = provider.models.map((m) => {
      const info = mapCatalogModelToModelInfo(m, providerId) as any;
      const isDisabled =
        (enabledSet && !enabledSet.has(m.id)) || (disabledSet.size > 0 && disabledSet.has(m.id));
      info.disabled = isDisabled;
      info.disabledState = isDisabled ? 'disabled' : 'enabled';
      return info;
    });

    return { providerId, connectionId, models };
  });

  peer.onRequest('ent/models/refresh', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance)
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    await ensureProviderCatalogLoaded(state);
    const providerId = instance.catalogProviderId;
    const provider = state.providerCatalog.getProvider(providerId);
    if (!provider)
      throw {
        code: EntErrorCodes.ProviderError,
        message: 'Provider not found',
        data: { category: 'provider' },
      };

    // Prefer per-connection dynamic refresh when available.
    const registry = ProviderRegistry.getInstance();
    const refreshed = await registry.getCatalogForInstance(connectionId, true);
    if (refreshed) {
      return {
        connectionId,
        refreshedAt: new Date().toISOString(),
        ok: true,
      };
    }

    // Refresh the model catalog (currently a no-op for static catalogs)
    return {
      connectionId,
      refreshedAt: new Date().toISOString(),
      ok: true,
    };
  });

  peer.onRequest('ent/models/enable', async (params: unknown) => {
    assertInitialized(state);
    const parsed = params as { providerId?: string; modelIds?: unknown };
    const providerId = toNonEmptyString(parsed.providerId);
    if (!providerId) throwInvalidParams('providerId is required');
    if (!Array.isArray(parsed.modelIds) || parsed.modelIds.length === 0)
      throwInvalidParams('modelIds must be a non-empty array of strings');
    const modelIds: string[] = [];
    for (const id of parsed.modelIds) {
      const v = toNonEmptyString(id);
      if (!v) throwInvalidParams('modelIds must be strings');
      modelIds.push(v);
    }

    return await updateModelGating(state, providerId, modelIds, 'enable');
  });

  peer.onRequest('ent/models/disable', async (params: unknown) => {
    assertInitialized(state);
    const parsed = params as { providerId?: string; modelIds?: unknown };
    const providerId = toNonEmptyString(parsed.providerId);
    if (!providerId) throwInvalidParams('providerId is required');
    if (!Array.isArray(parsed.modelIds) || parsed.modelIds.length === 0)
      throwInvalidParams('modelIds must be a non-empty array of strings');
    const modelIds: string[] = [];
    for (const id of parsed.modelIds) {
      const v = toNonEmptyString(id);
      if (!v) throwInvalidParams('modelIds must be strings');
      modelIds.push(v);
    }

    return await updateModelGating(state, providerId, modelIds, 'disable');
  });
}
