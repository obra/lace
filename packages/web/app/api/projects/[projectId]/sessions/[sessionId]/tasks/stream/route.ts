// ABOUTME: RESTful task SSE stream API - real-time task updates under project/session
// ABOUTME: Streams task events with proper nested route validation

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Project, asThreadId } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import {
  ProjectIdSchema,
  SessionIdSchema,
  validateRouteParams,
  createErrorResponse,
} from '@/lib/server/api-utils';
import type { TaskEvent } from '@/hooks/useTaskStream';

const RouteParamsSchema = z.object({
  projectId: ProjectIdSchema,
  sessionId: SessionIdSchema,
});

interface RouteContext {
  params: Promise<{
    projectId: string;
    sessionId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    let projectId: string, sessionId: string;
    try {
      ({ projectId, sessionId } = await validateRouteParams(context.params, RouteParamsSchema));
    } catch (error) {
      return createErrorResponse(
        error instanceof Error ? error.message : 'Invalid route parameters',
        400
      );
    }

    // Get project first
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

    // Create SSE stream
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection message
        const message = `data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`;
        controller.enqueue(encoder.encode(message));

        // Get task manager to listen for events
        const taskManager = session.getTaskManager();

        // Listen for task events (TaskManager extends EventEmitter)
        const handleTaskEvent = (event: TaskEvent) => {
          const message = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        // Subscribe to task events
        taskManager.on('task:created', handleTaskEvent);
        taskManager.on('task:updated', handleTaskEvent);
        taskManager.on('task:deleted', handleTaskEvent);
        taskManager.on('task:note_added', handleTaskEvent);

        // Clean up on close
        request.signal.addEventListener('abort', () => {
          taskManager.off('task:created', handleTaskEvent);
          taskManager.off('task:updated', handleTaskEvent);
          taskManager.off('task:deleted', handleTaskEvent);
          taskManager.off('task:note_added', handleTaskEvent);
          controller.close();
        });
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to establish SSE connection',
      500,
      error
    );
  }
}
