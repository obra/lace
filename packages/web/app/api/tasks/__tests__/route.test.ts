// ABOUTME: Unit tests for task management API endpoints
// ABOUTME: Tests task CRUD operations and note management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tasks/route';
import type { SessionService } from '@/lib/server/session-service';
import type { Task, Session } from '@/types/api';
import type { Session as CoreSession } from '@/lib/server/core-types';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Helper function for tests to avoid server-only imports
function createThreadId(id: string) {
  return id as import('@/types/api').ThreadId;
}

// Create mock TaskManager
const mockTaskManager = {
  createTask: vi.fn(),
  getTasks: vi.fn(),
  getTaskById: vi.fn(),
  updateTask: vi.fn(),
  addNote: vi.fn(),
  deleteTask: vi.fn(),
  getTaskSummary: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
};

// Create a mock Session instance
const mockSession: Partial<Session> = {
  getId: vi.fn().mockReturnValue(createThreadId('lace_20240101_session')),
  getInfo: vi.fn().mockReturnValue({
    id: createThreadId('lace_20240101_session'),
    name: 'Test Session',
    createdAt: '2024-01-01T00:00:00Z',
    agents: [],
  }),
  getAgents: vi.fn().mockReturnValue([]),
  getTaskManager: vi.fn().mockReturnValue(mockTaskManager),
};

// Create the properly typed mock service
const mockSessionService = {
  createSession: vi.fn<SessionService['createSession']>(),
  listSessions: vi.fn<SessionService['listSessions']>(),
  getSession: vi
    .fn<SessionService['getSession']>()
    .mockResolvedValue(mockSession as unknown as CoreSession),
  spawnAgent: vi.fn<SessionService['spawnAgent']>(),
  getAgent: vi.fn<SessionService['getAgent']>(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Task API Routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Mock console methods to prevent stderr pollution during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
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
      mockSessionService.getSession.mockResolvedValueOnce(null);

      const request = new NextRequest(
        'http://localhost:3000/api/tasks?sessionId=lace_20240101_notfound'
      );
      const response = await GET(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should return tasks for a valid session', async () => {
      const mockTasks = [
        {
          id: 'task_20240101_abc123',
          title: 'Test Task 1',
          description: 'Description 1',
          prompt: 'Prompt 1',
          status: 'pending',
          priority: 'high',
          createdBy: createThreadId('lace_20240101_agent1'),
          threadId: createThreadId('lace_20240101_session'),
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
          notes: [],
        },
        {
          id: 'task_20240101_def456',
          title: 'Test Task 2',
          description: 'Description 2',
          prompt: 'Prompt 2',
          status: 'in_progress',
          priority: 'medium',
          assignedTo: createThreadId('lace_20240101_agent2'),
          createdBy: createThreadId('lace_20240101_agent1'),
          threadId: createThreadId('lace_20240101_session'),
          createdAt: new Date('2024-01-01T01:00:00Z'),
          updatedAt: new Date('2024-01-01T01:00:00Z'),
          notes: [],
        },
      ];

      mockTaskManager.getTasks.mockReturnValue(mockTasks);

      const request = new NextRequest(
        'http://localhost:3000/api/tasks?sessionId=lace_20240101_session'
      );
      const response = await GET(request);
      const data = (await response.json()) as { tasks: Task[] };

      expect(response.status).toBe(200);
      expect(data.tasks).toHaveLength(2);
      expect(data.tasks[0]).toMatchObject({
        id: 'task_20240101_abc123',
        title: 'Test Task 1',
        status: 'pending',
        priority: 'high',
      });
    });

    it('should filter tasks by status', async () => {
      const mockTasks = [
        {
          id: 'task_20240101_abc123',
          title: 'Pending Task',
          status: 'pending',
          priority: 'high',
          createdBy: createThreadId('lace_20240101_agent1'),
          threadId: createThreadId('lace_20240101_session'),
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
          notes: [],
        },
      ];

      mockTaskManager.getTasks.mockReturnValue(mockTasks);

      const request = new NextRequest(
        'http://localhost:3000/api/tasks?sessionId=lace_20240101_session&status=pending'
      );
      const response = await GET(request);
      const _data = (await response.json()) as { tasks: Task[] };

      expect(response.status).toBe(200);
      expect(mockTaskManager.getTasks).toHaveBeenCalledWith({
        status: 'pending',
      });
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
      const newTask = {
        id: 'task_20240101_new123',
        title: 'New Task',
        description: 'New Description',
        prompt: 'Do something',
        status: 'pending',
        priority: 'medium',
        createdBy: createThreadId('human'),
        threadId: createThreadId('lace_20240101_session'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        notes: [],
      };

      mockTaskManager.createTask.mockResolvedValue(newTask);

      const request = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          title: 'New Task',
          description: 'New Description',
          prompt: 'Do something',
          priority: 'medium',
        }),
      });

      const response = await POST(request);
      const data = (await response.json()) as { task: Task };

      expect(response.status).toBe(201);
      expect(data.task).toMatchObject({
        id: 'task_20240101_new123',
        title: 'New Task',
        status: 'pending',
      });
      expect(mockTaskManager.createTask).toHaveBeenCalledWith(
        {
          title: 'New Task',
          description: 'New Description',
          prompt: 'Do something',
          priority: 'medium',
        },
        {
          actor: 'human',
          isHuman: true,
        }
      );
    });

    it('should create task with assignment', async () => {
      const newTask = {
        id: 'task_20240101_new123',
        title: 'Assigned Task',
        description: '',
        prompt: 'Do something',
        status: 'pending',
        priority: 'high',
        assignedTo: createThreadId('lace_20240101_agent1'),
        createdBy: createThreadId('human'),
        threadId: createThreadId('lace_20240101_session'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        notes: [],
      };

      mockTaskManager.createTask.mockResolvedValue(newTask);

      const request = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          title: 'Assigned Task',
          prompt: 'Do something',
          priority: 'high',
          assignedTo: 'lace_20240101_agent1',
        }),
      });

      const response = await POST(request);
      const data = (await response.json()) as { task: Task };

      expect(response.status).toBe(201);
      expect(data.task.assignedTo).toBe('lace_20240101_agent1');
    });
  });
});
