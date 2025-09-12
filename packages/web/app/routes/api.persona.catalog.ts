// ABOUTME: Persona catalog API endpoint
// ABOUTME: Returns available personas from PersonaRegistry for agent creation

import { personaRegistry } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { PersonaInfo } from '@/lib/server/lace-imports';
import type { Route } from './+types/api.persona.catalog';

export interface PersonaCatalogResponse {
  personas: PersonaInfo[];
}

export async function loader({ request: _request }: Route.LoaderArgs) {
  try {
    const personas = personaRegistry.listAvailablePersonas();

    return createSuperjsonResponse({ personas } as PersonaCatalogResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load persona catalog';
    return createErrorResponse(errorMessage, 500, {
      code: 'PERSONA_CATALOG_LOAD_FAILED',
    });
  }
}
