// ABOUTME: RESTful task management API - list and create tasks under project/session
// ABOUTME: Provides proper nested route structure for task CRUD operations

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import type { TaskFilters } from '@/lib/server/core-types';
import type { Task, TaskStatus, TaskPriority } from '@/types/api';

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

    const taskManager = session.getTaskManager();

    // Build filters from query params (same logic as before)
    const { searchParams } = new URL(request.url);
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
  } catch (error: unknown) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId } = await context.params;
    
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      prompt?: string;
      priority?: TaskPriority;
      assignedTo?: string;
    };
    const { title, description, prompt, priority, assignedTo } = body;

    if (!title || !prompt) {
      return NextResponse.json({ error: 'Title and prompt are required' }, { status: 400 });
    }

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

    const taskManager = session.getTaskManager();

    // Create task with human context (same logic as before)
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
  } catch (error: unknown) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}