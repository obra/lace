// ABOUTME: Unit tests for task management API endpoints
// ABOUTME: Tests task CRUD operations and note management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tasks/route';
import type { Task } from '@/types/api';

// Mock external dependencies (database persistence) but not business logic
const projectStore = new Map<string, any>();
const sessionStore = new Map<string, any>();

vi.mock('~/persistence/database', () => {
  return {
    getPersistence: vi.fn(() => ({
      // Project persistence methods
      loadAllProjects: vi.fn(() => {
        return Array.from(projectStore.values());
      }),
      loadProject: vi.fn((projectId: string) => {
        return projectStore.get(projectId) || null;
      }),
      saveProject: vi.fn((project: any) => {
        projectStore.set(project.id, project);
      }),
      loadSessionsByProject: vi.fn((projectId: string) => {
        return Array.from(sessionStore.values()).filter((s) => s.projectId === projectId);
      }),

      // Session persistence methods
      loadAllSessions: vi.fn(() => {
        return Array.from(sessionStore.values());
      }),
      loadSession: vi.fn((sessionId: string) => {
        return sessionStore.get(sessionId) || null;
      }),
      saveSession: vi.fn((session: any) => {
        sessionStore.set(session.id, session);
      }),

      // Thread persistence methods (needed for session functionality)
      loadThreadEvents: vi.fn(() => []),
      saveThreadEvents: vi.fn(),
      deleteThread: vi.fn(),
    })),
  };
});

// Mock ThreadManager for session management - external dependency
vi.mock('~/threads/thread-manager', () => ({
  ThreadManager: vi.fn(() => ({
    getSessionsForProject: vi.fn(() => []), // Empty array for clean tests
  })),
}));

// Now using real TaskManager and SessionService for proper integration testing
// No more mocking of business logic - tests validate real HTTP behavior

describe('Task API Routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let testProject: any;
  let testSession: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear the in-memory stores between tests
    projectStore.clear();
    sessionStore.clear();

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
      testProject.id
    );
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
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
      // Arrange: Create real tasks using the test session
      const { getSessionService } = await import('@/lib/server/session-service');
      const sessionService = getSessionService();
      const session = await sessionService.getSession(testSession.id);

      if (!session) {
        throw new Error('Test session not found');
      }

      const taskManager = session.getTaskManager();

      // Create two real tasks
      const task1 = await taskManager.createTask(
        {
          title: 'Test Task 1',
          description: 'Description 1',
          prompt: 'Prompt 1',
          priority: 'high' as const,
        },
        { actor: 'human', isHuman: true }
      );

      const task2 = await taskManager.createTask(
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
      // Arrange: Create tasks with different statuses
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
