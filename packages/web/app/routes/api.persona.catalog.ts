// ABOUTME: Persona catalog API endpoint
// ABOUTME: Returns available personas via ENT protocol for agent creation

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import type { PersonaInfo } from '@lace/ent-protocol';
import type { Route } from './+types/api.persona.catalog';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';

export interface PersonaCatalogResponse {
  personas: PersonaInfo[];
}

export async function loader({ request: _request }: Route.LoaderArgs) {
  try {
    const supervisor = await getSupervisor();
    const mgmt = await getProviderManagementAgent();
    const res = await supervisor.agentRequest({
      workspaceSessionId: mgmt.workspaceSessionId,
      sessionId: mgmt.agentSessionId,
      method: 'ent/personas/list',
      requestParams: {},
    });

    const personas = (res as { personas?: PersonaInfo[] }).personas ?? [];

    return createSuperjsonResponse({ personas } as PersonaCatalogResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load persona catalog';
    return createErrorResponse(errorMessage, 500, {
      code: 'PERSONA_CATALOG_LOAD_FAILED',
    });
  }
}
