// ABOUTME: Integration tests for RESTful task notes API - add notes to tasks under project/session
// ABOUTME: Tests note creation with real implementations and proper nested route validation

/**
 * @vitest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from './route';
import { Project, asThreadId } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import type { Task } from '@/types/core';

// Mock external dependencies only
vi.mock('server-only', () => ({}));

describe('/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/notes', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let testProjectId: string;
  let testSessionId: string;
  let testTaskId: string;

  const mockTask: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> = {
    title: 'Test Task',
    description: 'Test description',
    prompt: 'Test prompt',
    status: 'pending',
    priority: 'medium',
    assignedTo: 'user1',
    createdBy: 'human',
    threadId: 'session1',
    notes: [],
  };

  beforeEach(async () => {
    setupTestPersistence();

    // Set up environment for session service
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Create a real test project
    const project = Project.create('Test Project', process.cwd(), 'Project for testing');
    testProjectId = project.getId();

    // Create a real session
    const newSession = await sessionService.createSession(
      'Test Session',
      'anthropic',
      'claude-3-5-haiku-20241022',
      testProjectId
    );
    testSessionId = newSession.id;

    // Get the active session instance to access task manager
    const session = await sessionService.getSession(asThreadId(testSessionId));
    if (!session) {
      throw new Error('Failed to get active session');
    }

    // Create a real task for testing
    const taskManager = session.getTaskManager();
    const task = await taskManager.createTask(
      {
        title: mockTask.title,
        description: mockTask.description,
        prompt: mockTask.prompt,
        priority: mockTask.priority,
        assignedTo: mockTask.assignedTo,
      },
      {
        actor: 'human',
        isHuman: true,
      }
    );
    testTaskId = task.id;
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    teardownTestPersistence();
    vi.clearAllMocks();
  });

  describe('POST', () => {
    it('should add note to task successfully', async () => {
      const requestBody = {
        content: 'Test note content',
      };

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(201);

      const data = (await response.json()) as { message: string; task: Task };
      expect(data.message).toBe('Note added successfully');
      expect(data.task.id).toBe(testTaskId);
      expect(data.task.notes).toHaveLength(1);
      expect(data.task.notes[0].content).toBe('Test note content');
    });

    it('should add note with specified author', async () => {
      const requestBody = {
        content: 'Agent note content',
        author: 'agent',
      };

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(201);

      const data = (await response.json()) as { message: string; task: Task };
      expect(data.message).toBe('Note added successfully');
      expect(data.task.notes).toHaveLength(1);
      expect(data.task.notes[0].content).toBe('Agent note content');
      expect(data.task.notes[0].author).toBe('agent');
    });

    it('should return 400 for empty content', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ content: '' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(400);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Invalid request body: content: Note content is required');
    });

    it('should return 400 for missing content field', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(400);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Invalid request body: content: Required');
    });

    it('should return detailed validation error for invalid parameters', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/invalid-uuid/sessions/invalid-session/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ content: 'Test note' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: 'invalid-uuid',
          sessionId: 'invalid-session',
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toContain('Invalid route parameters:');
      expect(data.error).toContain('projectId');
      expect(data.error).toContain('sessionId');
    });

    it('should return 404 for non-existent project', async () => {
      const nonExistentProjectId = '00000000-0000-0000-0000-000000000000';
      const request = new NextRequest(
        `http://localhost/api/projects/${nonExistentProjectId}/sessions/${testSessionId}/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ content: 'Test note' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: nonExistentProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      const nonExistentSessionId = 'lace_20000101_000000';
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${nonExistentSessionId}/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ content: 'Test note' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: nonExistentSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Session not found in this project');
    });

    it('should return 404 for non-existent task', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/nonexistent/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ content: 'Test note' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: 'nonexistent',
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Task not found');
    });

    it('should handle database errors', async () => {
      // Simulate database error by trying to add note to already deleted task
      const session = await sessionService.getSession(asThreadId(testSessionId));
      if (!session) throw new Error('Session not found');

      const taskManager = session.getTaskManager();
      // Delete the task first to cause an error
      await taskManager.deleteTask(testTaskId, { actor: 'human', isHuman: true });

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ content: 'Test note' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Task not found');
    });

    it('should default to human author when not specified', async () => {
      const requestBody = {
        content: 'Human note content',
      };

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await POST(request, context)) as NextResponse;
      expect(response.status).toBe(201);

      const data = (await response.json()) as { message: string; task: Task };
      expect(data.message).toBe('Note added successfully');
      expect(data.task.notes).toHaveLength(1);
      expect(data.task.notes[0].content).toBe('Human note content');
      expect(data.task.notes[0].author).toBe('human');
    });
  });
});
