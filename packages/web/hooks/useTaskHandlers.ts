// ABOUTME: Custom hook for task management event handlers
// ABOUTME: Centralizes all task CRUD operations and modal state management

import { useCallback } from 'react';
import type { Task } from '@/types/core';
import { useTaskManager } from '@/hooks/useTaskManager';

type TaskManager = ReturnType<typeof useTaskManager>;

interface UseTaskHandlersProps {
  taskManager: TaskManager | null;
  onSetShowTaskCreation: (show: boolean) => void;
  onSetShowTaskDisplay: (show: boolean) => void;
  onSetSelectedTaskForDisplay: (task: Task | null) => void;
}

export function useTaskHandlers({
  taskManager,
  onSetShowTaskCreation,
  onSetShowTaskDisplay,
  onSetSelectedTaskForDisplay,
}: UseTaskHandlersProps) {
  // Handle task updates
  const handleTaskUpdate = useCallback(
    async (task: Task) => {
      if (!taskManager) return;

      try {
        await taskManager.updateTask(task.id, {
          status: task.status,
          title: task.title,
          description: task.description,
          priority: task.priority,
          assignedTo: task.assignedTo,
        });
      } catch (error) {
        console.error('Failed to update task:', error);
      }
    },
    [taskManager]
  );

  const handleTaskCreate = useCallback(
    async (taskData: Omit<Task, 'id'>) => {
      if (!taskManager) return;

      try {
        await taskManager.createTask({
          title: taskData.title,
          description: taskData.description,
          prompt: taskData.prompt || taskData.description || taskData.title,
          priority: taskData.priority,
          assignedTo: taskData.assignedTo,
        });
      } catch (error) {
        console.error('Failed to create task:', error);
      }
    },
    [taskManager]
  );

  // Handle task creation from modal
  const handleTaskCreateFromModal = useCallback(
    async (
      taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'notes' | 'createdBy' | 'threadId'>
    ) => {
      if (!taskManager) return;

      try {
        await taskManager.createTask({
          title: taskData.title,
          description: taskData.description,
          prompt: taskData.prompt,
          priority: taskData.priority,
          assignedTo: taskData.assignedTo,
        });
        onSetShowTaskCreation(false);
      } catch (error) {
        console.error('Failed to create task:', error);
      }
    },
    [taskManager, onSetShowTaskCreation]
  );

  // Handle opening task display modal
  const handleTaskDisplay = useCallback(
    (task: Task) => {
      onSetSelectedTaskForDisplay(task);
      onSetShowTaskDisplay(true);
    },
    [onSetSelectedTaskForDisplay, onSetShowTaskDisplay]
  );

  // Handle updating task from display modal
  const handleTaskUpdateFromModal = useCallback(
    async (taskId: string, updates: Partial<Task>) => {
      if (!taskManager) return;

      try {
        await taskManager.updateTask(taskId, {
          title: updates.title,
          description: updates.description,
          status: updates.status,
          priority: updates.priority,
          assignedTo: updates.assignedTo,
        });
      } catch (error) {
        console.error('Failed to update task:', error);
      }
    },
    [taskManager]
  );

  // Handle adding task note
  const handleTaskAddNote = useCallback(
    async (taskId: string, content: string) => {
      if (!taskManager) return;

      try {
        await taskManager.addNote(taskId, content);
      } catch (error) {
        console.error('Failed to add task note:', error);
      }
    },
    [taskManager]
  );

  return {
    handleTaskUpdate,
    handleTaskCreate,
    handleTaskCreateFromModal,
    handleTaskDisplay,
    handleTaskUpdateFromModal,
    handleTaskAddNote,
  };
}
