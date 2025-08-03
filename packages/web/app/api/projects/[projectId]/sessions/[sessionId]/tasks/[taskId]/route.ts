// ABOUTME: RESTful task detail API - GET/PATCH/DELETE specific task under project/session
// ABOUTME: Individual task operations with proper nested route validation

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { asThreadId } from '@/types/core';
import { Project } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import {
  ProjectIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  validateRouteParams,
  validateRequestBody,
  UpdateTaskSchema,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/server/api-utils';

const TaskRouteParamsSchema = z.object({
  projectId: ProjectIdSchema,
  sessionId: SessionIdSchema,
  taskId: TaskIdSchema,
});

interface RouteContext {
  params: Promise<{
    projectId: string;
    sessionId: string;
    taskId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId, taskId } = await validateRouteParams(
      context.params,
      TaskRouteParamsSchema
    );

    // Get project first to verify it exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Verify session belongs to this project
    const sessionData = project.getSession(sessionId);
    if (!sessionData) {
      return createErrorResponse('Session not found in this project', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Get active session instance
    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));
    if (!session) {
      return createErrorResponse('Session not active', 404);
    }

    const taskManager = session.getTaskManager();
    const task = taskManager.getTaskById(taskId);

    if (!task) {
      return createErrorResponse('Task not found', 404);
    }

    return createSuccessResponse({ task });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch task',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId, taskId } = await validateRouteParams(
      context.params,
      TaskRouteParamsSchema
    );

    // Validate request body
    let validatedBody;
    try {
      validatedBody = await validateRequestBody(await request.json(), UpdateTaskSchema);
    } catch (error) {
      return createErrorResponse(
        error instanceof Error ? error.message : 'Invalid request body',
        400
      );
    }

    // Get project first to verify it exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Verify session belongs to this project
    const sessionData = project.getSession(sessionId);
    if (!sessionData) {
      return createErrorResponse('Session not found in this project', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Get active session instance
    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));
    if (!session) {
      return createErrorResponse('Session not active', 404);
    }

    const taskManager = session.getTaskManager();

    // Filter out undefined properties
    const filteredUpdates = Object.fromEntries(
      Object.entries(validatedBody).filter(([_, value]) => value !== undefined)
    );

    // Update task with human context
    const task = await taskManager.updateTask(taskId, filteredUpdates, {
      actor: 'human',
      isHuman: true,
    });

    return createSuccessResponse({ task });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update task',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId, taskId } = await validateRouteParams(
      context.params,
      TaskRouteParamsSchema
    );

    // Get project first to verify it exists
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Verify session belongs to this project
    const sessionData = project.getSession(sessionId);
    if (!sessionData) {
      return createErrorResponse('Session not found in this project', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Get active session instance
    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));
    if (!session) {
      return createErrorResponse('Session not active', 404);
    }

    const taskManager = session.getTaskManager();

    try {
      await taskManager.deleteTask(taskId, {
        actor: 'human',
        isHuman: true,
      });

      return createSuccessResponse({ message: 'Task deleted successfully' });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Task not found') {
        return createErrorResponse('Task not found', 404);
      }
      throw error;
    }
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to delete task',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
