// ABOUTME: Provider discovery API endpoint
// ABOUTME: Returns all available providers with their models and configuration status

import { NextResponse } from 'next/server';
import { ProviderRegistry } from '@/lib/server/lace-imports';
import type { ProviderInfo, ModelInfo } from '@/types/core';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export interface ProviderWithModels extends ProviderInfo {
  models: ModelInfo[];
  configured: boolean;
}

export interface ProvidersResponse {
  providers: ProviderWithModels[];
}

export async function GET(): Promise<NextResponse> {
  try {
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const providerData = registry.getAvailableProviders();

    const providers: ProviderWithModels[] = providerData.map(
      (data): ProviderWithModels => ({
        ...data.info,
        models: data.models,
        configured: data.configured,
      })
    );

    return createSuperjsonResponse({ providers });
  } catch (error: unknown) {
    console.error('Failed to get providers:', error);

    const errorMessage = isError(error) ? error.message : 'Failed to retrieve providers';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
