// ABOUTME: RESTful task notes API - add notes to tasks under project/session
// ABOUTME: Provides note creation with proper nested route validation

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { logger } from '~/utils/logger';
import type { Task } from '@/types/api';

interface RouteContext {
  params: Promise<{
    projectId: string;
    sessionId: string;
    taskId: string;
  }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { projectId, sessionId, taskId } = await context.params;
    
    const body = (await request.json()) as {
      content?: string;
      author?: string;
    };
    const { content, author } = body;

    if (!content) {
      return NextResponse.json({ error: 'Note content is required' }, { status: 400 });
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

    try {
      // Add note with appropriate context
      await taskManager.addNote(taskId, content, {
        actor: author || 'human',
        isHuman: !author || author === 'human',
      });

      // Get updated task to return
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

      return NextResponse.json(
        { message: 'Note added successfully', task: serializedTask },
        { status: 201 }
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Task not found') {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      throw error;
    }
  } catch (error: unknown) {
    logger.error('Error adding note:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add note' },
      { status: 500 }
    );
  }
}