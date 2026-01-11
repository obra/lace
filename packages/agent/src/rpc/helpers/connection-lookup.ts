// ABOUTME: Helper for looking up provider connections/instances
// ABOUTME: Consolidates repeated connection lookup pattern from RPC handlers

import { EntErrorCodes } from '@lace/ent-protocol';
import type { AgentServerState } from '@lace/agent/server-types';
import type { ProviderInstance } from '@lace/agent/providers/catalog/types';
import { toNonEmptyString, throwInvalidParams } from '@lace/agent/rpc/utils';

/**
 * Validates connectionId and returns the corresponding provider instance.
 * Throws appropriate errors if connectionId is invalid or instance not found.
 */
export async function getConnectionInstance(
  state: AgentServerState,
  rawConnectionId: unknown
): Promise<{ connectionId: string; instance: ProviderInstance }> {
  const connectionId = toNonEmptyString(rawConnectionId);
  if (!connectionId) {
    throwInvalidParams('connectionId is required');
  }

  const instances = await state.providerInstances.loadInstances();
  const instance = instances.instances[connectionId];

  if (!instance) {
    throw {
      code: EntErrorCodes.ConnectionNotFound,
      message: 'ConnectionNotFound',
      data: { category: 'provider' },
    };
  }

  return { connectionId, instance };
}

/**
 * Validates connectionId exists in instances (doesn't return the instance).
 * Useful for operations that just need to verify the connection exists.
 */
export async function assertConnectionExists(
  state: AgentServerState,
  rawConnectionId: unknown
): Promise<string> {
  const connectionId = toNonEmptyString(rawConnectionId);
  if (!connectionId) {
    throwInvalidParams('connectionId is required');
  }

  const instances = await state.providerInstances.loadInstances();
  if (!instances.instances[connectionId]) {
    throw {
      code: EntErrorCodes.ConnectionNotFound,
      message: 'ConnectionNotFound',
      data: { category: 'provider' },
    };
  }

  return connectionId;
}
