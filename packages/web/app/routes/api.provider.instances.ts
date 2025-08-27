// ABOUTME: Provider instances API endpoint
// ABOUTME: Handles listing and creating provider instances with credential management

import {
  ProviderRegistry,
  ProviderInstanceManager,
  ProviderCatalogManager,
} from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import type { ConfiguredInstance } from '@/lib/server/lace-imports';
import type { Route } from './+types/api.provider.instances';

export interface InstancesResponse {
  instances: ConfiguredInstance[];
}

export interface CreateInstanceResponse {
  success: boolean;
  instanceId: string;
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
    const registry = ProviderRegistry.getInstance();

    const instances = await registry.getConfiguredInstances();

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

    // Validate catalog provider exists
    const catalogManager = new ProviderCatalogManager();
    await catalogManager.loadCatalogs();

    const catalogProvider = catalogManager.getProvider(validatedData.catalogProviderId);
    if (!catalogProvider) {
      return createErrorResponse(
        `Provider not found in catalog: ${validatedData.catalogProviderId}`,
        400,
        { code: 'PROVIDER_NOT_FOUND' }
      );
    }

    // Load existing instances
    const instanceManager = new ProviderInstanceManager();
    const config = await instanceManager.loadInstances();

    // Check for duplicate instance ID
    if (config.instances[validatedData.instanceId]) {
      return createErrorResponse(`Instance ID already exists: ${validatedData.instanceId}`, 400, {
        code: 'DUPLICATE_INSTANCE_ID',
      });
    }

    // Create new instance
    config.instances[validatedData.instanceId] = {
      displayName: validatedData.displayName,
      catalogProviderId: validatedData.catalogProviderId,
      endpoint: validatedData.endpoint,
      timeout: validatedData.timeout,
      retryPolicy: validatedData.retryPolicy,
    };

    // Save instance configuration
    await instanceManager.saveInstances(config);

    // Save credentials separately
    await instanceManager.saveCredential(validatedData.instanceId, {
      apiKey: validatedData.credential.apiKey,
      additionalAuth: validatedData.credential.additionalAuth,
    });

    // No need to refresh registry - it reads fresh data on demand

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
