// ABOUTME: Individual provider instance API endpoint
// ABOUTME: Handles getting and deleting specific provider instances

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { z } from 'zod';
import type { Route } from './+types/api.provider.instances.$instanceId';
import {
  requireParam,
  throwMethodNotAllowed,
  errorToResponse,
} from '@lace/web/lib/server/route-helpers';
import {
  getProviderContext,
  requireProviderInstance,
  toConfiguredInstance,
  ModelConfigSchema,
  type ConfiguredInstance,
  type ConnectionResponse,
} from '@lace/web/lib/server/provider-route-handlers';

export interface InstanceDetailResponse {
  instance: ConfiguredInstance;
}

export interface DeleteInstanceResponse {
  success: boolean;
}

export interface UpdateInstanceResponse {
  instance: ConfiguredInstance;
}

export type { ConfiguredInstance };

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
    const instanceId = requireParam(params as Record<string, string | undefined>, 'instanceId');
    const ctx = await getProviderContext();
    const instance = await requireProviderInstance(ctx, instanceId);
    return createSuperjsonResponse({ instance } as InstanceDetailResponse);
  } catch (error: unknown) {
    return errorToResponse(error, 'Failed to get provider instance');
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    const instanceId = requireParam(params as Record<string, string | undefined>, 'instanceId');
    const ctx = await getProviderContext();
    const method = request.method;

    if (method === 'DELETE') {
      // Verify instance exists before deleting
      await requireProviderInstance(ctx, instanceId);

      await ctx.supervisor.agentRequest({
        workspaceSessionId: ctx.workspaceSessionId,
        sessionId: ctx.agentSessionId,
        method: 'ent/connections/delete',
        requestParams: { connectionId: instanceId },
      });

      return createSuperjsonResponse({ success: true } as DeleteInstanceResponse);
    }

    if (method === 'PUT') {
      const requestBody = (await request.json()) as unknown;
      const validated = UpdateInstanceSchema.parse(requestBody);

      // Get existing instance for the name fallback
      const existing = await requireProviderInstance(ctx, instanceId);

      const config: Record<string, unknown> = {};
      if (validated.endpoint) config.endpoint = validated.endpoint;
      if (validated.timeout !== undefined) config.timeout = validated.timeout;
      if (validated.retryPolicy) config.retryPolicy = validated.retryPolicy;
      if (validated.modelConfig) config.modelConfig = validated.modelConfig;

      if (validated.displayName || Object.keys(config).length > 0) {
        await ctx.supervisor.agentRequest({
          workspaceSessionId: ctx.workspaceSessionId,
          sessionId: ctx.agentSessionId,
          method: 'ent/connections/upsert',
          requestParams: {
            connection: {
              connectionId: instanceId,
              name: validated.displayName ?? existing.displayName,
              config,
            },
          },
        });
      }

      if (validated.credential) {
        const result = (await ctx.supervisor.agentRequest({
          workspaceSessionId: ctx.workspaceSessionId,
          sessionId: ctx.agentSessionId,
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

      // Refresh instance to get updated values
      const refreshed = (await ctx.supervisor.agentRequest({
        workspaceSessionId: ctx.workspaceSessionId,
        sessionId: ctx.agentSessionId,
        method: 'ent/connections/list',
      })) as { connections: ConnectionResponse[] };

      const updated = refreshed.connections.find((c) => c.connectionId === instanceId);
      if (!updated) {
        return createErrorResponse('Instance not found after update', 500, {
          code: 'UPDATE_FAILED',
        });
      }

      return createSuperjsonResponse({
        instance: toConfiguredInstance(updated),
      } as UpdateInstanceResponse);
    }

    throwMethodNotAllowed();
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(`Invalid instance data: ${error.message}`, 400, {
        code: 'VALIDATION_ERROR',
        details: error.issues,
      });
    }
    return errorToResponse(error, 'Failed to update provider instance');
  }
}
