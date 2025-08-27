// ABOUTME: REST API endpoints for individual project operations - GET, PATCH, DELETE by project ID
// ABOUTME: Handles project retrieval, updates, and deletion with proper error handling and validation

import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  workingDirectory: z.string().min(1).optional(),
  configuration: z.record(z.unknown()).optional(),
  isArchived: z.boolean().optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    // Validate params
    const validationResult = RouteParamsSchema.safeParse(params);
    if (!validationResult.success) {
      return createErrorResponse('Invalid route parameters', 400, {
        code: 'VALIDATION_FAILED',
        details: validationResult.error.errors,
      });
    }

    const { projectId } = validationResult.data;
    const project = Project.getById(projectId);

    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const projectInfo = project.getInfo();

    return createSuperjsonResponse(projectInfo);
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch project',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  switch (request.method) {
    case 'PATCH':
      try {
        // Validate params
        const validationResult = RouteParamsSchema.safeParse(params);
        if (!validationResult.success) {
          return createErrorResponse('Invalid route parameters', 400, {
            code: 'VALIDATION_FAILED',
            details: validationResult.error.errors,
          });
        }

        const { projectId } = validationResult.data;
        const body = (await request.json()) as Record<string, unknown>;
        const validatedData = UpdateProjectSchema.parse(body);

        const project = Project.getById(projectId);

        if (!project) {
          return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
        }

        project.updateInfo(validatedData);

        const updatedProjectInfo = project.getInfo();

        return createSuperjsonResponse(updatedProjectInfo);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return createErrorResponse('Invalid request data', 400, {
            code: 'VALIDATION_FAILED',
            details: error.errors,
          });
        }

        return createErrorResponse(
          error instanceof Error ? error.message : 'Failed to update project',
          500,
          { code: 'INTERNAL_SERVER_ERROR' }
        );
      }
      break;

    case 'DELETE':
      try {
        // Validate params
        const validationResult = RouteParamsSchema.safeParse(params);
        if (!validationResult.success) {
          return createErrorResponse('Invalid route parameters', 400, {
            code: 'VALIDATION_FAILED',
            details: validationResult.error.errors,
          });
        }

        const { projectId } = validationResult.data;
        const project = Project.getById(projectId);

        if (!project) {
          return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
        }

        project.delete();

        return createSuperjsonResponse({ success: true });
      } catch (error) {
        return createErrorResponse(
          error instanceof Error ? error.message : 'Failed to delete project',
          500,
          { code: 'INTERNAL_SERVER_ERROR' }
        );
      }
      break;

    default:
      return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }
}
