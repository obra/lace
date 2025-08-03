// ABOUTME: Individual provider instance API endpoint
// ABOUTME: Handles getting and deleting specific provider instances

import { NextRequest } from 'next/server';
import { ProviderRegistry, ProviderInstanceManager } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { ConfiguredInstance } from '~/providers/registry';

export interface InstanceDetailResponse {
  instance: ConfiguredInstance;
}

export interface DeleteInstanceResponse {
  success: boolean;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    const { instanceId } = await params;
    
    const registry = new ProviderRegistry();
    await registry.initialize();

    const instances = registry.getConfiguredInstances();
    const instance = instances.find(inst => inst.id === instanceId);

    if (!instance) {
      return createErrorResponse(
        `Instance not found: ${instanceId}`,
        404,
        { code: 'INSTANCE_NOT_FOUND' }
      );
    }

    return createSuperjsonResponse({ instance } as InstanceDetailResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get provider instance';
    return createErrorResponse(errorMessage, 500, { 
      code: 'INSTANCE_GET_FAILED'
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
      return createErrorResponse(
        `Instance not found: ${instanceId}`,
        404,
        { code: 'INSTANCE_NOT_FOUND' }
      );
    }

    // Delete instance and credential
    await instanceManager.deleteInstance(instanceId);

    return createSuperjsonResponse({ success: true } as DeleteInstanceResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete provider instance';
    return createErrorResponse(errorMessage, 500, { 
      code: 'INSTANCE_DELETE_FAILED'
    });
  }
}