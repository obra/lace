// ABOUTME: Provider instances API endpoint
// ABOUTME: Handles listing and creating provider instances with credential management

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { z } from 'zod';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';
import type { Route } from './+types/api.provider.instances';

export interface InstancesResponse {
  instances: ConfiguredInstance[];
}

export interface CreateInstanceResponse {
  success: boolean;
  instanceId: string;
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
    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

    const { connections } = (await supervisor.agentRequest({
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

    const instances: ConfiguredInstance[] = connections.map((c) => ({
      id: c.connectionId,
      displayName: c.name,
      catalogProviderId: c.providerId,
      endpoint: c.endpoint,
      timeout: c.timeout,
      retryPolicy: c.retryPolicy,
      modelConfig: c.modelConfig,
      hasCredentials: c.hasCredentials ?? c.credentialState === 'ready',
    }));

    return createSuperjsonResponse({ instances } as InstancesResponse);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to load provider instances';
    return createErrorResponse(errorMessage, 500, {
      code: 'INSTANCES_LOAD_FAILED',
    });
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
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

    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

    const { providers } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/providers/list',
    })) as { providers: Array<{ providerId: string }> };
    if (!providers.some((p) => p.providerId === validatedData.catalogProviderId)) {
      return createErrorResponse(`Provider not found: ${validatedData.catalogProviderId}`, 400, {
        code: 'PROVIDER_NOT_FOUND',
      });
    }

    const { connections } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/connections/list',
    })) as { connections: Array<{ connectionId: string }> };
    if (connections.some((c) => c.connectionId === validatedData.instanceId)) {
      return createErrorResponse(`Instance ID already exists: ${validatedData.instanceId}`, 400, {
        code: 'DUPLICATE_INSTANCE_ID',
      });
    }

    const config: Record<string, unknown> = {};
    if (validatedData.endpoint) config.endpoint = validatedData.endpoint;
    if (validatedData.timeout !== undefined) config.timeout = validatedData.timeout;
    if (validatedData.retryPolicy) config.retryPolicy = validatedData.retryPolicy;

    await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
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

    const credentialResult = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
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

    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create provider instance';
    return createErrorResponse(errorMessage, 500, {
      code: 'INSTANCE_CREATION_FAILED',
    });
  }
}
