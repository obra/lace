// ABOUTME: Unit tests for useTaskHandlers hook
// ABOUTME: Tests task CRUD operations and modal state management

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskHandlers } from '@/hooks/useTaskHandlers';
import type { Task } from '@/types/core';

// Mock task manager
const createMockTaskManager = () => ({
  tasks: [],
  isLoading: false,
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  error: null,
  refetch: vi.fn(),
  createTask: vi.fn().mockResolvedValue(undefined),
  updateTask: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  addNote: vi.fn().mockResolvedValue(undefined),
  handleTaskCreated: vi.fn(),
  handleTaskUpdated: vi.fn(),
  handleTaskDeleted: vi.fn(),
  handleTaskNoteAdded: vi.fn(),
});

// Mock task data
const createMockTask = (overrides?: Partial<Task>): Task => ({
  id: 'task-1',
  title: 'Test Task',
  description: 'Test task description',
  prompt: 'Test task prompt',
  status: 'pending',
  priority: 'medium',
  threadId: 'thread-1' as Task['threadId'],
  createdAt: new Date(),
  updatedAt: new Date(),
  notes: [],
  createdBy: 'user-1',
  ...overrides,
});

describe('useTaskHandlers', () => {
  let mockTaskManager: ReturnType<typeof createMockTaskManager>;
  let mockSetShowTaskCreation: ReturnType<typeof vi.fn>;
  let mockSetShowTaskDisplay: ReturnType<typeof vi.fn>;
  let mockSetSelectedTaskForDisplay: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskManager = createMockTaskManager();
    mockSetShowTaskCreation = vi.fn();
    mockSetShowTaskDisplay = vi.fn();
    mockSetSelectedTaskForDisplay = vi.fn();

    // Clear mock console.error
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const getDefaultProps = () => ({
    taskManager: mockTaskManager,
    onSetShowTaskCreation: mockSetShowTaskCreation,
    onSetShowTaskDisplay: mockSetShowTaskDisplay,
    onSetSelectedTaskForDisplay: mockSetSelectedTaskForDisplay,
  });

  describe('handleTaskUpdate', () => {
    it('updates task with correct parameters', async () => {
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      const task = createMockTask({ status: 'completed', title: 'Updated Task' });

      await act(async () => {
        await result.current.handleTaskUpdate(task);
      });

      expect(mockTaskManager.updateTask).toHaveBeenCalledWith('task-1', {
        status: 'completed',
        title: 'Updated Task',
        description: 'Test task description',
        priority: 'medium',
        assignedTo: undefined,
      });
    });

    it('does nothing when taskManager is null', async () => {
      const { result } = renderHook(() =>
        useTaskHandlers({
          ...getDefaultProps(),
          taskManager: null,
        })
      );
      const task = createMockTask();

      await act(async () => {
        await result.current.handleTaskUpdate(task);
      });

      expect(mockTaskManager.updateTask).not.toHaveBeenCalled();
    });

    it('handles task update errors gracefully', async () => {
      mockTaskManager.updateTask.mockRejectedValueOnce(new Error('Update failed'));
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      const task = createMockTask();

      await act(async () => {
        await result.current.handleTaskUpdate(task);
      });

      expect(console.error).toHaveBeenCalledWith('Failed to update task:', expect.any(Error));
    });
  });

  describe('handleTaskCreate', () => {
    it('creates task with correct parameters', async () => {
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      const taskData = {
        title: 'New Task',
        description: 'New task description',
        prompt: 'New task prompt',
        status: 'pending' as const,
        priority: 'high' as const,
        assignedTo: 'user-1' as Task['assignedTo'],
        threadId: 'thread-1' as Task['threadId'],
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        createdBy: 'user-1',
      };

      await act(async () => {
        await result.current.handleTaskCreate(taskData);
      });

      expect(mockTaskManager.createTask).toHaveBeenCalledWith({
        title: 'New Task',
        description: 'New task description',
        prompt: 'New task prompt', // Uses taskData.prompt since it exists
        priority: 'high',
        assignedTo: 'user-1',
      });
    });

    it('uses title as prompt when description is empty', async () => {
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      // Create task data with empty prompt field to test fallback logic
      const taskData = {
        title: 'Title Only',
        description: '',
        prompt: '', // Empty prompt - should fall back to title
        status: 'pending' as const,
        priority: 'medium' as const,
        threadId: 'thread-1' as Task['threadId'],
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        createdBy: 'user-1',
      };

      await act(async () => {
        await result.current.handleTaskCreate(taskData);
      });

      expect(mockTaskManager.createTask).toHaveBeenCalledWith({
        title: 'Title Only',
        description: '',
        prompt: 'Title Only',
        priority: 'medium',
        assignedTo: undefined,
      });
    });

    it('handles task creation errors gracefully', async () => {
      mockTaskManager.createTask.mockRejectedValueOnce(new Error('Create failed'));
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      const task = createMockTask();

      await act(async () => {
        await result.current.handleTaskCreate(task);
      });

      expect(console.error).toHaveBeenCalledWith('Failed to create task:', expect.any(Error));
    });
  });

  describe('handleTaskCreateFromModal', () => {
    it('creates task and closes modal on success', async () => {
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      const taskData = {
        title: 'Modal Task',
        description: 'From modal',
        status: 'pending' as const,
        priority: 'low' as const,
        assignedTo: 'user-2' as Task['assignedTo'],
        prompt: 'Custom prompt',
      };

      await act(async () => {
        await result.current.handleTaskCreateFromModal(taskData);
      });

      expect(mockTaskManager.createTask).toHaveBeenCalledWith({
        title: 'Modal Task',
        description: 'From modal',
        prompt: 'Custom prompt',
        priority: 'low',
        assignedTo: 'user-2',
      });
      expect(mockSetShowTaskCreation).toHaveBeenCalledWith(false);
    });

    it('handles modal task creation errors gracefully', async () => {
      mockTaskManager.createTask.mockRejectedValueOnce(new Error('Modal create failed'));
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      const taskData = {
        title: 'Modal Task',
        description: 'From modal',
        prompt: 'Modal task prompt',
        status: 'pending' as const,
        priority: 'low' as const,
      };

      await act(async () => {
        await result.current.handleTaskCreateFromModal(taskData);
      });

      expect(console.error).toHaveBeenCalledWith('Failed to create task:', expect.any(Error));
      expect(mockSetShowTaskCreation).not.toHaveBeenCalled();
    });
  });

  describe('handleTaskDisplay', () => {
    it('sets selected task and shows display modal', () => {
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      const task = createMockTask();

      act(() => {
        result.current.handleTaskDisplay(task);
      });

      expect(mockSetSelectedTaskForDisplay).toHaveBeenCalledWith(task);
      expect(mockSetShowTaskDisplay).toHaveBeenCalledWith(true);
    });
  });

  describe('handleTaskUpdateFromModal', () => {
    it('updates task with partial data', async () => {
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));
      const updates = {
        title: 'Updated from modal',
        status: 'completed' as const,
      };

      await act(async () => {
        await result.current.handleTaskUpdateFromModal('task-1', updates);
      });

      expect(mockTaskManager.updateTask).toHaveBeenCalledWith('task-1', {
        title: 'Updated from modal',
        description: undefined,
        status: 'completed',
        priority: undefined,
        assignedTo: undefined,
      });
    });

    it('handles modal update errors gracefully', async () => {
      mockTaskManager.updateTask.mockRejectedValueOnce(new Error('Modal update failed'));
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));

      await act(async () => {
        await result.current.handleTaskUpdateFromModal('task-1', { title: 'New title' });
      });

      expect(console.error).toHaveBeenCalledWith('Failed to update task:', expect.any(Error));
    });
  });

  describe('handleTaskAddNote', () => {
    it('adds note to task', async () => {
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));

      await act(async () => {
        await result.current.handleTaskAddNote('task-1', 'New note content');
      });

      expect(mockTaskManager.addNote).toHaveBeenCalledWith('task-1', 'New note content');
    });

    it('handles add note errors gracefully', async () => {
      mockTaskManager.addNote.mockRejectedValueOnce(new Error('Add note failed'));
      const { result } = renderHook(() => useTaskHandlers(getDefaultProps()));

      await act(async () => {
        await result.current.handleTaskAddNote('task-1', 'New note');
      });

      expect(console.error).toHaveBeenCalledWith('Failed to add task note:', expect.any(Error));
    });
  });

  describe('null taskManager handling', () => {
    it('handles null taskManager for all operations', async () => {
      const propsWithNullManager = {
        ...getDefaultProps(),
        taskManager: null,
      };
      const { result } = renderHook(() => useTaskHandlers(propsWithNullManager));

      await act(async () => {
        await result.current.handleTaskCreate(createMockTask());
        await result.current.handleTaskUpdate(createMockTask());
        await result.current.handleTaskCreateFromModal({
          title: 'Test',
          description: 'Test',
          prompt: 'Test prompt',
          status: 'pending',
          priority: 'medium',
        });
        await result.current.handleTaskUpdateFromModal('task-1', { title: 'Updated' });
        await result.current.handleTaskAddNote('task-1', 'Note');
      });

      // Should not call any taskManager methods
      expect(mockTaskManager.createTask).not.toHaveBeenCalled();
      expect(mockTaskManager.updateTask).not.toHaveBeenCalled();
      expect(mockTaskManager.addNote).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});
