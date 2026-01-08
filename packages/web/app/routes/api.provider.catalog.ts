// ABOUTME: Provider catalog API endpoint
// ABOUTME: Returns available providers from Catwalk catalog data with models and metadata

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';
import type { Route } from './+types/api.provider.catalog';

export interface CatalogResponse {
  providers: Array<Record<string, unknown>>;
}

export async function loader({ request: _request }: Route.LoaderArgs) {
  try {
    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

    const { providers } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/providers/catalog',
    })) as { providers: Array<Record<string, unknown>> };

    return createSuperjsonResponse({ providers } as CatalogResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load provider catalog';
    return createErrorResponse(errorMessage, 500, {
      code: 'CATALOG_LOAD_FAILED',
    });
  }
}
