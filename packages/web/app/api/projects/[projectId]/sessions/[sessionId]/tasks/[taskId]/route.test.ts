// ABOUTME: Test suite for RESTful task detail API - GET/PATCH/DELETE specific task under project/session
// ABOUTME: Tests individual task operations with proper nested route validation

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { GET, PATCH, DELETE } from './route';
import { Project } from '@/lib/server/lace-imports';
import type { Task } from '@/types/api';

// Mock Project
vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

describe('/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]', () => {
  let mockProject: {
    getSession: MockedFunction<(id: string) => unknown>;
  };
  let mockSession: {
    getTaskManager: MockedFunction<() => unknown>;
  };
  let mockTaskManager: {
    getTaskById: MockedFunction<(id: string) => Task | null>;
    updateTask: MockedFunction<(id: string, updates: unknown, context: unknown) => Promise<Task>>;
    deleteTask: MockedFunction<(id: string, context: unknown) => Promise<void>>;
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
      getTaskById: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
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
    it('should return specific task', async () => {
      mockTaskManager.getTaskById.mockReturnValue(mockTask);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(200);

      const data = (await response.json()) as { task: Task };
      expect(data.task.id).toBe('task1');
      expect(data.task.title).toBe('Test Task');
    });

    it('should return 404 for non-existent project', async () => {
      const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent/sessions/sess1/tasks/task1');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'nonexistent', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      mockProject.getSession.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/nonexistent/tasks/task1');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'nonexistent', 
          taskId: 'task1' 
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Session not found in this project');
    });

    it('should return 404 for non-existent task', async () => {
      mockTaskManager.getTaskById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/nonexistent');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'nonexistent' 
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Task not found');
    });

    it('should handle database errors', async () => {
      mockTaskManager.getTaskById.mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await GET(request, context);
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Database error');
    });
  });

  describe('PATCH', () => {
    it('should update task properties', async () => {
      const updatedTask: Task = {
        ...mockTask,
        title: 'Updated Title',
        status: 'in_progress',
        updatedAt: '2023-01-02T00:00:00.000Z',
      };

      mockTaskManager.updateTask.mockResolvedValue(updatedTask);

      const updateData = { title: 'Updated Title', status: 'in_progress' as const };

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1', {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await PATCH(request, context);
      expect(response.status).toBe(200);

      const data = (await response.json()) as { task: Task };
      expect(data.task.title).toBe('Updated Title');
      expect(data.task.status).toBe('in_progress');
    });

    it('should return 404 for non-existent project', async () => {
      const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent/sessions/sess1/tasks/task1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'nonexistent', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await PATCH(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      mockProject.getSession.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/nonexistent/tasks/task1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'nonexistent', 
          taskId: 'task1' 
        }) 
      };

      const response = await PATCH(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Session not found in this project');
    });

    it('should handle task not found during update', async () => {
      mockTaskManager.updateTask.mockRejectedValue(new Error('Task not found'));

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'nonexistent' 
        }) 
      };

      const response = await PATCH(request, context);
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Task not found');
    });

    it('should handle partial updates', async () => {
      const updatedTask: Task = {
        ...mockTask,
        priority: 'high',
        updatedAt: '2023-01-02T00:00:00.000Z',
      };

      mockTaskManager.updateTask.mockResolvedValue(updatedTask);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1', {
        method: 'PATCH',
        body: JSON.stringify({ priority: 'high' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await PATCH(request, context);
      expect(response.status).toBe(200);

      const data = (await response.json()) as { task: Task };
      expect(data.task.priority).toBe('high');
      expect(data.task.title).toBe('Test Task'); // Should remain unchanged
    });

    it('should handle database errors during update', async () => {
      mockTaskManager.updateTask.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await PATCH(request, context);
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Database error');
    });
  });

  describe('DELETE', () => {
    it('should delete task successfully', async () => {
      mockTaskManager.deleteTask.mockResolvedValue();

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await DELETE(request, context);
      expect(response.status).toBe(200);

      const data = (await response.json()) as { message: string };
      expect(data.message).toBe('Task deleted successfully');
    });

    it('should return 404 for non-existent project', async () => {
      const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent/sessions/sess1/tasks/task1');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'nonexistent', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await DELETE(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      mockProject.getSession.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/nonexistent/tasks/task1');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'nonexistent', 
          taskId: 'task1' 
        }) 
      };

      const response = await DELETE(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Session not found in this project');
    });

    it('should return 404 for non-existent task', async () => {
      mockTaskManager.deleteTask.mockRejectedValue(new Error('Task not found'));

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/nonexistent');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'nonexistent' 
        }) 
      };

      const response = await DELETE(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Task not found');
    });

    it('should handle database errors during deletion', async () => {
      mockTaskManager.deleteTask.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1');
      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await DELETE(request, context);
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Database error');
    });
  });
});