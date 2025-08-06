// ABOUTME: Provider catalog API endpoint
// ABOUTME: Returns available providers from Catwalk catalog data with models and metadata

import { NextRequest } from 'next/server';
import { ProviderRegistry } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { CatalogProvider } from '@/lib/server/lace-imports';

export interface CatalogResponse {
  providers: CatalogProvider[];
}

export async function GET(_request: NextRequest) {
  try {
    const registry = ProviderRegistry.getInstance();

    const providers = await registry.getCatalogProviders();

    return createSuperjsonResponse({ providers } as CatalogResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load provider catalog';
    return createErrorResponse(errorMessage, 500, {
      code: 'CATALOG_LOAD_FAILED',
    });
  }
}
