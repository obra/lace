// ABOUTME: API routes for task notes - add notes to tasks
// ABOUTME: Provides REST endpoint for adding notes to tasks

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId } from '@/lib/server/core-types';
import type { Task } from '@/types/api';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const resolvedParams = await context.params;
    const body = (await request.json()) as {
      sessionId?: string;
      content?: string;
      author?: string;
    };
    const { sessionId, content, author } = body;
    const { taskId } = resolvedParams;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    if (!content) {
      return NextResponse.json({ error: 'Note content is required' }, { status: 400 });
    }

    // Get session
    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId as ThreadId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
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
    } catch (error) {
      if (error instanceof Error && error.message === 'Task not found') {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error adding note:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add note' },
      { status: 500 }
    );
  }
}
