// ABOUTME: Unit tests for individual task operations API endpoints
// ABOUTME: Tests HTTP behavior, response data, and error handling rather than mock interactions

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '@/app/api/tasks/[taskId]/route';
import type { SessionService } from '@/lib/server/session-service';
import type { Session as ApiSession } from '@/types/api';
import { asThreadId } from '@/lib/server/core-types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';

// Helper function for tests using proper thread ID creation
function createThreadId(id: string): import('@/types/api').ThreadId {
  return asThreadId(id);
}

// Create properly typed mock TaskManager
interface MockTaskManager {
  createTask: ReturnType<typeof vi.fn>;
  getTasks: ReturnType<typeof vi.fn>;
  getTaskById: ReturnType<typeof vi.fn>;
  updateTask: ReturnType<typeof vi.fn>;
  addNote: ReturnType<typeof vi.fn>;
  deleteTask: ReturnType<typeof vi.fn>;
  getTaskSummary: ReturnType<typeof vi.fn>;
  listTasks: ReturnType<typeof vi.fn>;
  getTask: ReturnType<typeof vi.fn>;
}

const mockTaskManager: MockTaskManager = {
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

// Define proper mock Session interface that matches core Session class
interface MockCoreSession {
  getId(): import('@/types/api').ThreadId;
  getInfo(): ApiSession;
  getAgents(): import('@/types/api').Agent[];
  getTaskManager(): MockTaskManager;
}

// Create properly typed mock data
const testThreadId = createThreadId('lace_20240101_session');
const mockSessionInfo: ApiSession = {
  id: testThreadId,
  name: 'Test Session',
  createdAt: '2024-01-01T00:00:00Z',
  agents: [],
};

const mockAgents: import('@/types/api').Agent[] = [];

// Create a properly typed mock Session instance
const mockSession: MockCoreSession = {
  getId: vi.fn().mockReturnValue(testThreadId),
  getInfo: vi.fn().mockReturnValue(mockSessionInfo),
  getAgents: vi.fn().mockReturnValue(mockAgents),
  getTaskManager: vi.fn().mockReturnValue(mockTaskManager),
};

// Create the properly typed mock service
const mockSessionService: Partial<SessionService> = {
  createSession: vi.fn(),
  listSessions: vi.fn(),
  getSession: vi.fn().mockResolvedValue(mockSession),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Task [taskId] API Routes', () => {
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

  describe('GET /api/tasks/[taskId]', () => {
    it('should return 400 if sessionId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks/task_20240101_abc123');
      const response = await GET(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Session ID is required');
    });

    it('should return 404 if task is not found', async () => {
      mockTaskManager.getTaskById.mockReturnValue(null);

      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_notfound?sessionId=lace_20240101_session'
      );
      const response = await GET(request, { params: { taskId: 'task_20240101_notfound' } });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Task not found');
    });

    it('should return task details', async () => {
      type TaskType = import('@/types/api').Task;
      type TaskNoteType = import('@/types/api').TaskNote;

      const agentThreadId = createThreadId('lace_20240101_agent1');
      const creatorThreadId = createThreadId('lace_20240101_creator');
      const sessionThreadId = createThreadId('lace_20240101_session');

      const mockTaskNote: TaskNoteType = {
        id: 'note_20240101_n1',
        author: agentThreadId,
        content: 'Working on this',
        timestamp: new Date('2024-01-01T00:30:00Z'),
      };

      const mockTask: TaskType = {
        id: 'task_20240101_abc123',
        title: 'Test Task',
        description: 'Test Description',
        prompt: 'Test Prompt',
        status: 'in_progress',
        priority: 'high',
        assignedTo: agentThreadId,
        createdBy: creatorThreadId,
        threadId: sessionThreadId,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T01:00:00Z'),
        notes: [mockTaskNote],
      };

      mockTaskManager.getTaskById.mockReturnValue(mockTask);

      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_abc123?sessionId=lace_20240101_session'
      );
      const response = await GET(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = (await response.json()) as { task: unknown };

      expect(response.status).toBe(200);
      expect(data.task).toMatchObject({
        id: 'task_20240101_abc123',
        title: 'Test Task',
        status: 'in_progress',
        // TODO: expect.arrayContaining returns any by design in test utilities
        notes: expect.arrayContaining([
          expect.objectContaining({
            content: 'Working on this',
          }),
        ]) as unknown,
      });
    });
  });

  describe('PATCH /api/tasks/[taskId]', () => {
    it('should return 400 if sessionId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks/task_20240101_abc123', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      });

      const response = await PATCH(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Session ID is required');
    });

    it('should update task status', async () => {
      type TaskType = import('@/types/api').Task;
      const creatorThreadId = createThreadId('lace_20240101_creator');
      const sessionThreadId = createThreadId('lace_20240101_session');

      const updatedTask: TaskType = {
        id: 'task_20240101_abc123',
        title: 'Test Task',
        prompt: 'Test Prompt',
        description: 'Test Description',
        status: 'completed',
        priority: 'high',
        createdBy: creatorThreadId,
        threadId: sessionThreadId,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T02:00:00Z'),
        notes: [],
      };

      mockTaskManager.updateTask.mockResolvedValue(updatedTask);

      const request = new NextRequest('http://localhost:3000/api/tasks/task_20240101_abc123', {
        method: 'PATCH',
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          status: 'completed',
        }),
      });

      const response = await PATCH(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = (await response.json()) as { task: { status: string } };

      expect(response.status).toBe(200);
      expect(data.task.status).toBe('completed');
    });

    it('should update task assignment', async () => {
      type TaskType = import('@/types/api').Task;
      const agent2ThreadId = createThreadId('lace_20240101_agent2');
      const creatorThreadId = createThreadId('lace_20240101_creator');
      const sessionThreadId = createThreadId('lace_20240101_session');

      const updatedTask: TaskType = {
        id: 'task_20240101_abc123',
        title: 'Test Task',
        prompt: 'Test Prompt',
        description: 'Test Description',
        status: 'pending',
        priority: 'high',
        assignedTo: agent2ThreadId,
        createdBy: creatorThreadId,
        threadId: sessionThreadId,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T02:00:00Z'),
        notes: [],
      };

      mockTaskManager.updateTask.mockResolvedValue(updatedTask);

      const request = new NextRequest('http://localhost:3000/api/tasks/task_20240101_abc123', {
        method: 'PATCH',
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          assignedTo: 'lace_20240101_agent2',
        }),
      });

      const response = await PATCH(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = (await response.json()) as { task: { assignedTo: string } };

      expect(response.status).toBe(200);
      expect(data.task.assignedTo).toBe('lace_20240101_agent2');
    });

    it('should update multiple fields', async () => {
      type TaskType = import('@/types/api').Task;
      const creatorThreadId = createThreadId('lace_20240101_creator');
      const sessionThreadId = createThreadId('lace_20240101_session');

      const updatedTask: TaskType = {
        id: 'task_20240101_abc123',
        title: 'Updated Title',
        description: 'Updated Description',
        prompt: 'Test Prompt',
        status: 'in_progress',
        priority: 'low',
        createdBy: creatorThreadId,
        threadId: sessionThreadId,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T02:00:00Z'),
        notes: [],
      };

      mockTaskManager.updateTask.mockResolvedValue(updatedTask);

      const request = new NextRequest('http://localhost:3000/api/tasks/task_20240101_abc123', {
        method: 'PATCH',
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          title: 'Updated Title',
          description: 'Updated Description',
          status: 'in_progress',
          priority: 'low',
        }),
      });

      const response = await PATCH(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = (await response.json()) as { task: unknown };

      expect(response.status).toBe(200);
      expect(data.task).toMatchObject({
        title: 'Updated Title',
        description: 'Updated Description',
        status: 'in_progress',
        priority: 'low',
      });
    });
  });

  describe('DELETE /api/tasks/[taskId]', () => {
    it('should return 400 if sessionId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks/task_20240101_abc123', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Session ID is required');
    });

    it('should delete task', async () => {
      mockTaskManager.deleteTask.mockImplementation(() => undefined);

      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_abc123?sessionId=lace_20240101_session',
        {
          method: 'DELETE',
        }
      );

      const response = await DELETE(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = (await response.json()) as { message: string };

      expect(response.status).toBe(200);
      expect(data.message).toBe('Task deleted successfully');
    });

    it('should return 404 if task not found', async () => {
      mockTaskManager.deleteTask.mockImplementation(() => {
        throw new Error('Task not found');
      });

      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_notfound?sessionId=lace_20240101_session',
        {
          method: 'DELETE',
        }
      );

      const response = await DELETE(request, { params: { taskId: 'task_20240101_notfound' } });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Task not found');
    });
  });
});
