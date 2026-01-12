// ABOUTME: REST API endpoints for project environment variables - GET, PUT operations
// ABOUTME: Uses Project class environment manager for business logic and secure handling

import type { Route } from './+types/api.projects.$projectId.environment';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import {
  requireProjectId,
  requireProject,
  throwMethodNotAllowed,
  errorToResponse,
} from '@lace/web/lib/server/route-helpers';
import { z } from 'zod';

const SetEnvironmentVariablesSchema = z.object({
  variables: z.record(z.string()),
  encrypt: z.array(z.string()).optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const projectId = requireProjectId(params as Record<string, string | undefined>);
    const project = requireProject(projectId);
    const variables = project.getEnvironmentVariables();
    return createSuperjsonResponse({ variables });
  } catch (error: unknown) {
    return errorToResponse(error, 'Failed to fetch environment variables');
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    const projectId = requireProjectId(params as Record<string, string | undefined>);
    const project = requireProject(projectId);

    switch (request.method) {
      case 'PUT': {
        const body = (await request.json()) as unknown;
        const validatedData = SetEnvironmentVariablesSchema.parse(body);

        project.setEnvironmentVariables(
          validatedData.variables,
          validatedData.encrypt ? { encrypt: validatedData.encrypt } : undefined
        );

        const updatedVariables = project.getEnvironmentVariables();
        return createSuperjsonResponse({ variables: updatedVariables });
      }

      case 'DELETE': {
        const url = new URL(request.url);
        const key = url.searchParams.get('key');

        if (!key) {
          return createErrorResponse('Environment variable key is required', 400, {
            code: 'VALIDATION_FAILED',
          });
        }

        project.deleteEnvironmentVariable(key);
        return createSuperjsonResponse({ success: true });
      }

      default:
        throwMethodNotAllowed();
    }
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }
    return errorToResponse(error, 'Failed to update environment variables');
  }
}
