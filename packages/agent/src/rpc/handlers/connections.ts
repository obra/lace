// ABOUTME: Connection management RPC handlers for provider configurations and credentials

import { randomUUID } from 'node:crypto';
import type { JsonRpcPeer } from '@lace/ent-protocol';
import { EntErrorCodes } from '@lace/ent-protocol';
import { SUPPORTED_PROVIDER_TYPES } from '../../server-types';
import { ensureProviderCatalogLoaded } from '../../providers/catalog';
import { logger } from '../../utils/logger';
import {
  assertInitialized,
  toNonEmptyString,
  throwInvalidParams,
  assertConfigHasNoCredentials,
  parseProviderInstanceOverridesFromConnectionConfig,
} from '../utils';
import type { AgentServerState } from '../../server-types';

/**
 * Register connection management handlers with the peer.
 * Handles:
 * - list: List configured connections for a provider
 * - upsert: Create or update a connection
 * - delete: Delete a connection
 * - test: Test a connection
 * - credentials/status: Check credential status
 * - credentials/start: Initiate credential input
 * - credentials/submit: Submit credentials
 * - credentials/clear: Clear stored credentials
 */
export function registerConnectionHandlers(peer: JsonRpcPeer, state: AgentServerState): void {
  peer.onRequest('ent/connections/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { providerId?: string } | undefined;
    const providerIdFilter = typeof parsed?.providerId === 'string' ? parsed.providerId : undefined;

    const instances = await state.providerInstances.loadInstances();
    await ensureProviderCatalogLoaded(state);
    const knownProviders = new Set(state.providerCatalog.getAvailableProviders().map((p) => p.id));

    const connections = Object.entries(instances.instances)
      .filter(([_id, inst]) =>
        providerIdFilter ? inst.catalogProviderId === providerIdFilter : true
      )
      .filter(([_id, inst]) => {
        const ok = knownProviders.has(inst.catalogProviderId);
        if (!ok) {
          logger.warn('connections.list.skipping_unknown_provider', {
            connectionId: _id,
            providerId: inst.catalogProviderId,
          });
        }
        return ok;
      })
      .map(([connectionId, inst]) => {
        const credential = state.providerInstances.loadCredential(connectionId);
        const credentialState = credential?.apiKey ? 'ready' : 'missing';
        return {
          connectionId,
          providerId: inst.catalogProviderId,
          name: inst.displayName,
          ...(inst.endpoint ? { endpoint: inst.endpoint } : {}),
          ...(inst.timeout !== undefined ? { timeout: inst.timeout } : {}),
          ...(inst.retryPolicy ? { retryPolicy: inst.retryPolicy } : {}),
          ...(inst.modelConfig ? { modelConfig: inst.modelConfig } : {}),
          hasCredentials: !!credential?.apiKey,
          credentialState,
        };
      });

    return { connections };
  });

  peer.onRequest('ent/connections/upsert', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as {
      providerId?: string;
      connection: { connectionId?: string; name: string; config: Record<string, unknown> };
    };

    const name = toNonEmptyString(parsed?.connection?.name);
    if (!name) throwInvalidParams('connection.name is required');

    const config = parsed?.connection?.config;
    if (!config || typeof config !== 'object') throwInvalidParams('connection.config is required');
    assertConfigHasNoCredentials(config);

    const requestedConnectionId = toNonEmptyString(parsed?.connection?.connectionId);
    const instances = await state.providerInstances.loadInstances();

    const isUpdate = !!requestedConnectionId && !!instances.instances[requestedConnectionId];
    const created = !isUpdate;

    const connectionId = requestedConnectionId ?? `conn_${randomUUID()}`;
    const existing = instances.instances[connectionId];

    if (existing) {
      if (
        typeof parsed.providerId === 'string' &&
        parsed.providerId.length > 0 &&
        parsed.providerId !== existing.catalogProviderId
      ) {
        throwInvalidParams('connectionId is already paired to a different providerId');
      }

      const overrides = parseProviderInstanceOverridesFromConnectionConfig({
        displayName: name,
        catalogProviderId: existing.catalogProviderId,
        config,
      });

      await state.providerInstances.updateInstance(connectionId, {
        displayName: name,
        ...overrides,
      });

      return { connectionId, providerId: existing.catalogProviderId, created: false };
    }

    const providerId = toNonEmptyString(parsed?.providerId);
    if (!providerId) throwInvalidParams('providerId is required when creating a new connection');

    await ensureProviderCatalogLoaded(state);
    const catalogProvider = state.providerCatalog.getProvider(providerId);
    if (!catalogProvider) throwInvalidParams(`Unknown providerId: ${providerId}`);
    if (!SUPPORTED_PROVIDER_TYPES.has(catalogProvider.type.toLowerCase())) {
      throwInvalidParams(`Provider is not supported by this agent: ${providerId}`);
    }

    const overrides = parseProviderInstanceOverridesFromConnectionConfig({
      displayName: name,
      catalogProviderId: providerId,
      config,
    });

    await state.providerInstances.saveInstances({
      ...instances,
      instances: {
        ...instances.instances,
        [connectionId]: {
          displayName: name,
          catalogProviderId: providerId,
          ...overrides,
        },
      },
    });

    return { connectionId, providerId, created };
  });

  peer.onRequest('ent/connections/delete', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    await state.providerInstances.deleteInstance(connectionId);
    return { ok: true };
  });

  peer.onRequest('ent/connections/test', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string; modelId?: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    const instance = instances.instances[connectionId];
    if (!instance) return { ok: false, error: 'Connection not found' };

    const credential = state.providerInstances.loadCredential(connectionId);
    if (!credential?.apiKey) return { ok: false, error: 'Missing credentials' };

    await ensureProviderCatalogLoaded(state);
    const provider = state.providerCatalog.getProvider(instance.catalogProviderId);
    if (!provider) return { ok: false, error: 'Provider not found' };

    const requestedModelId = toNonEmptyString(parsed?.modelId);
    if (requestedModelId) {
      const hasModel = provider.models.some((m) => m.id === requestedModelId);
      if (!hasModel) return { ok: false, error: 'Model not found for provider' };
    }

    return { ok: true };
  });

  peer.onRequest('ent/connections/credentials/status', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId])
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    const credential = state.providerInstances.loadCredential(connectionId);
    return {
      connectionId,
      state: credential?.apiKey ? 'ready' : 'missing',
    };
  });

  peer.onRequest('ent/connections/credentials/start', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string; method?: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId])
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    const credential = state.providerInstances.loadCredential(connectionId);
    const requestedMethod = toNonEmptyString(parsed?.method);

    if (!requestedMethod && credential?.apiKey) {
      return { kind: 'ready' };
    }

    return {
      kind: 'needs_input',
      fields: [{ name: 'apiKey', label: 'API Key', secret: true }],
    };
  });

  peer.onRequest('ent/connections/credentials/submit', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string; values: Record<string, string> };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId])
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    const values = parsed?.values;
    if (!values || typeof values !== 'object') return { ok: false, error: 'values is required' };

    const apiKey =
      toNonEmptyString((values as any).apiKey) ??
      toNonEmptyString((values as any).api_key) ??
      toNonEmptyString((values as any).key);

    if (!apiKey) return { ok: false, error: 'apiKey is required' };

    await state.providerInstances.saveCredential(connectionId, { apiKey });
    return { ok: true };
  });

  peer.onRequest('ent/connections/credentials/clear', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { connectionId: string };
    const connectionId = toNonEmptyString(parsed?.connectionId);
    if (!connectionId) throwInvalidParams('connectionId is required');

    const instances = await state.providerInstances.loadInstances();
    if (!instances.instances[connectionId])
      throw {
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      };

    await state.providerInstances.clearCredential(connectionId);
    return { ok: true };
  });
}
