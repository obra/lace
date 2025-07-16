// ABOUTME: Unit tests for useTaskManager React hook
// ABOUTME: Tests task management operations in React components

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { useTaskManager } from '@/hooks/useTaskManager';
import { TaskAPIClient } from '@/lib/client/task-api';
import type { Task } from '@/types/api';

// Mock the TaskAPIClient
vi.mock('@/lib/client/task-api');

// Mock EventSource for tests
class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  
  constructor(public url: string) {}
}

global.EventSource = MockEventSource as unknown as typeof EventSource;

describe('useTaskManager', () => {
  let mockClient: {
    listTasks: ReturnType<typeof vi.fn>;
    createTask: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
    addNote: ReturnType<typeof vi.fn>;
  };

  const mockSessionId = 'lace_20240101_session';
  const mockTask: Task = {
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
        notes: [{ id: 'note1', author: 'human', content: 'Test note', timestamp: '2024-01-01T01:00:00Z' }],
      }),
    };

    vi.mocked(TaskAPIClient).mockImplementation(() => mockClient as unknown as TaskAPIClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with loading state', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    // Initial state should be loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.tasks).toEqual([]);
    expect(result.current.error).toBeNull();

    // Wait for the initial fetch to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should fetch tasks on mount', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockClient.listTasks).toHaveBeenCalledWith(mockSessionId, undefined);
    expect(result.current.tasks).toEqual([mockTask]);
  });

  it('should handle fetch errors', async () => {
    mockClient.listTasks.mockRejectedValueOnce(new Error('Failed to fetch'));

    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to fetch');
    expect(result.current.tasks).toEqual([]);
  });

  it('should refetch tasks with filters', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.refetch({ status: 'pending' });
    });

    expect(mockClient.listTasks).toHaveBeenCalledWith(mockSessionId, { status: 'pending' });
  });

  it('should create a task', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const newTask = {
      title: 'New Task',
      description: 'New Description',
      prompt: 'Do something',
      priority: 'medium' as const,
    };

    await act(async () => {
      await result.current.createTask(newTask);
    });

    expect(mockClient.createTask).toHaveBeenCalledWith(mockSessionId, newTask);
    
    // Wait for the refetch to occur
    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2); // Initial + refetch
    });
  });

  it('should update a task', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.updateTask('task_20240101_abc123', { status: 'completed' });
    });

    expect(mockClient.updateTask).toHaveBeenCalledWith(
      mockSessionId,
      'task_20240101_abc123',
      { status: 'completed' }
    );
    
    // Wait for the refetch to occur
    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2); // Initial + refetch
    });
  });

  it('should delete a task', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.deleteTask('task_20240101_abc123');
    });

    expect(mockClient.deleteTask).toHaveBeenCalledWith(mockSessionId, 'task_20240101_abc123');
    
    // Wait for the refetch to occur
    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2); // Initial + refetch
    });
  });

  it('should add a note', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.addNote('task_20240101_abc123', 'Test note');
    });

    expect(mockClient.addNote).toHaveBeenCalledWith(
      mockSessionId,
      'task_20240101_abc123',
      'Test note',
      undefined
    );
    
    // Wait for the refetch to occur
    await waitFor(() => {
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2); // Initial + refetch
    });
  });

  it('should handle concurrent operations', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Start multiple operations
    await act(async () => {
      await Promise.all([
        result.current.createTask({
          title: 'Task 1',
          prompt: 'Do something',
        }),
        result.current.createTask({
          title: 'Task 2',
          prompt: 'Do something else',
        }),
      ]);
    });

    expect(mockClient.createTask).toHaveBeenCalledTimes(2);
    
    // Wait for the batched refetch to occur
    await waitFor(() => {
      // Should only refetch once after all operations complete
      expect(mockClient.listTasks).toHaveBeenCalledTimes(2); // Initial + one refetch
    });
  });

  it('should provide loading states for individual operations', async () => {
    const { result } = renderHook(() => useTaskManager(mockSessionId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isCreating).toBe(false);
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.isDeleting).toBe(false);

    // Make the create operation slower to test loading state
    let resolveCreate: () => void;
    const createPromise = new Promise<void>((resolve) => {
      resolveCreate = resolve;
    });
    
    mockClient.createTask.mockImplementationOnce(() => {
      return createPromise.then(() => mockTask);
    });

    // Start a create operation
    let createTaskPromise: Promise<void>;
    act(() => {
      createTaskPromise = result.current.createTask({
        title: 'New Task',
        prompt: 'Do something',
      });
    });

    // Check loading state during operation
    await waitFor(() => {
      expect(result.current.isCreating).toBe(true);
    });

    // Resolve the create operation
    act(() => {
      resolveCreate!();
    });

    await act(async () => {
      await createTaskPromise!;
    });

    expect(result.current.isCreating).toBe(false);
  });
});