// ABOUTME: RESTful task notes API - add notes to tasks under project/session
// ABOUTME: Provides note creation with proper nested route validation

import type { Route } from './+types/api.projects.$projectId.sessions.$sessionId.tasks.$taskId.notes';
import { z } from 'zod';
import { asThreadId } from '@/types/core';
import { Project } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import {
  ProjectIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  AddNoteSchema,
  validateRouteParams,
  validateRequestBody,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/server/api-utils';

const NotesRouteParamsSchema = z.object({
  projectId: ProjectIdSchema,
  sessionId: SessionIdSchema,
  taskId: TaskIdSchema,
});

interface _RouteContext {
  params: Promise<{
    projectId: string;
    sessionId: string;
    taskId: string;
  }>;
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    const { projectId, sessionId, taskId } = validateRouteParams(params, NotesRouteParamsSchema);

    const body = (await (request as Request).json()) as Record<string, unknown>;
    let validatedBody;
    try {
      validatedBody = validateRequestBody(body, AddNoteSchema);
    } catch (error) {
      // Return validation errors as 400 Bad Request
      return createErrorResponse(
        error instanceof Error ? error.message : 'Invalid request body',
        400
      );
    }
    const { content, author } = validatedBody;

    // Get project first to verify it exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404);
    }

    // Verify session belongs to this project
    const sessionData = project.getSession(sessionId);
    if (!sessionData) {
      return createErrorResponse('Session not found in this project', 404);
    }

    // Get active session instance
    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));
    if (!session) {
      return createErrorResponse('Session not active', 404);
    }

    const taskManager = session.getTaskManager();

    try {
      // Add note with appropriate context
      await taskManager.addNote(taskId, content, {
        actor: author || 'human',
        isHuman: !author || author === 'human',
      });

      // Get updated task to return
      const task = taskManager.getTaskById(taskId);
      if (!task) {
        return createErrorResponse('Task not found', 404, { code: 'RESOURCE_NOT_FOUND' });
      }

      return createSuccessResponse({ message: 'Note added successfully', task }, 201);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Task not found') {
        return createErrorResponse('Task not found', 404, { code: 'RESOURCE_NOT_FOUND' });
      }
      throw error;
    }
  } catch (error: unknown) {
    return createErrorResponse(error instanceof Error ? error.message : 'Failed to add note', 500, {
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}
