// ABOUTME: Provider discovery API endpoint
// ABOUTME: Returns all available providers with their models and configuration status

import { NextResponse } from 'next/server';
import { ProviderRegistry } from '@/lib/server/lace-imports';
import type { ProviderInfo, ModelInfo } from '@/lib/server/lace-imports';

export interface ProviderWithModels extends ProviderInfo {
  models: ModelInfo[];
  configured: boolean;
}

export interface ProvidersResponse {
  providers: ProviderWithModels[];
}

export async function GET(): Promise<NextResponse<ProvidersResponse>> {
  try {
    const registry = new ProviderRegistry();
    const providerData = await registry.getAvailableProviders();
    
    const providers: ProviderWithModels[] = providerData.map(({ info, models, configured }) => ({
      ...info,
      models,
      configured,
    }));
    
    return NextResponse.json({ providers });
  } catch (error) {
    console.error('Failed to get providers:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve providers' },
      { status: 500 }
    );
  }
}