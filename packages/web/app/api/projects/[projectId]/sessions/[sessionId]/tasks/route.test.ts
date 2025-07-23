// ABOUTME: Test suite for RESTful task management API - list and create tasks under project/session
// ABOUTME: Tests proper nested route structure and task CRUD operations with project/session validation

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { GET, POST } from './route';
import { Project } from '@/lib/server/lace-imports';
import type { TaskFilters } from '@/lib/server/core-types';
import type { Task } from '@/types/api';

// Mock Project
vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

describe('/api/projects/[projectId]/sessions/[sessionId]/tasks', () => {
  let mockProject: {
    getSession: MockedFunction<(id: string) => unknown>;
  };
  let mockSession: {
    getTaskManager: MockedFunction<() => unknown>;
  };
  let mockTaskManager: {
    getTasks: MockedFunction<(filters?: TaskFilters) => Task[]>;
    createTask: MockedFunction<(request: unknown, context: unknown) => Promise<Task>>;
  };

  const mockTask: Task = {
    id: 'task1',
    title: 'Test Task',
    description: 'Test description',
    prompt: 'Test prompt',
    status: 'pending',
    priority: 'medium',
    assignedTo: 'user1',
    createdBy: 'human',
    threadId: 'session1',
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z',
    notes: [],
  };

  beforeEach(() => {
    mockTaskManager = {
      getTasks: vi.fn(),
      createTask: vi.fn(),
    };

    mockSession = {
      getTaskManager: vi.fn().mockReturnValue(mockTaskManager),
    };

    mockProject = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
    mockedGetById.mockReturnValue(mockProject as unknown as ReturnType<typeof Project.getById>);
  });

  describe('GET', () => {
    it('should return tasks for valid project/session', async () => {
      mockTaskManager.getTasks.mockReturnValue([mockTask]);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks');
      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      const data = (await response.json()) as { tasks: Task[] };
      expect(data).toHaveProperty('tasks');
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].id).toBe('task1');
    });

    it('should return 404 for non-existent project', async () => {
      const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest(
        'http://localhost/api/projects/nonexistent/sessions/sess1/tasks'
      );
      const context = { params: Promise.resolve({ projectId: 'nonexistent', sessionId: 'sess1' }) };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      mockProject.getSession.mockReturnValue(null);

      const request = new NextRequest(
        'http://localhost/api/projects/proj1/sessions/nonexistent/tasks'
      );
      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'nonexistent' }) };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Session not found in this project');
    });

    it('should apply status filter', async () => {
      mockTaskManager.getTasks.mockReturnValue([mockTask]);

      const request = new NextRequest(
        'http://localhost/api/projects/proj1/sessions/sess1/tasks?status=pending'
      );
      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      expect(mockTaskManager.getTasks).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('should apply priority filter', async () => {
      mockTaskManager.getTasks.mockReturnValue([mockTask]);

      const request = new NextRequest(
        'http://localhost/api/projects/proj1/sessions/sess1/tasks?priority=high'
      );
      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      expect(mockTaskManager.getTasks).toHaveBeenCalledWith({ priority: 'high' });
    });

    it('should apply multiple filters', async () => {
      mockTaskManager.getTasks.mockReturnValue([mockTask]);

      const request = new NextRequest(
        'http://localhost/api/projects/proj1/sessions/sess1/tasks?status=pending&priority=high&assignedTo=user1'
      );
      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      expect(mockTaskManager.getTasks).toHaveBeenCalledWith({
        status: 'pending',
        priority: 'high',
        assignedTo: 'user1',
      });
    });

    it('should handle database errors', async () => {
      mockTaskManager.getTasks.mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks');
      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await GET(request, context);
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Database error');
    });
  });

  describe('POST', () => {
    it('should create task with valid data', async () => {
      mockTaskManager.createTask.mockResolvedValue(mockTask);

      const requestBody = {
        title: 'Test Task',
        prompt: 'Test prompt',
        priority: 'medium' as const,
      };

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await POST(request, context);
      expect(response.status).toBe(201);

      const data = (await response.json()) as { task: Task };
      expect(data.task).toHaveProperty('id');
      expect(data.task.title).toBe('Test Task');
    });

    it('should validate required fields', async () => {
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Missing prompt' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await POST(request, context);
      expect(response.status).toBe(400);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Title and prompt are required');
    });

    it('should return 404 for non-existent project', async () => {
      const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest(
        'http://localhost/api/projects/nonexistent/sessions/sess1/tasks',
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Test Task', prompt: 'Test prompt' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = { params: Promise.resolve({ projectId: 'nonexistent', sessionId: 'sess1' }) };

      const response = await POST(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      mockProject.getSession.mockReturnValue(null);

      const request = new NextRequest(
        'http://localhost/api/projects/proj1/sessions/nonexistent/tasks',
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Test Task', prompt: 'Test prompt' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'nonexistent' }) };

      const response = await POST(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Session not found in this project');
    });

    it('should create task with optional fields', async () => {
      const taskWithOptionalFields: Task = {
        ...mockTask,
        description: 'Task with description',
        assignedTo: 'specific-user',
      };

      mockTaskManager.createTask.mockResolvedValue(taskWithOptionalFields);

      const requestBody = {
        title: 'Test Task',
        description: 'Task with description',
        prompt: 'Test prompt',
        priority: 'high' as const,
        assignedTo: 'specific-user',
      };

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await POST(request, context);
      expect(response.status).toBe(201);

      const data = (await response.json()) as { task: Task };
      expect(data.task.description).toBe('Task with description');
      expect(data.task.assignedTo).toBe('specific-user');
      expect(data.task.priority).toBe('high');
    });

    it('should handle database errors during creation', async () => {
      mockTaskManager.createTask.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test Task', prompt: 'Test prompt' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { params: Promise.resolve({ projectId: 'proj1', sessionId: 'sess1' }) };

      const response = await POST(request, context);
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Database error');
    });
  });
});
