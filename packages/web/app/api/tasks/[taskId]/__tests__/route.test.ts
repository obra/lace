// ABOUTME: Unit tests for individual task operations API endpoints
// ABOUTME: Tests GET, PATCH, DELETE operations on specific tasks

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '@/app/api/tasks/[taskId]/route';
import type { SessionService } from '@/lib/server/session-service';
import type { Session } from '@/types/api';
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
      const mockTask = {
        id: 'task_20240101_abc123',
        title: 'Test Task',
        description: 'Test Description',
        prompt: 'Test Prompt',
        status: 'in_progress',
        priority: 'high',
        assignedTo: createThreadId('lace_20240101_agent1'),
        createdBy: createThreadId('lace_20240101_creator'),
        threadId: createThreadId('lace_20240101_session'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T01:00:00Z'),
        notes: [
          {
            id: 'note_20240101_n1',
            author: createThreadId('lace_20240101_agent1'),
            content: 'Working on this',
            timestamp: new Date('2024-01-01T00:30:00Z'),
          },
        ],
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
      const updatedTask = {
        id: 'task_20240101_abc123',
        title: 'Test Task',
        status: 'completed',
        priority: 'high',
        createdBy: createThreadId('lace_20240101_creator'),
        threadId: createThreadId('lace_20240101_session'),
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
      expect(mockTaskManager.updateTask).toHaveBeenCalledWith(
        'task_20240101_abc123',
        { status: 'completed' },
        { actor: 'human', isHuman: true }
      );
    });

    it('should update task assignment', async () => {
      const updatedTask = {
        id: 'task_20240101_abc123',
        title: 'Test Task',
        status: 'pending',
        priority: 'high',
        assignedTo: createThreadId('lace_20240101_agent2'),
        createdBy: createThreadId('lace_20240101_creator'),
        threadId: createThreadId('lace_20240101_session'),
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
      const updatedTask = {
        id: 'task_20240101_abc123',
        title: 'Updated Title',
        description: 'Updated Description',
        status: 'in_progress',
        priority: 'low',
        createdBy: createThreadId('lace_20240101_creator'),
        threadId: createThreadId('lace_20240101_session'),
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
      mockTaskManager.deleteTask.mockImplementation(() => {});

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
      expect(mockTaskManager.deleteTask).toHaveBeenCalledWith('task_20240101_abc123', {
        actor: 'human',
        isHuman: true,
      });
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
