// ABOUTME: Provider instances API endpoint
// ABOUTME: Handles listing and creating provider instances with credential management

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { z } from 'zod';
import type { Route } from './+types/api.provider.instances';
import { throwMethodNotAllowed, errorToResponse } from '@lace/web/lib/server/route-helpers';
import {
  getProviderContext,
  listProviderInstances,
  requireProviderInCatalog,
  requireInstanceNotExists,
  type ConfiguredInstance,
} from '@lace/web/lib/server/provider-route-handlers';

export interface InstancesResponse {
  instances: ConfiguredInstance[];
}

export interface CreateInstanceResponse {
  success: boolean;
  instanceId: string;
}

export type { ConfiguredInstance };

const CreateInstanceSchema = z.object({
  instanceId: z
    .string()
    .min(1, 'Instance ID is required')
    .regex(
      /^[a-z0-9\-]+$/,
      'Instance ID must contain only lowercase letters, numbers, and hyphens'
    ),
  displayName: z.string().min(1, 'Display name is required'),
  catalogProviderId: z.string().min(1, 'Catalog provider ID is required'),
  endpoint: z.string().url().optional(),
  timeout: z.number().int().positive().optional(),
  retryPolicy: z.string().optional(),
  credential: z.object({
    apiKey: z.string().min(1, 'API key is required'),
    additionalAuth: z.record(z.unknown()).optional(),
  }),
});

export async function loader({ request: _request }: Route.LoaderArgs) {
  try {
    const ctx = await getProviderContext();
    const instances = await listProviderInstances(ctx);
    return createSuperjsonResponse({ instances } as InstancesResponse);
  } catch (error: unknown) {
    return errorToResponse(error, 'Failed to load provider instances');
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== 'POST') {
      throwMethodNotAllowed();
    }

    const body = (await request.json()) as unknown;
    const validatedData = CreateInstanceSchema.parse(body);

    if (
      validatedData.credential.additionalAuth &&
      Object.keys(validatedData.credential.additionalAuth).length > 0
    ) {
      return createErrorResponse('additionalAuth is not supported via ENT yet', 400, {
        code: 'CREDENTIAL_ADDITIONAL_AUTH_UNSUPPORTED',
      });
    }

    const ctx = await getProviderContext();
    await requireProviderInCatalog(ctx, validatedData.catalogProviderId);
    await requireInstanceNotExists(ctx, validatedData.instanceId);

    const config: Record<string, unknown> = {};
    if (validatedData.endpoint) config.endpoint = validatedData.endpoint;
    if (validatedData.timeout !== undefined) config.timeout = validatedData.timeout;
    if (validatedData.retryPolicy) config.retryPolicy = validatedData.retryPolicy;

    await ctx.supervisor.agentRequest({
      workspaceSessionId: ctx.workspaceSessionId,
      sessionId: ctx.agentSessionId,
      method: 'ent/connections/upsert',
      requestParams: {
        providerId: validatedData.catalogProviderId,
        connection: {
          connectionId: validatedData.instanceId,
          name: validatedData.displayName,
          config,
        },
      },
    });

    const credentialResult = (await ctx.supervisor.agentRequest({
      workspaceSessionId: ctx.workspaceSessionId,
      sessionId: ctx.agentSessionId,
      method: 'ent/connections/credentials/submit',
      requestParams: {
        connectionId: validatedData.instanceId,
        values: { apiKey: validatedData.credential.apiKey },
      },
    })) as { ok: boolean; error?: string };
    if (!credentialResult.ok) {
      return createErrorResponse(credentialResult.error ?? 'Failed to save credentials', 500, {
        code: 'CREDENTIAL_SAVE_FAILED',
      });
    }

    return createSuperjsonResponse(
      {
        success: true,
        instanceId: validatedData.instanceId,
      } as CreateInstanceResponse,
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      // Provide detailed field-level validation errors
      const fieldErrors: Record<string, string> = {};
      error.errors.forEach((err) => {
        const field = err.path.join('.');
        fieldErrors[field] = err.message;
      });

      const errorMessage = Object.entries(fieldErrors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join(', ');

      return createErrorResponse(`Validation failed: ${errorMessage}`, 400, {
        code: 'VALIDATION_FAILED',
        details: {
          errors: error.errors,
          fieldErrors,
          summary: errorMessage,
        },
      });
    }

    return errorToResponse(error, 'Failed to create provider instance');
  }
}
