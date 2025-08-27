// ABOUTME: REST API endpoints for project environment variables - GET, PUT operations
// ABOUTME: Uses Project class environment manager for business logic and secure handling

import type { Route } from './+types/api.projects.$projectId.environment';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const SetEnvironmentVariablesSchema = z.object({
  variables: z.record(z.string()),
  encrypt: z.array(z.string()).optional(),
});

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { projectId } = params as { projectId: string };
    const project = Project.getById(projectId);
    if (!project) {
      return Response.json(
        { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const variables = project.getEnvironmentVariables();

    return Response.json({ variables });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch environment variables';
    return Response.json({ error: errorMessage, code: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  switch (request.method) {
    case 'PUT':
      try {
        const { projectId } = params as { projectId: string };
        const project = Project.getById(projectId);
        if (!project) {
          return Response.json(
            { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
            { status: 404 }
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { error: 'Invalid JSON', code: 'VALIDATION_FAILED' },
            { status: 400 }
          );
        }
        const validatedData = SetEnvironmentVariablesSchema.parse(body);

        project.setEnvironmentVariables(
          validatedData.variables,
          validatedData.encrypt ? { encrypt: validatedData.encrypt } : undefined
        );

        const updatedVariables = project.getEnvironmentVariables();

        return Response.json({ variables: updatedVariables });
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return Response.json(
            {
              error: 'Invalid request data',
              code: 'VALIDATION_FAILED',
              details: error.errors,
            },
            { status: 400 }
          );
        }

        const errorMessage = isError(error)
          ? error.message
          : 'Failed to update environment variables';
        return Response.json(
          { error: errorMessage, code: 'INTERNAL_SERVER_ERROR' },
          { status: 500 }
        );
      }
      break;

    case 'DELETE':
      try {
        const { projectId } = params as { projectId: string };
        const project = Project.getById(projectId);
        if (!project) {
          return Response.json(
            { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
            { status: 404 }
          );
        }

        const url = new URL(request.url);
        const key = url.searchParams.get('key');

        if (!key) {
          return Response.json(
            {
              error: 'Environment variable key is required',
              code: 'VALIDATION_FAILED',
            },
            { status: 400 }
          );
        }

        project.deleteEnvironmentVariable(key);

        return Response.json({ success: true });
      } catch (error: unknown) {
        const errorMessage = isError(error)
          ? error.message
          : 'Failed to delete environment variable';
        return Response.json(
          { error: errorMessage, code: 'INTERNAL_SERVER_ERROR' },
          { status: 500 }
        );
      }
      break;

    default:
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
}
