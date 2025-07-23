// ABOUTME: Test suite for RESTful task notes API - add notes to tasks under project/session
// ABOUTME: Tests note creation with proper nested route validation

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { POST } from './route';
import { Project } from '@/lib/server/lace-imports';
import type { Task } from '@/types/api';

// Mock Project
vi.mock('@/lib/server/lace-imports', () => ({
  Project: {
    getById: vi.fn(),
  },
}));

describe('/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/notes', () => {
  let mockProject: {
    getSession: MockedFunction<(id: string) => unknown>;
  };
  let mockSession: {
    getTaskManager: MockedFunction<() => unknown>;
  };
  let mockTaskManager: {
    addNote: MockedFunction<(taskId: string, content: string, context: unknown) => Promise<void>>;
    getTaskById: MockedFunction<(id: string) => Task | null>;
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
    notes: [
      {
        id: 'note1',
        content: 'Test note content',
        author: 'human',
        timestamp: '2023-01-01T00:00:00.000Z',
      },
    ],
  };

  beforeEach(() => {
    mockTaskManager = {
      addNote: vi.fn(),
      getTaskById: vi.fn(),
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

  describe('POST', () => {
    it('should add note to task successfully', async () => {
      mockTaskManager.addNote.mockResolvedValue();
      mockTaskManager.getTaskById.mockReturnValue(mockTask);

      const requestBody = {
        content: 'Test note content',
      };

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1/notes', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(201);

      const data = (await response.json()) as { message: string; task: Task };
      expect(data.message).toBe('Note added successfully');
      expect(data.task.id).toBe('task1');
      expect(data.task.notes).toHaveLength(1);
    });

    it('should add note with specified author', async () => {
      mockTaskManager.addNote.mockResolvedValue();
      mockTaskManager.getTaskById.mockReturnValue(mockTask);

      const requestBody = {
        content: 'Agent note content',
        author: 'agent',
      };

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1/notes', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(201);

      expect(mockTaskManager.addNote).toHaveBeenCalledWith(
        'task1',
        'Agent note content',
        {
          actor: 'agent',
          isHuman: false,
        }
      );
    });

    it('should return 400 for missing content', async () => {
      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1/notes', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(400);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Note content is required');
    });

    it('should return 404 for non-existent project', async () => {
      const mockedGetById = vi.mocked(Project.getById) as MockedFunction<typeof Project.getById>;
      mockedGetById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/nonexistent/sessions/sess1/tasks/task1/notes', {
        method: 'POST',
        body: JSON.stringify({ content: 'Test note' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'nonexistent', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Project not found');
    });

    it('should return 404 for non-existent session', async () => {
      mockProject.getSession.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/nonexistent/tasks/task1/notes', {
        method: 'POST',
        body: JSON.stringify({ content: 'Test note' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'nonexistent', 
          taskId: 'task1' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Session not found in this project');
    });

    it('should return 404 for non-existent task', async () => {
      mockTaskManager.addNote.mockRejectedValue(new Error('Task not found'));

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/nonexistent/notes', {
        method: 'POST',
        body: JSON.stringify({ content: 'Test note' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'nonexistent' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Task not found');
    });

    it('should return 404 when task not found after adding note', async () => {
      mockTaskManager.addNote.mockResolvedValue();
      mockTaskManager.getTaskById.mockReturnValue(null);

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1/notes', {
        method: 'POST',
        body: JSON.stringify({ content: 'Test note' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(404);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Task not found');
    });

    it('should handle database errors', async () => {
      mockTaskManager.addNote.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1/notes', {
        method: 'POST',
        body: JSON.stringify({ content: 'Test note' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(500);

      const data = (await response.json()) as { error: string };
      expect(data.error).toBe('Database error');
    });

    it('should default to human author when not specified', async () => {
      mockTaskManager.addNote.mockResolvedValue();
      mockTaskManager.getTaskById.mockReturnValue(mockTask);

      const requestBody = {
        content: 'Human note content',
      };

      const request = new NextRequest('http://localhost/api/projects/proj1/sessions/sess1/tasks/task1/notes', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: { 'Content-Type': 'application/json' },
      });

      const context = { 
        params: Promise.resolve({ 
          projectId: 'proj1', 
          sessionId: 'sess1', 
          taskId: 'task1' 
        }) 
      };

      const response = await POST(request, context);
      expect(response.status).toBe(201);

      expect(mockTaskManager.addNote).toHaveBeenCalledWith(
        'task1',
        'Human note content',
        {
          actor: 'human',
          isHuman: true,
        }
      );
    });
  });
});