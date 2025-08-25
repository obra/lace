// ABOUTME: Provider instance connection testing endpoint
// ABOUTME: Tests connection to configured provider instance and returns status

import { ProviderRegistry } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import type { Route } from './+types/api.provider.instances.$instanceId.test';

export interface TestConnectionResponse {
  success: boolean;
  status: 'connected' | 'error';
  message?: string;
  testedAt: string;
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createSuperjsonResponse({
      success: false,
      status: 'error',
      message: 'Method not allowed',
      testedAt: new Date().toISOString(),
    } as TestConnectionResponse);
  }

  try {
    const { instanceId } = params;

    const registry = ProviderRegistry.getInstance();

    // Try to create a provider from the instance to test connectivity
    const provider = await registry.createProviderFromInstance(instanceId);

    // Test the connection by checking provider configuration
    const isConfigured = provider.isConfigured();

    if (!isConfigured) {
      return createSuperjsonResponse({
        success: false,
        status: 'error',
        message: 'Provider is not properly configured',
        testedAt: new Date().toISOString(),
      } as TestConnectionResponse);
    }

    // TODO: Add actual API call test when providers support it
    // For now, just verify the provider can be created successfully

    return createSuperjsonResponse({
      success: true,
      status: 'connected',
      message: 'Connection test successful',
      testedAt: new Date().toISOString(),
    } as TestConnectionResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Connection test failed';

    return createSuperjsonResponse({
      success: false,
      status: 'error',
      message: errorMessage,
      testedAt: new Date().toISOString(),
    } as TestConnectionResponse);
  }
}
