// ABOUTME: RESTful task management API - list and create tasks under project/session
// ABOUTME: Provides proper nested route structure for task CRUD operations

import type { Route } from './+types/api.projects.$projectId.sessions.$sessionId.tasks';
import { z } from 'zod';
import { asThreadId } from '@/types/core';
import { Project } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import {
  ProjectIdSchema,
  SessionIdSchema,
  CreateTaskSchema,
  validateRouteParams,
  validateRequestBody,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/server/api-utils';
import type { TaskFilters } from '@/types/core';
import type { TaskStatus, TaskPriority } from '@/types/core';

const RouteParamsSchema = z.object({
  projectId: ProjectIdSchema,
  sessionId: SessionIdSchema,
});

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    const { projectId, sessionId } = validateRouteParams(params, RouteParamsSchema);

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

    // Build filters from query params
    const { searchParams } = new URL((request as Request).url);
    const filters: Partial<TaskFilters> = {};
    const status = searchParams.get('status') as TaskStatus | null;
    const priority = searchParams.get('priority') as TaskPriority | null;
    const assignedTo = searchParams.get('assignedTo');
    const createdBy = searchParams.get('createdBy');

    if (status) filters.status = status;
    if (priority) filters.priority = priority;
    if (assignedTo) filters.assignedTo = assignedTo;
    if (createdBy) filters.createdBy = createdBy;

    // Get tasks with filters
    const tasks = taskManager.getTasks(Object.keys(filters).length > 0 ? filters : undefined);

    return createSuccessResponse({ tasks });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch tasks',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    const { projectId, sessionId } = validateRouteParams(params, RouteParamsSchema);

    const body = (await (request as Request).json()) as Record<string, unknown>;
    let validatedBody;
    try {
      validatedBody = validateRequestBody(body, CreateTaskSchema);
    } catch (error) {
      // Return validation errors as 400 Bad Request
      return createErrorResponse(
        error instanceof Error ? error.message : 'Invalid request body',
        400
      );
    }
    const { title, description, prompt, priority, assignedTo } = validatedBody;

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

    // Create task with human context
    const createRequest: {
      title: string;
      prompt: string;
      priority: TaskPriority;
      description?: string;
      assignedTo?: string;
    } = {
      title,
      prompt,
      priority: (priority as TaskPriority) || 'medium',
    };

    if (description) {
      createRequest.description = description;
    }
    if (assignedTo && typeof assignedTo === 'string') {
      createRequest.assignedTo = assignedTo;
    }

    const task = await taskManager.createTask(createRequest, {
      actor: 'human',
      isHuman: true,
    });

    return createSuccessResponse({ task }, 201);
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to create task',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
