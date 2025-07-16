// ABOUTME: API routes for individual task operations - get, update, delete
// ABOUTME: Provides REST endpoints for specific task management

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { Session, ThreadId } from '@/lib/server/lace-imports';
import type { Task } from '@/types/api';

interface RouteContext {
  params: {
    taskId: string;
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const { taskId } = context.params;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    // Get session to verify it exists
    const sessionService = getSessionService();
    const sessionData = await sessionService.getSession(sessionId as ThreadId);

    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get the actual Session instance to access TaskManager
    const session = await Session.getById(sessionId as ThreadId);
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
    const body = (await request.json()) as {
      sessionId?: string;
      status?: string;
      assignedTo?: string;
      priority?: string;
      title?: string;
      description?: string;
      prompt?: string;
    };
    const { sessionId, status, assignedTo, priority, title, description, prompt } = body;
    const { taskId } = context.params;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    // Get session to verify it exists
    const sessionService = getSessionService();
    const sessionData = await sessionService.getSession(sessionId as ThreadId);

    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get the actual Session instance to access TaskManager
    const session = await Session.getById(sessionId as ThreadId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const taskManager = session.getTaskManager();

    // Build updates object
    const updates: Partial<Task> = {};
    if (status !== undefined) updates.status = status;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (priority !== undefined) updates.priority = priority;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (prompt !== undefined) updates.prompt = prompt;

    // Update task with human context
    const task = await taskManager.updateTask(taskId, updates, {
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
    const { taskId } = context.params;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    // Get session to verify it exists
    const sessionService = getSessionService();
    const sessionData = await sessionService.getSession(sessionId as ThreadId);

    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get the actual Session instance to access TaskManager
    const session = await Session.getById(sessionId as ThreadId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const taskManager = session.getTaskManager();

    try {
      taskManager.deleteTask(taskId, {
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
