// ABOUTME: Integration tests for RESTful task detail API - GET/PATCH/DELETE specific task under project/session
// ABOUTME: Tests individual task operations with real implementations and proper nested route validation

/**
 * @vitest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET, PATCH, DELETE } from './route';
import { asThreadId } from '@/types/core';
import { Project, Session } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import { setupWebTest } from '@/test-utils/web-test-setup';
import type { Task } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '@/lib/server/lace-imports';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';

// Mock external dependencies only
vi.mock('server-only', () => ({}));

describe('/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: ReturnType<typeof getSessionService>;
  let testProjectId: string;
  let testSessionId: string;
  let testTaskId: string;
  let providerInstanceId: string;

  const mockTask: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> = {
    title: 'Test Task',
    description: 'Test description',
    prompt: 'Test prompt',
    status: 'pending',
    priority: 'medium',
    assignedTo: 'human',
    createdBy: asThreadId('lace_20250804_abc123'),
    threadId: asThreadId('lace_20250804_def456'),
    notes: [],
  };

  beforeEach(async () => {
    // Set up test provider defaults
    setupTestProviderDefaults();
    Session.clearProviderCache();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    sessionService = getSessionService();

    // Create a real test project with provider configuration
    const project = Project.create('Test Project', process.cwd(), 'Project for testing', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
    testProjectId = project.getId();

    // Create a real session
    const newSession = await sessionService.createSession('Test Session', testProjectId);
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

  afterEach(async () => {
    sessionService.clearActiveSessions();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('should return specific task', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`
      );
      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await GET(request, context)) as NextResponse;
      expect(response.status).toBe(200);

      const data = await parseResponse<{ task: Task }>(response);
      expect(data.task.id).toBe(testTaskId);
      expect(data.task.title).toBe('Test Task');
    });

    it('should return detailed validation error for invalid parameters', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/invalid-uuid/sessions/invalid-session/tasks/${testTaskId}`
      );
      const context = {
        params: Promise.resolve({
          projectId: 'invalid-uuid',
          sessionId: 'invalid-session',
          taskId: testTaskId,
        }),
      };

      const response = (await GET(request, context)) as NextResponse;
      expect(response.status).toBe(500);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toContain('Invalid route parameters:');
      expect(data.error).toContain('projectId');
      expect(data.error).toContain('sessionId');
    });

    it('should return 404 for non-existent project', async () => {
      const nonExistentProjectId = '00000000-0000-0000-0000-000000000000';
      const request = new NextRequest(
        `http://localhost/api/projects/${nonExistentProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`
      );
      const context = {
        params: Promise.resolve({
          projectId: nonExistentProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await GET(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      const nonExistentSessionId = 'lace_20000101_000000';
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${nonExistentSessionId}/tasks/${testTaskId}`
      );
      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: nonExistentSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await GET(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Session not found in this project');
    });

    it('should return 404 for non-existent task', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/nonexistent`
      );
      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: 'nonexistent',
        }),
      };

      const response = (await GET(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Task not found');
    });
  });

  describe('PATCH', () => {
    it('should update task properties', async () => {
      const updateData = { title: 'Updated Title', status: 'in_progress' as const };

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updateData),
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

      const response = (await PATCH(request, context)) as NextResponse;
      expect(response.status).toBe(200);

      const data = await parseResponse<{ task: Task }>(response);
      expect(data.task.title).toBe('Updated Title');
      expect(data.task.status).toBe('in_progress');
    });

    it('should return 404 for non-existent project', async () => {
      const nonExistentProjectId = '00000000-0000-0000-0000-000000000000';
      const request = new NextRequest(
        `http://localhost/api/projects/${nonExistentProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ title: 'Updated Title' }),
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

      const response = (await PATCH(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Project not found');
    });

    it('should handle partial updates', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ priority: 'high' }),
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

      const response = (await PATCH(request, context)) as NextResponse;
      expect(response.status).toBe(200);

      const data = await parseResponse<{ task: Task }>(response);
      expect(data.task.priority).toBe('high');
      expect(data.task.title).toBe('Test Task'); // Should remain unchanged
    });
  });

  describe('DELETE', () => {
    it('should delete task successfully', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`
      );
      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await DELETE(request, context)) as NextResponse;
      expect(response.status).toBe(200);

      const data = await parseResponse<{ message: string }>(response);
      expect(data.message).toBe('Task deleted successfully');
    });

    it('should return 404 for non-existent project', async () => {
      const nonExistentProjectId = '00000000-0000-0000-0000-000000000000';
      const request = new NextRequest(
        `http://localhost/api/projects/${nonExistentProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`
      );
      const context = {
        params: Promise.resolve({
          projectId: nonExistentProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await DELETE(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent task', async () => {
      // First delete the task, then try to delete it again
      await DELETE(
        new NextRequest(
          `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`
        ),
        {
          params: Promise.resolve({
            projectId: testProjectId,
            sessionId: testSessionId,
            taskId: testTaskId,
          }),
        }
      );

      // Now try to delete the already-deleted task
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks/${testTaskId}`
      );
      const context = {
        params: Promise.resolve({
          projectId: testProjectId,
          sessionId: testSessionId,
          taskId: testTaskId,
        }),
      };

      const response = (await DELETE(request, context)) as NextResponse;
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Task not found');
    });
  });
});
