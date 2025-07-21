// ABOUTME: Unit tests for task management API endpoints
// ABOUTME: Tests task CRUD operations and note management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tasks/route';
import type { Task } from '@/types/api';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Mock environment variables - avoid requiring real API keys in tests
vi.mock('~/config/env-loader', () => ({
  getEnvVar: vi.fn((key: string) => {
    const envVars: Record<string, string> = {
      ANTHROPIC_KEY: 'test-anthropic-key',
      OPENAI_API_KEY: 'test-openai-key',
    };
    return envVars[key] || '';
  }),
}));

// Using real TaskManager and SessionService with temporary database
// Minimal mocking - only env vars. Tests validate real HTTP behavior

describe('Task API Routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let testProject: { getId(): string };
  let testSession: { id: string };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up isolated test persistence
    setupTestPersistence();

    // ✅ ESSENTIAL MOCK - Console suppression to prevent test output noise and control log verification
    // These mocks are necessary for clean test output and error handling verification
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Set up test data: Create a real project and session for task testing
    const { Project } = await import('@/lib/server/lace-imports');
    const { getSessionService } = await import('@/lib/server/session-service');

    testProject = Project.create('Test Project', '/test', 'Test project for tasks');
    const sessionService = getSessionService();

    testSession = await sessionService.createSession(
      'Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      testProject.getId()
    );
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();

    // Clean up test persistence
    teardownTestPersistence();
  });

  describe('GET /api/tasks', () => {
    it('should return 400 if sessionId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks');
      const response = await GET(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Session ID is required');
    });

    it('should return 404 if session is not found', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/tasks?sessionId=lace_20240101_notfound'
      );
      const response = await GET(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should return tasks for a valid session', async () => {
      // Arrange: Create tasks using the real session
      const { getSessionService } = await import('@/lib/server/session-service');
      const sessionService = getSessionService();
      const session = await sessionService.getSession(testSession.id);

      if (!session) {
        throw new Error('Test session not found');
      }

      const taskManager = session.getTaskManager();

      // Create two real tasks
      await taskManager.createTask(
        {
          title: 'Test Task 1',
          description: 'Description 1',
          prompt: 'Prompt 1',
          priority: 'high' as const,
        },
        { actor: 'human', isHuman: true }
      );

      await taskManager.createTask(
        {
          title: 'Test Task 2',
          description: 'Description 2',
          prompt: 'Prompt 2',
          priority: 'medium' as const,
        },
        { actor: 'human', isHuman: true }
      );

      // Act: Call the API endpoint with the real session ID
      const request = new NextRequest(
        `http://localhost:3000/api/tasks?sessionId=${testSession.id}`
      );
      const response = await GET(request);
      const data = (await response.json()) as { tasks: Task[] };

      // Assert: Verify real HTTP response with real task data
      expect(response.status).toBe(200);
      expect(data.tasks).toHaveLength(2);

      // Find tasks by title since IDs are generated
      const returnedTask1 = data.tasks.find((t) => t.title === 'Test Task 1');
      const returnedTask2 = data.tasks.find((t) => t.title === 'Test Task 2');

      expect(returnedTask1).toBeDefined();
      expect(returnedTask1).toMatchObject({
        title: 'Test Task 1',
        description: 'Description 1',
        prompt: 'Prompt 1',
        status: 'pending',
        priority: 'high',
      });

      expect(returnedTask2).toBeDefined();
      expect(returnedTask2).toMatchObject({
        title: 'Test Task 2',
        description: 'Description 2',
        prompt: 'Prompt 2',
        status: 'pending',
        priority: 'medium',
      });
    });

    it('should filter tasks by status', async () => {
      // Arrange: Create a session and task
      const { getSessionService } = await import('@/lib/server/session-service');
      const sessionService = getSessionService();
      const session = await sessionService.getSession(testSession.id);

      if (!session) {
        throw new Error('Test session not found');
      }

      const taskManager = session.getTaskManager();

      // Create a pending task
      await taskManager.createTask(
        {
          title: 'Pending Task',
          prompt: 'Test prompt',
          priority: 'high' as const,
        },
        { actor: 'human', isHuman: true }
      );

      // Act: Call API with status filter
      const request = new NextRequest(
        `http://localhost:3000/api/tasks?sessionId=${testSession.id}&status=pending`
      );
      const response = await GET(request);
      const data = (await response.json()) as { tasks: Task[] };

      // Assert: Verify filtering worked on real data
      expect(response.status).toBe(200);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].status).toBe('pending');
      expect(data.tasks[0].title).toBe('Pending Task');
    });
  });

  describe('POST /api/tasks', () => {
    it('should return 400 if sessionId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'New Task',
          prompt: 'Do something',
        }),
      });

      const response = await POST(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Session ID is required');
    });

    it('should return 400 if required fields are missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          title: 'New Task',
          // missing prompt
        }),
      });

      const response = await POST(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Title and prompt are required');
    });

    it('should create a new task', async () => {
      // Act: Create task via API with real services
      const request = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: testSession.id,
          title: 'New Task',
          description: 'New Description',
          prompt: 'Do something',
          priority: 'medium',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = (await response.json()) as { task: Task };

      // Assert: Verify real HTTP response with real task creation
      expect(response.status).toBe(201);
      expect(data.task).toMatchObject({
        title: 'New Task',
        description: 'New Description',
        prompt: 'Do something',
        status: 'pending',
        priority: 'medium',
      });
      expect(data.task.id).toMatch(/^task_/); // Real task ID generation
      expect(data.task.createdAt).toBeTruthy();
      expect(data.task.updatedAt).toBeTruthy();

      // Verify task was actually created in the session
      const { getSessionService } = await import('@/lib/server/session-service');
      const sessionService = getSessionService();
      const session = await sessionService.getSession(testSession.id);
      const taskManager = session?.getTaskManager();
      const tasks = taskManager?.getTasks();

      const createdTask = tasks?.find((t) => t.title === 'New Task');
      expect(createdTask).toBeDefined();
      expect(createdTask?.description).toBe('New Description');
    });

    it('should create task with assignment', async () => {
      // Act: Create assigned task via API
      const request = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: testSession.id,
          title: 'Assigned Task',
          prompt: 'Do something',
          priority: 'high',
          assignedTo: 'lace_20240101_agent1',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = (await response.json()) as { task: Task };

      // Assert: Verify task assignment worked
      expect(response.status).toBe(201);
      expect(data.task).toMatchObject({
        title: 'Assigned Task',
        prompt: 'Do something',
        priority: 'high',
        assignedTo: 'lace_20240101_agent1',
        status: 'pending',
      });
    });
  });
});
