// ABOUTME: Shared provider route handler functions and types for provider instance routes
// ABOUTME: Consolidates duplicated patterns across provider instance API routes

import { z } from 'zod';
import type { SupervisorClient } from '@lace/supervisor';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { RouteValidationError } from './route-helpers';

// ============================================================================
// Types
// ============================================================================

/**
 * Configured provider instance returned by the API.
 * Previously duplicated in api.provider.instances.ts and api.provider.instances.$instanceId.ts
 */
export interface ConfiguredInstance {
  id: string;
  displayName: string;
  catalogProviderId: string;
  endpoint?: string;
  timeout?: number;
  retryPolicy?: string;
  modelConfig?: unknown;
  hasCredentials: boolean;
}

/**
 * Raw connection data from the supervisor.
 */
export interface ConnectionResponse {
  connectionId: string;
  providerId: string;
  name: string;
  endpoint?: string;
  timeout?: number;
  retryPolicy?: string;
  modelConfig?: unknown;
  hasCredentials?: boolean;
  credentialState?: string;
}

/**
 * Context for provider management operations.
 */
export interface ProviderContext {
  supervisor: SupervisorClient;
  workspaceSessionId: string;
  agentSessionId: string;
}

// ============================================================================
// Shared Schemas
// ============================================================================

/**
 * Schema for model configuration.
 * Previously duplicated in api.provider.instances.$instanceId.ts and api.provider.instances.$instanceId.config.ts
 */
export const ModelConfigSchema = z
  .object({
    enableNewModels: z.boolean().default(true),
    disabledModels: z.array(z.string()).default([]),
    disabledProviders: z.array(z.string()).default([]),
    filters: z
      .object({
        requiredParameters: z.array(z.string()).optional(),
        maxPromptCostPerMillion: z.number().nonnegative().optional(),
        maxCompletionCostPerMillion: z.number().nonnegative().optional(),
        minContextLength: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get provider management context (supervisor + agent session).
 * Consolidates the repeated pattern of getting supervisor and provider management agent.
 */
export async function getProviderContext(): Promise<ProviderContext> {
  const supervisor = await getSupervisor();
  const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();
  return { supervisor, workspaceSessionId, agentSessionId };
}

/**
 * Transform a connection response from the supervisor to a ConfiguredInstance.
 */
export function toConfiguredInstance(connection: ConnectionResponse): ConfiguredInstance {
  return {
    id: connection.connectionId,
    displayName: connection.name,
    catalogProviderId: connection.providerId,
    endpoint: connection.endpoint,
    timeout: connection.timeout,
    retryPolicy: connection.retryPolicy,
    modelConfig: connection.modelConfig,
    hasCredentials: connection.hasCredentials ?? connection.credentialState === 'ready',
  };
}

/**
 * List all provider instances.
 */
export async function listProviderInstances(ctx: ProviderContext): Promise<ConfiguredInstance[]> {
  const { connections } = (await ctx.supervisor.agentRequest({
    workspaceSessionId: ctx.workspaceSessionId,
    sessionId: ctx.agentSessionId,
    method: 'ent/connections/list',
  })) as { connections: ConnectionResponse[] };

  return connections.map(toConfiguredInstance);
}

/**
 * Find a provider instance by ID.
 * Returns null if not found.
 */
export async function findProviderInstance(
  ctx: ProviderContext,
  instanceId: string
): Promise<ConfiguredInstance | null> {
  const instances = await listProviderInstances(ctx);
  return instances.find((i) => i.id === instanceId) ?? null;
}

/**
 * Get a provider instance by ID.
 * Throws RouteValidationError if not found.
 */
export async function requireProviderInstance(
  ctx: ProviderContext,
  instanceId: string
): Promise<ConfiguredInstance> {
  const instance = await findProviderInstance(ctx, instanceId);
  if (!instance) {
    throw new RouteValidationError(`Instance not found: ${instanceId}`, 404, 'INSTANCE_NOT_FOUND');
  }
  return instance;
}

/**
 * Check if a provider exists in the catalog.
 * Throws RouteValidationError if not found.
 */
export async function requireProviderInCatalog(
  ctx: ProviderContext,
  providerId: string
): Promise<void> {
  const { providers } = (await ctx.supervisor.agentRequest({
    workspaceSessionId: ctx.workspaceSessionId,
    sessionId: ctx.agentSessionId,
    method: 'ent/providers/list',
  })) as { providers: Array<{ providerId: string }> };

  if (!providers.some((p) => p.providerId === providerId)) {
    throw new RouteValidationError(`Provider not found: ${providerId}`, 400, 'PROVIDER_NOT_FOUND');
  }
}

/**
 * Check if an instance ID already exists.
 * Throws RouteValidationError if duplicate.
 */
export async function requireInstanceNotExists(
  ctx: ProviderContext,
  instanceId: string
): Promise<void> {
  const instance = await findProviderInstance(ctx, instanceId);
  if (instance) {
    throw new RouteValidationError(
      `Instance ID already exists: ${instanceId}`,
      400,
      'DUPLICATE_INSTANCE_ID'
    );
  }
}
