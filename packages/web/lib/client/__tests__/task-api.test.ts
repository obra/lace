// ABOUTME: Unit tests for task API client
// ABOUTME: Tests client-side API calls for task management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskAPIClient } from '@/lib/client/task-api';
import type { Task } from '@/types/api';

// Mock fetch
global.fetch = vi.fn() as unknown as typeof fetch;

describe('TaskAPIClient', () => {
  let client: TaskAPIClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TaskAPIClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listTasks', () => {
    it('should fetch tasks for a session', async () => {
      const mockTasks: Partial<Task>[] = [
        {
          id: 'task_20240101_abc123',
          title: 'Test Task',
          description: 'Test Description',
          prompt: 'Test Prompt',
          status: 'pending',
          priority: 'high',
          createdBy: 'lace_20240101_agent1',
          threadId: 'lace_20240101_session',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          notes: [],
        },
      ];

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ tasks: mockTasks }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const tasks = await client.listTasks('lace_20240101_session');

      expect(global.fetch).toHaveBeenCalledWith('/api/tasks?sessionId=lace_20240101_session');
      expect(tasks).toEqual(mockTasks);
    });

    it('should include filters in query params', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ tasks: [] }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await client.listTasks('lace_20240101_session', {
        status: 'pending',
        assignedTo: 'lace_20240101_agent1',
        priority: 'high',
      });

      const call = vi.mocked(global.fetch).mock.calls[0][0] as string;
      expect(call).toContain('/api/tasks?');
      expect(call).toContain('sessionId=lace_20240101_session');
      expect(call).toContain('status=pending');
      expect(call).toContain('assignedTo=lace_20240101_agent1');
      expect(call).toContain('priority=high');
    });

    it('should throw error on failed request', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: 'Server error' }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(client.listTasks('lace_20240101_session')).rejects.toThrow(
        'Failed to fetch tasks'
      );
    });
  });

  describe('createTask', () => {
    it('should create a task', async () => {
      const newTask: Partial<Task> = {
        id: 'task_20240101_new123',
        title: 'New Task',
        description: 'New Description',
        prompt: 'Do something',
        status: 'pending',
        priority: 'medium',
        createdBy: 'human',
        threadId: 'lace_20240101_session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        notes: [],
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ task: newTask }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const task = await client.createTask('lace_20240101_session', {
        title: 'New Task',
        description: 'New Description',
        prompt: 'Do something',
        priority: 'medium',
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          title: 'New Task',
          description: 'New Description',
          prompt: 'Do something',
          priority: 'medium',
        }),
      });
      expect(task).toEqual(newTask);
    });

    it('should throw error on failed creation', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ error: 'Title and prompt are required' }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(
        client.createTask('lace_20240101_session', {
          title: '',
          prompt: '',
        })
      ).rejects.toThrow('Failed to create task');
    });
  });

  describe('getTask', () => {
    it('should fetch a single task', async () => {
      const mockTask: Partial<Task> = {
        id: 'task_20240101_abc123',
        title: 'Test Task',
        description: 'Test Description',
        prompt: 'Test Prompt',
        status: 'in_progress',
        priority: 'high',
        assignedTo: 'lace_20240101_agent1',
        createdBy: 'lace_20240101_creator',
        threadId: 'lace_20240101_session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T01:00:00Z',
        notes: [
          {
            id: 'note_20240101_n1',
            author: 'lace_20240101_agent1',
            content: 'Working on this',
            timestamp: '2024-01-01T00:30:00Z',
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ task: mockTask }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const task = await client.getTask('lace_20240101_session', 'task_20240101_abc123');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tasks/task_20240101_abc123?sessionId=lace_20240101_session'
      );
      expect(task).toEqual(mockTask);
    });
  });

  describe('updateTask', () => {
    it('should update a task', async () => {
      const updatedTask: Partial<Task> = {
        id: 'task_20240101_abc123',
        title: 'Updated Task',
        description: 'Updated Description',
        prompt: 'Test Prompt',
        status: 'completed',
        priority: 'low',
        createdBy: 'lace_20240101_creator',
        threadId: 'lace_20240101_session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T02:00:00Z',
        notes: [],
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ task: updatedTask }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const task = await client.updateTask('lace_20240101_session', 'task_20240101_abc123', {
        title: 'Updated Task',
        description: 'Updated Description',
        status: 'completed',
        priority: 'low',
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/tasks/task_20240101_abc123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          title: 'Updated Task',
          description: 'Updated Description',
          status: 'completed',
          priority: 'low',
        }),
      });
      expect(task).toEqual(updatedTask);
    });
  });

  describe('deleteTask', () => {
    it('should delete a task', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ message: 'Task deleted successfully' }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await client.deleteTask('lace_20240101_session', 'task_20240101_abc123');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tasks/task_20240101_abc123?sessionId=lace_20240101_session',
        {
          method: 'DELETE',
        }
      );
    });

    it('should throw error on failed deletion', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: 'Task not found' }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(
        client.deleteTask('lace_20240101_session', 'task_20240101_notfound')
      ).rejects.toThrow('Failed to delete task');
    });
  });

  describe('addNote', () => {
    it('should add a note to a task', async () => {
      const mockTask: Partial<Task> = {
        id: 'task_20240101_abc123',
        title: 'Test Task',
        prompt: 'Test Prompt',
        status: 'in_progress',
        priority: 'high',
        createdBy: 'lace_20240101_creator',
        threadId: 'lace_20240101_session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T02:00:00Z',
        notes: [
          {
            id: 'note_20240101_new',
            author: 'human',
            content: 'This is a new note',
            timestamp: '2024-01-01T02:00:00Z',
          },
        ],
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ message: 'Note added successfully', task: mockTask }),
      } as unknown as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const task = await client.addNote(
        'lace_20240101_session',
        'task_20240101_abc123',
        'This is a new note'
      );

      expect(global.fetch).toHaveBeenCalledWith('/api/tasks/task_20240101_abc123/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          content: 'This is a new note',
        }),
      });
      expect(task).toEqual(mockTask);
    });
  });
});
