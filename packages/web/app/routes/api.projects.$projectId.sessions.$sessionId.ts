// ABOUTME: Individual session API endpoints - GET/PATCH/DELETE specific workspace session in project
// ABOUTME: Uses supervisor-backed workspace sessions (no SQLite session records)

import type { Route } from './+types/api.projects.$projectId.sessions.$sessionId';
import { Project } from '@lace/web/lib/server/projects/project';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { isWorkspaceSessionId } from '@lace/web/lib/validation/session-id-validation';
import { z } from 'zod';

const UpdateSessionSchema = z.object({
  name: z.string().min(1).optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { projectId, sessionId } = params as { projectId: string; sessionId: string };
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    if (!isWorkspaceSessionId(sessionId)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(sessionId);
    if (!record || record.projectId !== projectId) {
      return createErrorResponse('Session not found in this project', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    return createSuperjsonResponse({
      id: record.workspaceSessionId,
      name: record.name ?? 'Session',
      projectId,
      createdAt: new Date(record.createdAt),
      agentCount: record.agents.length,
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch session',
      500,
      {
        code: 'INTERNAL_SERVER_ERROR',
      }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === 'PATCH') {
    try {
      const { projectId, sessionId } = params as { projectId: string; sessionId: string };
      const body = (await request.json()) as Record<string, unknown>;
      const validatedData = UpdateSessionSchema.parse(body);

      const project = Project.getById(projectId);
      if (!project) {
        return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
      }

      if (!isWorkspaceSessionId(sessionId)) {
        return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
      }

      const supervisor = await getSupervisor();
      const existing = await supervisor.getWorkspaceSession(sessionId);
      if (!existing || existing.projectId !== projectId) {
        return createErrorResponse('Session not found in this project', 404, {
          code: 'RESOURCE_NOT_FOUND',
        });
      }

      if (typeof validatedData.name === 'string') {
        await supervisor.updateWorkspaceSession(sessionId, { name: validatedData.name });
      }

      const record = await supervisor.getWorkspaceSession(sessionId);
      if (!record) {
        return createErrorResponse('Session not found after update', 500, {
          code: 'INTERNAL_SERVER_ERROR',
        });
      }

      return createSuperjsonResponse({
        id: record.workspaceSessionId,
        name: record.name ?? 'Session',
        projectId,
        createdAt: new Date(record.createdAt),
        agentCount: record.agents.length,
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return createErrorResponse('Invalid request data', 400, {
          code: 'VALIDATION_FAILED',
          details: error.errors,
        });
      }

      return createErrorResponse(
        error instanceof Error ? error.message : 'Failed to update session',
        500,
        { code: 'INTERNAL_SERVER_ERROR' }
      );
    }
  }

  if (request.method === 'DELETE') {
    try {
      const { projectId, sessionId } = params as { projectId: string; sessionId: string };
      const project = Project.getById(projectId);
      if (!project) {
        return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
      }

      if (!isWorkspaceSessionId(sessionId)) {
        return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
      }

      const supervisor = await getSupervisor();
      const record = await supervisor.getWorkspaceSession(sessionId);
      if (!record || record.projectId !== projectId) {
        return createErrorResponse('Session not found in this project', 404, {
          code: 'RESOURCE_NOT_FOUND',
        });
      }

      await supervisor.deleteWorkspaceSession(sessionId);

      return createSuperjsonResponse({ success: true });
    } catch (error: unknown) {
      return createErrorResponse(
        error instanceof Error ? error.message : 'Failed to delete session',
        500,
        { code: 'INTERNAL_SERVER_ERROR' }
      );
    }
  }

  return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
}
