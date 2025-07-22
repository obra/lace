// ABOUTME: Unit tests for TaskAPIClient URL construction and request formatting logic only
// ABOUTME: Tests client-side parameter handling and URL building - see task-api.e2e.test.ts for full integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskAPIClient } from '@/lib/client/task-api';
import { asThreadId } from '@/lib/server/core-types';

// Mock fetch to capture requests without making real calls
global.fetch = vi.fn() as unknown as typeof fetch;

describe('TaskAPIClient Unit Tests', () => {
  let client: TaskAPIClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TaskAPIClient();
    mockFetch = vi.mocked(global.fetch);

    // Default successful response mock
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tasks: [], task: {} }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('URL Construction', () => {
    it('should construct correct URL for listing tasks', async () => {
      await client.listTasks('lace_20240101_session');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('/api/tasks?sessionId=lace_20240101_session');
      expect(fetchCall[1]).toBeUndefined(); // GET request has no body
    });

    it('should construct URL with filter parameters', async () => {
      await client.listTasks('lace_20240101_session', {
        status: 'pending',
        assignedTo: asThreadId('lace_20240101_agent1'),
        priority: 'high',
      });

      const requestUrl = mockFetch.mock.calls[0][0] as string;
      expect(requestUrl).toContain('/api/tasks?');
      expect(requestUrl).toContain('sessionId=lace_20240101_session');
      expect(requestUrl).toContain('status=pending');
      expect(requestUrl).toContain('assignedTo=lace_20240101_agent1');
      expect(requestUrl).toContain('priority=high');
    });

    it('should construct correct URL for getting single task', async () => {
      await client.getTask('lace_20240101_session', 'task_20240101_abc123');

      const requestUrl = mockFetch.mock.calls[0][0] as string;
      expect(requestUrl).toBe('/api/tasks/task_20240101_abc123?sessionId=lace_20240101_session');
    });
  });

  describe('Request Formatting', () => {
    it('should format POST request for task creation correctly', async () => {
      await client.createTask('lace_20240101_session', {
        title: 'New Task',
        description: 'New Description',
        prompt: 'Do something',
        priority: 'medium',
      });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('/api/tasks');
      expect(fetchCall[1]).toEqual({
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
    });

    it('should format PATCH request for task updates correctly', async () => {
      await client.updateTask('lace_20240101_session', 'task_123', {
        title: 'Updated Task',
        status: 'completed',
        priority: 'low',
      });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('/api/tasks/task_123');
      expect(fetchCall[1]).toEqual({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          title: 'Updated Task',
          status: 'completed',
          priority: 'low',
        }),
      });
    });

    it('should format DELETE request correctly', async () => {
      await client.deleteTask('lace_20240101_session', 'task_123');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('/api/tasks/task_123?sessionId=lace_20240101_session');
      expect(fetchCall[1]).toEqual({ method: 'DELETE' });
    });

    it('should format POST request for notes correctly', async () => {
      await client.addNote('lace_20240101_session', 'task_123', 'Test note');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('/api/tasks/task_123/notes');
      expect(fetchCall[1]).toEqual({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'lace_20240101_session',
          content: 'Test note',
        }),
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw error on failed request', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      } as Response);

      await expect(client.listTasks('lace_20240101_session')).rejects.toThrow(
        'Failed to fetch tasks'
      );
    });

    it('should throw appropriate errors for failed requests', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Bad request' }),
      } as Response);

      await expect(client.createTask('invalid-session', { title: '', prompt: '' })).rejects.toThrow(
        'Failed to create task'
      );
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(client.listTasks('session-id')).rejects.toThrow('Network error');
    });
  });
});
