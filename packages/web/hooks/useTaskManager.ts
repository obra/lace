// ABOUTME: React hook for task management operations
// ABOUTME: Provides stateful task management with loading states and error handling

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TaskAPIClient } from '@/lib/client/task-api';
import { useTaskStream, type TaskEvent } from '~/../packages/web/hooks/useTaskStream';
import type { Task } from '@/types/api';
import type { TaskFilters, CreateTaskRequest, UpdateTaskRequest } from '@/lib/client/task-api';

export function useTaskManager(sessionId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep track of pending operations to batch refetches
  const pendingOperations = useRef(0);
  const refetchTimeout = useRef<NodeJS.Timeout | null>(null);

  // Create API client
  const client = useRef(new TaskAPIClient());

  // Fetch tasks
  const fetchTasks = useCallback(
    async (filters?: TaskFilters) => {
      try {
        setError(null);
        const fetchedTasks = await client.current.listTasks(sessionId, filters);
        setTasks(fetchedTasks);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
        setTasks([]);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId]
  );

  // Batch refetch after operations
  const scheduleRefetch = useCallback(() => {
    if (refetchTimeout.current) {
      clearTimeout(refetchTimeout.current);
    }

    refetchTimeout.current = setTimeout(() => {
      if (pendingOperations.current === 0) {
        void fetchTasks();
      }
    }, 100);
  }, [fetchTasks]);

  // Subscribe to real-time task updates
  useTaskStream({
    sessionId,
    onTaskCreated: useCallback((event: TaskEvent) => {
      if (event.task) {
        setTasks((prev) => [...prev, event.task]);
      }
    }, []),
    onTaskUpdated: useCallback((event: TaskEvent) => {
      if (event.task) {
        setTasks((prev) => prev.map((task) => (task.id === event.task!.id ? event.task! : task)));
      }
    }, []),
    onTaskDeleted: useCallback((event: TaskEvent) => {
      if (event.taskId) {
        setTasks((prev) => prev.filter((task) => task.id !== event.taskId));
      }
    }, []),
    onTaskNoteAdded: useCallback((event: TaskEvent) => {
      if (event.task) {
        setTasks((prev) => prev.map((task) => (task.id === event.task!.id ? event.task! : task)));
      }
    }, []),
    onError: useCallback((error) => {
      console.error('Task stream error:', error);
    }, []),
  });

  // Initial fetch
  useEffect(() => {
    void fetchTasks();

    return () => {
      if (refetchTimeout.current) {
        clearTimeout(refetchTimeout.current);
      }
    };
  }, [fetchTasks]);

  // Refetch with filters
  const refetch = useCallback(
    async (filters?: TaskFilters) => {
      setIsLoading(true);
      await fetchTasks(filters);
    },
    [fetchTasks]
  );

  // Create task
  const createTask = useCallback(
    async (task: CreateTaskRequest) => {
      pendingOperations.current++;
      setIsCreating(true);
      setError(null);

      try {
        await client.current.createTask(sessionId, task);
        scheduleRefetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create task');
        throw err;
      } finally {
        setIsCreating(false);
        pendingOperations.current--;
      }
    },
    [sessionId, scheduleRefetch]
  );

  // Update task
  const updateTask = useCallback(
    async (taskId: string, updates: UpdateTaskRequest) => {
      pendingOperations.current++;
      setIsUpdating(true);
      setError(null);

      try {
        await client.current.updateTask(sessionId, taskId, updates);
        scheduleRefetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update task');
        throw err;
      } finally {
        setIsUpdating(false);
        pendingOperations.current--;
      }
    },
    [sessionId, scheduleRefetch]
  );

  // Delete task
  const deleteTask = useCallback(
    async (taskId: string) => {
      pendingOperations.current++;
      setIsDeleting(true);
      setError(null);

      try {
        await client.current.deleteTask(sessionId, taskId);
        scheduleRefetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete task');
        throw err;
      } finally {
        setIsDeleting(false);
        pendingOperations.current--;
      }
    },
    [sessionId, scheduleRefetch]
  );

  // Add note
  const addNote = useCallback(
    async (taskId: string, content: string, author?: string) => {
      pendingOperations.current++;
      setIsUpdating(true);
      setError(null);

      try {
        await client.current.addNote(sessionId, taskId, content, author);
        scheduleRefetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add note');
        throw err;
      } finally {
        setIsUpdating(false);
        pendingOperations.current--;
      }
    },
    [sessionId, scheduleRefetch]
  );

  return {
    tasks,
    isLoading,
    isCreating,
    isUpdating,
    isDeleting,
    error,
    refetch,
    createTask,
    updateTask,
    deleteTask,
    addNote,
  };
}
