// ABOUTME: Provider catalog API endpoint
// ABOUTME: Returns available providers from Catwalk catalog data with models and metadata

import { ProviderRegistry } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { CatalogProvider } from '@/lib/server/lace-imports';
import type { Route } from './+types/api.provider.catalog';

export interface CatalogResponse {
  providers: CatalogProvider[];
}

export async function loader({ request }: Route.LoaderArgs) {
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
