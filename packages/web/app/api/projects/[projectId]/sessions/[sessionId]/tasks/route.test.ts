// ABOUTME: Integration tests for RESTful task management API - list and create tasks under project/session
// ABOUTME: Tests proper nested route structure and task CRUD operations with real implementations

/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET, POST } from './route';
import { asThreadId } from '@/types/core';
import { Project, Session } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import { setupWebTest } from '@/test-utils/web-test-setup';
import { setupTestProviderDefaults, cleanupTestProviderDefaults } from '~/test-utils/provider-defaults';
import { createTestProviderInstance, cleanupTestProviderInstances } from '~/test-utils/provider-instances';
import type { Task } from '@/types/core';
import { parseResponse } from '@/lib/serialization';

// Mock external dependencies only
vi.mock('server-only', () => ({}));

describe('/api/projects/[projectId]/sessions/[sessionId]/tasks', () => {
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
    // Set up test provider defaults and create instance
    setupTestProviderDefaults();
    Session.clearProviderCache();
    
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      apiKey: 'test-anthropic-key',
    });


    sessionService = getSessionService();

    // Create a real test project with provider configuration
    const project = Project.create(
      'Test Project',
      process.cwd(),
      'Project for testing',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    testProjectId = project.getId();

    // Create a real session that inherits from project
    const newSession = Session.create({
      name: 'Test Session',
      projectId: testProjectId,
    });
    testSessionId = newSession.getId();

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
    it('should return tasks for valid project/session', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks`
      );
      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: testSessionId }),
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      const data = await parseResponse<{ tasks: Task[] }>(response);
      expect(data).toHaveProperty('tasks');
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].id).toBe(testTaskId);
    });

    it('should return 404 for non-existent project', async () => {
      const nonExistentProjectId = '550e8400-e29b-41d4-a716-446655440001';

      const request = new NextRequest(
        `http://localhost/api/projects/${nonExistentProjectId}/sessions/${testSessionId}/tasks`
      );
      const context = {
        params: Promise.resolve({ projectId: nonExistentProjectId, sessionId: testSessionId }),
      };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      const nonExistentSessionId = 'lace_20250724_nonext';

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${nonExistentSessionId}/tasks`
      );
      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: nonExistentSessionId }),
      };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Session not found in this project');
    });

    it('should apply status filter', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks?status=pending`
      );
      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: testSessionId }),
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      const data = await parseResponse<{ tasks: Task[] }>(response);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].status).toBe('pending');
    });

    it('should apply priority filter', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks?priority=medium`
      );
      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: testSessionId }),
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      const data = await parseResponse<{ tasks: Task[] }>(response);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].priority).toBe('medium');
    });

    it('should apply multiple filters', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks?status=pending&priority=medium&assignedTo=human`
      );
      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: testSessionId }),
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      const data = await parseResponse<{ tasks: Task[] }>(response);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].status).toBe('pending');
      expect(data.tasks[0].priority).toBe('medium');
      expect(data.tasks[0].assignedTo).toBe('human');
    });

    it('should return empty tasks list when no tasks exist', async () => {
      // Create a new session without any tasks that inherits from project
      const newSession = Session.create({
        name: 'Empty Session',
        projectId: testProjectId,
      });

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${newSession.getId()}/tasks`
      );
      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: newSession.getId() }),
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      const data = await parseResponse<{ tasks: Task[] }>(response);
      expect(data.tasks).toHaveLength(0);
    });
  });

  describe('POST', () => {
    it('should create task with valid data', async () => {
      const requestBody = {
        title: 'New Test Task',
        prompt: 'New test prompt',
        priority: 'high' as const,
      };

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: testSessionId }),
      };

      const response = await POST(request, context);
      expect(response.status).toBe(201);

      const data = await parseResponse<{ task: Task }>(response);
      expect(data.task).toHaveProperty('id');
      expect(data.task.title).toBe('New Test Task');
      expect(data.task.prompt).toBe('New test prompt');
      expect(data.task.priority).toBe('high');
    });

    it('should validate required fields', async () => {
      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Missing prompt' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: testSessionId }),
      };

      const response = await POST(request, context);
      expect(response.status).toBe(400);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toContain('prompt: Required');
    });

    it('should return 404 for non-existent project', async () => {
      const nonExistentProjectId = '550e8400-e29b-41d4-a716-446655440002';

      const request = new NextRequest(
        `http://localhost/api/projects/${nonExistentProjectId}/sessions/${testSessionId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Test Task', prompt: 'Test prompt' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({ projectId: nonExistentProjectId, sessionId: testSessionId }),
      };

      const response = await POST(request, context);
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      const nonExistentSessionId = 'lace_20250724_nonex2';

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${nonExistentSessionId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Test Task', prompt: 'Test prompt' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: nonExistentSessionId }),
      };

      const response = await POST(request, context);
      expect(response.status).toBe(404);

      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Session not found in this project');
    });

    it('should create task with optional fields', async () => {
      const requestBody = {
        title: 'Task with Optional Fields',
        description: 'Task with description',
        prompt: 'Test prompt with options',
        priority: 'low' as const,
        assignedTo: 'specific-user',
      };

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: testSessionId }),
      };

      const response = await POST(request, context);
      expect(response.status).toBe(201);

      const data = await parseResponse<{ task: Task }>(response);
      expect(data.task.title).toBe('Task with Optional Fields');
      expect(data.task.description).toBe('Task with description');
      expect(data.task.assignedTo).toBe('specific-user');
      expect(data.task.priority).toBe('low');
    });

    it('should create second task successfully', async () => {
      const requestBody = {
        title: 'Second Test Task',
        prompt: 'Second test prompt',
        priority: 'low' as const,
      };

      const request = new NextRequest(
        `http://localhost/api/projects/${testProjectId}/sessions/${testSessionId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = {
        params: Promise.resolve({ projectId: testProjectId, sessionId: testSessionId }),
      };

      const response = await POST(request, context);
      expect(response.status).toBe(201);

      const data = await parseResponse<{ task: Task }>(response);
      expect(data.task.title).toBe('Second Test Task');
      expect(data.task.priority).toBe('low');
    });
  });
});
