// ABOUTME: Individual provider instance API endpoint
// ABOUTME: Handles getting and deleting specific provider instances

import { NextRequest } from 'next/server';
import { ProviderRegistry, ProviderInstanceManager } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { ConfiguredInstance } from '@/lib/server/lace-imports';
import { ProviderInstanceSchema, CredentialSchema } from '@/lib/server/lace-imports';

export interface InstanceDetailResponse {
  instance: ConfiguredInstance;
}

export interface DeleteInstanceResponse {
  success: boolean;
}

export interface UpdateInstanceResponse {
  instance: ConfiguredInstance;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    const { instanceId } = await params;

    const registry = ProviderRegistry.getInstance();

    const instances = await registry.getConfiguredInstances();
    const instance = instances.find((inst) => inst.id === instanceId);

    if (!instance) {
      return createErrorResponse(`Instance not found: ${instanceId}`, 404, {
        code: 'INSTANCE_NOT_FOUND',
      });
    }

    return createSuperjsonResponse({ instance } as InstanceDetailResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get provider instance';
    return createErrorResponse(errorMessage, 500, {
      code: 'INSTANCE_GET_FAILED',
    });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    const { instanceId } = await params;

    const instanceManager = new ProviderInstanceManager();
    const config = await instanceManager.loadInstances();

    // Check if instance exists
    if (!config.instances[instanceId]) {
      return createErrorResponse(`Instance not found: ${instanceId}`, 404, {
        code: 'INSTANCE_NOT_FOUND',
      });
    }

    // Delete instance and credential directly through InstanceManager
    await instanceManager.deleteInstance(instanceId);

    return createSuperjsonResponse({ success: true } as DeleteInstanceResponse);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to delete provider instance';
    return createErrorResponse(errorMessage, 500, {
      code: 'INSTANCE_DELETE_FAILED',
    });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    const { instanceId } = await params;
    const requestBody = (await request.json()) as Record<string, unknown>;

    const instanceManager = new ProviderInstanceManager();
    const config = await instanceManager.loadInstances();

    // Check if instance exists
    if (!config.instances[instanceId]) {
      return createErrorResponse(`Instance not found: ${instanceId}`, 404, {
        code: 'INSTANCE_NOT_FOUND',
      });
    }

    // Extract credential from request body if provided
    const { credential, ...instanceUpdates } = requestBody as { credential?: unknown };

    // Validate instance updates using Zod schema (partial validation)
    const updateSchema = ProviderInstanceSchema.partial();
    const validationResult = updateSchema.safeParse(instanceUpdates);

    if (!validationResult.success) {
      return createErrorResponse(`Invalid instance data: ${validationResult.error.message}`, 400, {
        code: 'VALIDATION_ERROR',
        details: validationResult.error.issues,
      });
    }

    // Update instance configuration (excluding catalogProviderId)
    const { catalogProviderId: _catalogProviderId, ...safeUpdates } = validationResult.data;
    if (Object.keys(safeUpdates).length > 0) {
      await instanceManager.updateInstance(instanceId, safeUpdates);
    }

    // Update credential if provided
    if (credential) {
      const credentialValidation = CredentialSchema.safeParse(credential);
      if (!credentialValidation.success) {
        return createErrorResponse(
          `Invalid credential data: ${credentialValidation.error.message}`,
          400,
          { code: 'CREDENTIAL_VALIDATION_ERROR' }
        );
      }
      await instanceManager.saveCredential(instanceId, credentialValidation.data);
    }

    // Get updated instance from registry for response
    const registry = ProviderRegistry.getInstance();
    const instances = await registry.getConfiguredInstances();
    const updatedInstance = instances.find((inst) => inst.id === instanceId);

    if (!updatedInstance) {
      return createErrorResponse('Instance not found after update', 500, { code: 'UPDATE_FAILED' });
    }

    return createSuperjsonResponse({ instance: updatedInstance } as UpdateInstanceResponse);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to update provider instance';
    return createErrorResponse(errorMessage, 500, {
      code: 'INSTANCE_UPDATE_FAILED',
    });
  }
}
