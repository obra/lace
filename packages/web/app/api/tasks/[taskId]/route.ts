// ABOUTME: API routes for individual task operations - get, update, delete
// ABOUTME: Provides REST endpoints for specific task management

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId } from '@/lib/server/core-types';
import type { Task } from '@/types/api';
import { UpdateTaskRequestSchema, ThreadIdSchema } from '@/lib/validation/schemas';

interface RouteContext {
  params: {
    taskId: string;
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const resolvedParams = await context.params;
    const { taskId } = resolvedParams;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    // Get session
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId as ThreadId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const taskManager = session.getTaskManager();
    const task = taskManager.getTaskById(taskId);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Convert dates to strings for JSON serialization
    const serializedTask: Task = {
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
      notes: task.notes.map((note) => ({
        ...note,
        timestamp: note.timestamp instanceof Date ? note.timestamp.toISOString() : note.timestamp,
      })),
    };

    return NextResponse.json({ task: serializedTask });
  } catch (error) {
    console.error('Error fetching task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch task' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const resolvedParams = await context.params;
    const { taskId } = resolvedParams;

    // Parse and validate request body
    const bodyRaw: unknown = await request.json();

    // Extract sessionId first for validation
    if (!bodyRaw || typeof bodyRaw !== 'object' || !('sessionId' in bodyRaw)) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const { sessionId: sessionIdRaw, ...updateFields } = bodyRaw as Record<string, unknown>;

    // Validate session ID
    const sessionIdResult = ThreadIdSchema.safeParse(sessionIdRaw);
    if (!sessionIdResult.success) {
      return NextResponse.json({ error: 'Invalid session ID format' }, { status: 400 });
    }

    const sessionId = sessionIdResult.data;

    // Validate update fields
    const updateResult = UpdateTaskRequestSchema.safeParse(updateFields);
    if (!updateResult.success) {
      return NextResponse.json(
        {
          error: updateResult.error.errors[0]?.message || 'Invalid update fields',
        },
        { status: 400 }
      );
    }

    const updates = updateResult.data;

    // Get session
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId as ThreadId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const taskManager = session.getTaskManager();

    // Filter out undefined properties for exactOptionalPropertyTypes
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );

    // Update task with human context
    const task = await taskManager.updateTask(taskId, filteredUpdates, {
      actor: 'human',
      isHuman: true,
    });

    // Convert dates to strings for JSON serialization
    const serializedTask: Task = {
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
      notes: task.notes.map((note) => ({
        ...note,
        timestamp: note.timestamp instanceof Date ? note.timestamp.toISOString() : note.timestamp,
      })),
    };

    return NextResponse.json({ task: serializedTask });
  } catch (error) {
    console.error('Error updating task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update task' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const resolvedParams = await context.params;
    const { taskId } = resolvedParams;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    // Get session
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId as ThreadId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const taskManager = session.getTaskManager();

    try {
      await taskManager.deleteTask(taskId, {
        actor: 'human',
        isHuman: true,
      });

      return NextResponse.json({ message: 'Task deleted successfully' });
    } catch (error) {
      if (error instanceof Error && error.message === 'Task not found') {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error deleting task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete task' },
      { status: 500 }
    );
  }
}
