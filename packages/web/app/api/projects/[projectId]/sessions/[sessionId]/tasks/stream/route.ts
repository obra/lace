// ABOUTME: RESTful task SSE stream API - real-time task updates under project/session
// ABOUTME: Streams task events with proper nested route validation

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { logger } from '~/utils/logger';
import type { TaskEvent } from '@/hooks/useTaskStream';

interface RouteContext {
  params: Promise<{
    projectId: string;
    sessionId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId } = await context.params;

    // Get project first
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get session from project
    const session = project.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found in this project' }, { status: 404 });
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

        // Check if taskManager has event emitter methods
        if (typeof taskManager.on === 'function') {
          // Listen for task events
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
            if (typeof taskManager.off === 'function') {
              taskManager.off('task:created', handleTaskEvent);
              taskManager.off('task:updated', handleTaskEvent);
              taskManager.off('task:deleted', handleTaskEvent);
              taskManager.off('task:note_added', handleTaskEvent);
            }
            controller.close();
          });
        } else {
          // Fallback: just keep connection open for now
          logger.warn('TaskManager does not support event emitters yet');
          request.signal.addEventListener('abort', () => {
            controller.close();
          });
        }
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
    logger.error('Error in task SSE stream:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to establish SSE connection' },
      { status: 500 }
    );
  }
}