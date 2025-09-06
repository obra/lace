// ABOUTME: User settings API endpoint
// ABOUTME: Handles GET, PUT, and PATCH operations for user preferences

import { UserSettingsManager } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { Route } from './+types/api.settings';

export async function loader({ request: _request }: Route.LoaderArgs) {
  try {
    const settings = UserSettingsManager.load();
    return createSuperjsonResponse(settings);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load settings';
    return createErrorResponse(errorMessage, 500, {
      code: 'SETTINGS_LOAD_FAILED',
    });
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method === 'PUT') {
      // Replace entire settings
      const body = (await request.json()) as Record<string, unknown>;
      UserSettingsManager.save(body);
      return createSuperjsonResponse(body);
    } else if (request.method === 'PATCH') {
      // Merge partial settings
      const partialSettings = (await request.json()) as Record<string, unknown>;
      const updatedSettings = UserSettingsManager.update(partialSettings);
      return createSuperjsonResponse(updatedSettings);
    } else {
      return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
    }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      // JSON parsing error
      return createErrorResponse('Invalid JSON in request body', 400, {
        code: 'INVALID_JSON',
      });
    }

    const errorMessage = error instanceof Error ? error.message : 'Failed to update settings';
    return createErrorResponse(errorMessage, 500, {
      code: 'SETTINGS_UPDATE_FAILED',
    });
  }
}
