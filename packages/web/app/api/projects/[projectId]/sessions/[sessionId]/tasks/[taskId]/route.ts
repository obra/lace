// ABOUTME: RESTful task detail API - GET/PATCH/DELETE specific task under project/session
// ABOUTME: Individual task operations with proper nested route validation

import { NextRequest, NextResponse } from 'next/server';
import { Project, asThreadId } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import { serializeTask, createErrorResponse, createSuccessResponse } from '@/lib/server/api-utils';
import { logger } from '@/lib/server/lace-imports';

interface RouteContext {
  params: Promise<{
    projectId: string;
    sessionId: string;
    taskId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId, taskId } = await context.params;

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
    const task = taskManager.getTaskById(taskId);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Serialize task for JSON response
    const serializedTask = serializeTask(task);

    return createSuccessResponse({ task: serializedTask });
  } catch (error: unknown) {
    const errorToLog = error instanceof Error ? error : new Error(String(error));
    logger.error('Error fetching task:', errorToLog);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch task' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId, taskId } = await context.params;

    // Parse request body
    const body = (await request.json()) as Record<string, unknown>;

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

    // Filter out undefined properties
    const filteredUpdates = Object.fromEntries(
      Object.entries(body).filter(([_, value]) => value !== undefined)
    );

    // Update task with human context
    const task = await taskManager.updateTask(taskId, filteredUpdates, {
      actor: 'human',
      isHuman: true,
    });

    // Serialize task for JSON response
    const serializedTask = serializeTask(task);

    return createSuccessResponse({ task: serializedTask });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update task',
      500,
      error
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId, taskId } = await context.params;

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
      await taskManager.deleteTask(taskId, {
        actor: 'human',
        isHuman: true,
      });

      return NextResponse.json({ message: 'Task deleted successfully' });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Task not found') {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      throw error;
    }
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to delete task',
      500,
      error
    );
  }
}
