// ABOUTME: REST API endpoints for individual project operations - GET, PATCH, DELETE by project ID
// ABOUTME: Handles project retrieval, updates, and deletion with proper error handling and validation

import { Project } from '@lace/web/lib/server/projects/project';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import {
  requireProjectId,
  throwNotFound,
  throwMethodNotAllowed,
  errorToResponse,
} from '@lace/web/lib/server/route-helpers';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId';

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  workingDirectory: z.string().min(1).optional(),
  configuration: z.record(z.unknown()).optional(),
  isArchived: z.boolean().optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const projectId = requireProjectId(params);
    const project = Project.getById(projectId);

    if (!project) {
      throwNotFound('Project');
    }

    const projectInfo = project.getInfo();

    const supervisor = await getSupervisor();
    const sessionCount = (await supervisor.listWorkspaceSessions()).filter(
      (s) => s.projectId === projectId
    ).length;

    return createSuperjsonResponse({ ...projectInfo, sessionCount });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    const projectId = requireProjectId(params);
    const project = Project.getById(projectId);

    if (!project) {
      throwNotFound('Project');
    }

    switch (request.method) {
      case 'PATCH': {
        const body = (await request.json()) as Record<string, unknown>;
        const validatedData = UpdateProjectSchema.parse(body);

        project.updateInfo(validatedData);

        const updatedProjectInfo = project.getInfo();

        const supervisor = await getSupervisor();
        const sessionCount = (await supervisor.listWorkspaceSessions()).filter(
          (s) => s.projectId === projectId
        ).length;

        return createSuperjsonResponse({ ...updatedProjectInfo, sessionCount });
      }

      case 'DELETE': {
        project.delete();
        return createSuperjsonResponse({ success: true });
      }

      default:
        throwMethodNotAllowed();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }
    return errorToResponse(error);
  }
}
