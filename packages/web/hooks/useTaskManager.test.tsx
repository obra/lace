// ABOUTME: Unit tests for useTaskManager hook state management logic only
// ABOUTME: Tests hook's internal state transitions and loading states - see useTaskManager.e2e.test.tsx for full integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { useTaskManager } from '@/hooks/useTaskManager';
import { TaskAPIClient } from '@/lib/client/task-api';
import type { Task } from '@/types/core';
import { asThreadId } from '@/types/core';

// Mock TaskAPIClient for isolated hook testing
vi.mock('@/lib/client/task-api');

// Mock EventSource for isolated testing
class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();

  constructor(public url: string) {}
}

global.EventSource = MockEventSource as unknown as typeof EventSource;

describe('useTaskManager Hook Logic', () => {
  let mockClient: Partial<TaskAPIClient>;

  const mockProjectId = 'project_123';
  const mockSessionId = 'lace_20240101_sess01';
  const mockTask: Task = {
    id: 'task_20240101_abc123',
    title: 'Test Task',
    description: 'Test Description',
    prompt: 'Test Prompt',
    status: 'pending',
    priority: 'high',
    createdBy: asThreadId('lace_20240101_agent1'),
    threadId: asThreadId('lace_20240101_sess01'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    notes: [],
  };

  beforeEach(() => {
    mockClient = {
      listTasks: vi.fn().mockResolvedValue([mockTask]),
      createTask: vi.fn().mockResolvedValue(mockTask),
      getTask: vi.fn().mockResolvedValue(mockTask),
      updateTask: vi.fn().mockResolvedValue({ ...mockTask, status: 'completed' }),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      addNote: vi.fn().mockResolvedValue({
        ...mockTask,
        notes: [
          { id: 'note1', author: 'human', content: 'Test note', timestamp: '2024-01-01T01:00:00Z' },
        ],
      }),
    };

    vi.mocked(TaskAPIClient).mockImplementation(() => mockClient as unknown as TaskAPIClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should manage loading state correctly', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    // Verify initial loading state
    expect(result.current.isLoading).toBe(true);
    expect(result.current.tasks).toEqual([]);
    expect(result.current.error).toBeNull();

    // Wait for loading to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.tasks).toEqual([mockTask]);
  });

  it('should call API client on initialization', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockClient.listTasks).toHaveBeenCalledWith(mockProjectId, mockSessionId, undefined);
  });

  it('should handle error state transitions', async () => {
    (mockClient.listTasks as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Test error')
    );

    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Test error');
    expect(result.current.tasks).toEqual([]);
  });

  it('should call API client with filters on refetch', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.refetch({ status: 'pending' });
    });

    expect(mockClient.listTasks).toHaveBeenCalledWith(mockProjectId, mockSessionId, {
      status: 'pending',
    });
  });

  it('should call create API and trigger refetch', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const newTask = {
      title: 'New Task',
      prompt: 'Do something',
      priority: 'medium' as const,
    };

    await act(async () => {
      await result.current.createTask(newTask);
    });

    expect(mockClient.createTask).toHaveBeenCalledWith(mockProjectId, mockSessionId, newTask);

    // Wait for the refetch to occur
    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2); // Initial + refetch
    });
  });

  it('should call update API and trigger refetch', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.updateTask('task_20240101_abc123', { status: 'completed' });
    });

    expect(mockClient.updateTask).toHaveBeenCalledWith(
      mockProjectId,
      mockSessionId,
      'task_20240101_abc123',
      {
        status: 'completed',
      }
    );

    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2);
    });
  });

  it('should call delete API and trigger refetch', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.deleteTask('task_20240101_abc123');
    });

    expect(mockClient.deleteTask).toHaveBeenCalledWith(
      mockProjectId,
      mockSessionId,
      'task_20240101_abc123'
    );

    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2);
    });
  });

  it('should call addNote API and trigger refetch', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.addNote('task_20240101_abc123', 'Test note');
    });

    expect(mockClient.addNote).toHaveBeenCalledWith(
      mockProjectId,
      mockSessionId,
      'task_20240101_abc123',
      'Test note',
      undefined
    );

    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2);
    });
  });

  it('should handle concurrent operations correctly', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await Promise.all([
        result.current.createTask({ title: 'Task 1', prompt: 'Do something' }),
        result.current.createTask({ title: 'Task 2', prompt: 'Do something else' }),
      ]);
    });

    expect(mockClient.createTask).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2); // Initial + batched refetch
    });
  });

  it('should track operation loading states', async () => {
    const { result } = renderHook(() => useTaskManager(mockProjectId, mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Verify initial operation states
    expect(result.current.isCreating).toBe(false);
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.isDeleting).toBe(false);

    // Test loading state during operation
    let resolveCreate: () => void;
    const createPromise = new Promise<void>((resolve) => {
      resolveCreate = resolve;
    });

    (mockClient.createTask as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      return createPromise.then(() => mockTask);
    });

    let createTaskPromise: Promise<void>;
    act(() => {
      createTaskPromise = result.current.createTask({
        title: 'New Task',
        prompt: 'Do something',
      });
    });

    await waitFor(() => {
      expect(result.current.isCreating).toBe(true);
    });

    act(() => {
      resolveCreate!();
    });

    await act(async () => {
      await createTaskPromise!;
    });

    expect(result.current.isCreating).toBe(false);
  });
});
