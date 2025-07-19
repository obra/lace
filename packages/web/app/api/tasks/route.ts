// ABOUTME: API routes for task management - list and create tasks
// ABOUTME: Provides REST endpoints for task CRUD operations

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId } from '@/lib/server/core-types';
import type { TaskFilters } from '@/lib/server/core-types';
import type { Task, TaskStatus, TaskPriority } from '@/types/api';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

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

    // Build filters from query params
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

    // Convert dates to strings for JSON serialization
    const serializedTasks = tasks.map((task) => ({
      ...task,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
      notes: task.notes.map((note) => ({
        ...note,
        timestamp: note.timestamp instanceof Date ? note.timestamp.toISOString() : note.timestamp,
      })),
    }));

    return NextResponse.json({ tasks: serializedTasks });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      title?: string;
      description?: string;
      prompt?: string;
      priority?: TaskPriority;
      assignedTo?: string;
    };
    const { sessionId, title, description, prompt, priority, assignedTo } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    if (!title || !prompt) {
      return NextResponse.json({ error: 'Title and prompt are required' }, { status: 400 });
    }

    // Get session
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId as ThreadId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const taskManager = session.getTaskManager();

    // Create task with human context
    const createRequest = {
      title,
      prompt,
      priority: priority || 'medium',
      ...(description && { description }),
      ...(assignedTo && { assignedTo }),
    };

    const task = await taskManager.createTask(
      createRequest as Parameters<typeof taskManager.createTask>[0],
      {
        actor: 'human',
        isHuman: true,
      }
    );

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

    return NextResponse.json({ task: serializedTask }, { status: 201 });
  } catch (error) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}
