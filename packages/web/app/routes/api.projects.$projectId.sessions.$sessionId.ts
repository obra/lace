// ABOUTME: Individual session API endpoints - GET/PATCH/DELETE specific session in project
// ABOUTME: Uses Project class methods for session management with proper validation

import type { Route } from './+types/api.projects.$projectId.sessions.$sessionId';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { z } from 'zod';

const UpdateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  configuration: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { projectId, sessionId } = params as { projectId: string; sessionId: string };
    const project = Project.getById(projectId);
    if (!project) {
      return createSuperjsonResponse(
        { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const session = project.getSession(sessionId);
    if (!session) {
      return createSuperjsonResponse(
        {
          error: 'Session not found in this project',
          code: 'RESOURCE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    return createSuperjsonResponse(session);
  } catch (error: unknown) {
    return createSuperjsonResponse(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch session',
        code: 'INTERNAL_SERVER_ERROR',
      },
      { status: 500 }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  if ((request as Request).method === 'PATCH') {
    try {
      const { projectId, sessionId } = params as { projectId: string; sessionId: string };
      const body = (await (request as Request).json()) as Record<string, unknown>;
      const validatedData = UpdateSessionSchema.parse(body);

      const project = Project.getById(projectId);
      if (!project) {
        return createSuperjsonResponse(
          { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
          { status: 404 }
        );
      }

      const session = project.updateSession(sessionId, validatedData);
      if (!session) {
        return createSuperjsonResponse(
          {
            error: 'Session not found in this project',
            code: 'RESOURCE_NOT_FOUND',
          },
          { status: 404 }
        );
      }

      return createSuperjsonResponse(session);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return createSuperjsonResponse(
          {
            error: 'Invalid request data',
            code: 'VALIDATION_FAILED',
            details: error.errors,
          },
          { status: 400 }
        );
      }

      return createSuperjsonResponse(
        {
          error: error instanceof Error ? error.message : 'Failed to update session',
          code: 'INTERNAL_SERVER_ERROR',
        },
        { status: 500 }
      );
    }
  }

  if ((request as Request).method === 'DELETE') {
    try {
      const { projectId, sessionId } = params as { projectId: string; sessionId: string };
      const project = Project.getById(projectId);
      if (!project) {
        return createSuperjsonResponse(
          { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
          { status: 404 }
        );
      }

      const success = project.deleteSession(sessionId);
      if (!success) {
        return createSuperjsonResponse(
          {
            error: 'Session not found in this project',
            code: 'RESOURCE_NOT_FOUND',
          },
          { status: 404 }
        );
      }

      return createSuperjsonResponse({ success: true });
    } catch (error: unknown) {
      return createSuperjsonResponse(
        {
          error: error instanceof Error ? error.message : 'Failed to delete session',
          code: 'INTERNAL_SERVER_ERROR',
        },
        { status: 500 }
      );
    }
  }

  return createSuperjsonResponse({ error: 'Method not allowed' }, { status: 405 });
}
