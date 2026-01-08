// ABOUTME: Individual provider instance API endpoint
// ABOUTME: Handles getting and deleting specific provider instances

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { z } from 'zod';
import type { Route } from './+types/api.provider.instances.$instanceId';

export interface InstanceDetailResponse {
  instance: ConfiguredInstance;
}

export interface DeleteInstanceResponse {
  success: boolean;
}

export interface UpdateInstanceResponse {
  instance: ConfiguredInstance;
}

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

const ModelConfigSchema = z
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

const UpdateInstanceSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    endpoint: z.string().url().optional(),
    timeout: z.number().int().positive().optional(),
    retryPolicy: z.string().optional(),
    catalogProviderId: z.string().optional(),
    modelConfig: ModelConfigSchema.optional(),
    credential: z
      .object({
        apiKey: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { instanceId } = params as { instanceId: string };

    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

    const { connections } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/connections/list',
    })) as { connections: Array<Record<string, unknown>> };

    const raw = connections.find((c) => c.connectionId === instanceId) as
      | (Record<string, unknown> & {
          connectionId: string;
          providerId: string;
          name: string;
          endpoint?: string;
          timeout?: number;
          retryPolicy?: string;
          modelConfig?: unknown;
          hasCredentials?: boolean;
          credentialState?: string;
        })
      | undefined;

    if (!raw) {
      return createErrorResponse(`Instance not found: ${instanceId}`, 404, {
        code: 'INSTANCE_NOT_FOUND',
      });
    }

    const instance: ConfiguredInstance = {
      id: raw.connectionId,
      displayName: raw.name,
      catalogProviderId: raw.providerId,
      endpoint: raw.endpoint,
      timeout: raw.timeout,
      retryPolicy: raw.retryPolicy,
      modelConfig: raw.modelConfig,
      hasCredentials: raw.hasCredentials ?? raw.credentialState === 'ready',
    };

    return createSuperjsonResponse({ instance } as InstanceDetailResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get provider instance';
    return createErrorResponse(errorMessage, 500, {
      code: 'INSTANCE_GET_FAILED',
    });
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const method = request.method;
  const { instanceId } = params as { instanceId: string };

  if (method === 'DELETE') {
    try {
      const supervisor = await getSupervisor();
      const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

      const { connections } = (await supervisor.agentRequest({
        workspaceSessionId,
        sessionId: agentSessionId,
        method: 'ent/connections/list',
      })) as { connections: Array<{ connectionId: string }> };

      if (!connections.some((c) => c.connectionId === instanceId)) {
        return createErrorResponse(`Instance not found: ${instanceId}`, 404, {
          code: 'INSTANCE_NOT_FOUND',
        });
      }

      await supervisor.agentRequest({
        workspaceSessionId,
        sessionId: agentSessionId,
        method: 'ent/connections/delete',
        requestParams: { connectionId: instanceId },
      });

      return createSuperjsonResponse({ success: true } as DeleteInstanceResponse);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to delete provider instance';
      return createErrorResponse(errorMessage, 500, {
        code: 'INSTANCE_DELETE_FAILED',
      });
    }
  }

  if (method === 'PUT') {
    try {
      const requestBody = (await request.json()) as unknown;
      const validated = UpdateInstanceSchema.parse(requestBody);

      const supervisor = await getSupervisor();
      const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

      const { connections } = (await supervisor.agentRequest({
        workspaceSessionId,
        sessionId: agentSessionId,
        method: 'ent/connections/list',
      })) as {
        connections: Array<{ connectionId: string; name: string; credentialState?: string }>;
      };

      const existing = connections.find((c) => c.connectionId === instanceId);
      if (!existing) {
        return createErrorResponse(`Instance not found: ${instanceId}`, 404, {
          code: 'INSTANCE_NOT_FOUND',
        });
      }

      const config: Record<string, unknown> = {};
      if (validated.endpoint) config.endpoint = validated.endpoint;
      if (validated.timeout !== undefined) config.timeout = validated.timeout;
      if (validated.retryPolicy) config.retryPolicy = validated.retryPolicy;
      if (validated.modelConfig) config.modelConfig = validated.modelConfig;

      if (validated.displayName || Object.keys(config).length > 0) {
        await supervisor.agentRequest({
          workspaceSessionId,
          sessionId: agentSessionId,
          method: 'ent/connections/upsert',
          requestParams: {
            connection: {
              connectionId: instanceId,
              name: validated.displayName ?? existing.name,
              config,
            },
          },
        });
      }

      if (validated.credential) {
        const result = (await supervisor.agentRequest({
          workspaceSessionId,
          sessionId: agentSessionId,
          method: 'ent/connections/credentials/submit',
          requestParams: {
            connectionId: instanceId,
            values: { apiKey: validated.credential.apiKey },
          },
        })) as { ok: boolean; error?: string };

        if (!result.ok) {
          return createErrorResponse(result.error ?? 'Failed to update credentials', 500, {
            code: 'CREDENTIAL_UPDATE_FAILED',
          });
        }
      }

      const refreshed = (await supervisor.agentRequest({
        workspaceSessionId,
        sessionId: agentSessionId,
        method: 'ent/connections/list',
      })) as {
        connections: Array<{
          connectionId: string;
          providerId: string;
          name: string;
          endpoint?: string;
          timeout?: number;
          retryPolicy?: string;
          modelConfig?: unknown;
          hasCredentials?: boolean;
          credentialState?: string;
        }>;
      };

      const updated = refreshed.connections.find((c) => c.connectionId === instanceId);
      if (!updated) {
        return createErrorResponse('Instance not found after update', 500, {
          code: 'UPDATE_FAILED',
        });
      }

      const instance: ConfiguredInstance = {
        id: updated.connectionId,
        displayName: updated.name,
        catalogProviderId: updated.providerId,
        endpoint: updated.endpoint,
        timeout: updated.timeout,
        retryPolicy: updated.retryPolicy,
        modelConfig: updated.modelConfig,
        hasCredentials: updated.hasCredentials ?? updated.credentialState === 'ready',
      };

      return createSuperjsonResponse({ instance } as UpdateInstanceResponse);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return createErrorResponse(`Invalid instance data: ${error.message}`, 400, {
          code: 'VALIDATION_ERROR',
          details: error.issues,
        });
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to update provider instance';
      return createErrorResponse(errorMessage, 500, {
        code: 'INSTANCE_UPDATE_FAILED',
      });
    }
  }

  return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
}
