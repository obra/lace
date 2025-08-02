// ABOUTME: React hook for task management operations
// ABOUTME: Provides stateful task management with loading states and error handling

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TaskAPIClient } from '@/lib/client/task-api';
import { useEventStream, type TaskEvent } from '@/hooks/useEventStream';
import type { Task } from '@/lib/core';
import type { TaskFilters, CreateTaskRequest, UpdateTaskRequest } from '@/lib/client/task-api';

export function useTaskManager(projectId: string, sessionId: string) {
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
      // Don't make API calls if projectId or sessionId are empty
      if (!projectId || !sessionId) {
        setTasks([]);
        setIsLoading(false);
        setError(null);
        return;
      }

      try {
        setError(null);
        const fetchedTasks = await client.current.listTasks(projectId, sessionId, filters);
        setTasks(fetchedTasks);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
        setTasks([]);
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, sessionId]
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

  // Subscribe to real-time task updates using unified event stream
  useEventStream({
    projectId,
    sessionId,
    onTaskCreated: useCallback((event: TaskEvent) => {
      if (event.task) {
        setTasks((prev) => [...prev, event.task!]);
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
    onError: useCallback((error: Error) => {
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
      // Don't make API calls if projectId or sessionId are empty
      if (!projectId || !sessionId) {
        return;
      }

      pendingOperations.current++;
      setIsCreating(true);
      setError(null);

      try {
        await client.current.createTask(projectId, sessionId, task);
        scheduleRefetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create task');
        throw err;
      } finally {
        setIsCreating(false);
        pendingOperations.current--;
      }
    },
    [projectId, sessionId, scheduleRefetch]
  );

  // Update task
  const updateTask = useCallback(
    async (taskId: string, updates: UpdateTaskRequest) => {
      // Don't make API calls if projectId or sessionId are empty
      if (!projectId || !sessionId) {
        return;
      }

      pendingOperations.current++;
      setIsUpdating(true);
      setError(null);

      try {
        await client.current.updateTask(projectId, sessionId, taskId, updates);
        scheduleRefetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update task');
        throw err;
      } finally {
        setIsUpdating(false);
        pendingOperations.current--;
      }
    },
    [projectId, sessionId, scheduleRefetch]
  );

  // Delete task
  const deleteTask = useCallback(
    async (taskId: string) => {
      // Don't make API calls if projectId or sessionId are empty
      if (!projectId || !sessionId) {
        return;
      }

      pendingOperations.current++;
      setIsDeleting(true);
      setError(null);

      try {
        await client.current.deleteTask(projectId, sessionId, taskId);
        scheduleRefetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete task');
        throw err;
      } finally {
        setIsDeleting(false);
        pendingOperations.current--;
      }
    },
    [projectId, sessionId, scheduleRefetch]
  );

  // Add note
  const addNote = useCallback(
    async (taskId: string, content: string, author?: string) => {
      // Don't make API calls if projectId or sessionId are empty
      if (!projectId || !sessionId) {
        return;
      }

      pendingOperations.current++;
      setIsUpdating(true);
      setError(null);

      try {
        await client.current.addNote(projectId, sessionId, taskId, content, author);
        scheduleRefetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add note');
        throw err;
      } finally {
        setIsUpdating(false);
        pendingOperations.current--;
      }
    },
    [projectId, sessionId, scheduleRefetch]
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
