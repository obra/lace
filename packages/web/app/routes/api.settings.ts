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
      const body = await request.json();

      // Validate that body is a plain object
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return createErrorResponse('Request body must be a plain object', 400, {
          code: 'INVALID_PAYLOAD_TYPE',
        });
      }

      UserSettingsManager.save(body as Record<string, unknown>);
      return createSuperjsonResponse(body);
    } else if (request.method === 'PATCH') {
      // Merge partial settings
      const partialSettings = await request.json();

      // Validate that partialSettings is a plain object
      if (
        typeof partialSettings !== 'object' ||
        partialSettings === null ||
        Array.isArray(partialSettings)
      ) {
        return createErrorResponse('Request body must be a plain object', 400, {
          code: 'INVALID_PAYLOAD_TYPE',
        });
      }

      const updatedSettings = UserSettingsManager.update(
        partialSettings as Record<string, unknown>
      );
      return createSuperjsonResponse(updatedSettings);
    } else {
      const response = createErrorResponse('Method not allowed', 405, {
        code: 'METHOD_NOT_ALLOWED',
      });
      response.headers.set('Allow', 'PUT, PATCH');
      return response;
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
