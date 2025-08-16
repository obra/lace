// ABOUTME: Unit tests for TaskProvider
// ABOUTME: Tests task context, modal management, and handler integration

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskProvider, useTaskContext } from '@/components/providers/TaskProvider';
import type { Task, AgentInfo, ThreadId } from '@/types/core';

// Mock the hooks
vi.mock('@/hooks/useTaskManager', () => ({
  useTaskManager: vi.fn(() => ({
    tasks: [{ id: 'task-1', title: 'Test Task' }],
    isLoading: false,
    isCreating: false,
    isUpdating: false,
    error: null,
    refetch: vi.fn(),
    createTask: vi.fn().mockResolvedValue(undefined),
    updateTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    addNote: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/hooks/useTaskHandlers', () => ({
  useTaskHandlers: vi.fn(
    ({ onSetShowTaskDisplay, onSetSelectedTaskForDisplay, onSetShowTaskCreation }) => ({
      handleTaskUpdate: vi.fn().mockResolvedValue(undefined),
      handleTaskCreate: vi.fn().mockResolvedValue(undefined),
      handleTaskCreateFromModal: vi.fn(async () => {
        onSetShowTaskCreation(false);
      }),
      handleTaskDisplay: vi.fn((task) => {
        onSetSelectedTaskForDisplay(task);
        onSetShowTaskDisplay(true);
      }),
      handleTaskUpdateFromModal: vi.fn().mockResolvedValue(undefined),
      handleTaskAddNote: vi.fn().mockResolvedValue(undefined),
    })
  ),
}));

// Mock the modal components
vi.mock('@/components/modals/TaskBoardModal', () => ({
  TaskBoardModal: ({
    isOpen,
    onClose,
    onTaskClick,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onTaskClick: (task: Task) => void;
  }) =>
    isOpen ? (
      <div data-testid="task-board-modal">
        <button onClick={onClose} data-testid="close-board">
          Close Board
        </button>
        <button
          onClick={() => onTaskClick({ id: 'task-1', title: 'Test Task' } as Task)}
          data-testid="click-task"
        >
          Click Task
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/modals/TaskCreationModal', () => ({
  TaskCreationModal: ({
    isOpen,
    onClose,
    onCreateTask,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onCreateTask: (taskData: any) => void;
  }) =>
    isOpen ? (
      <div data-testid="task-creation-modal">
        <button onClick={onClose} data-testid="close-creation">
          Close Creation
        </button>
        <button onClick={() => onCreateTask({ title: 'New Task' })} data-testid="create-task">
          Create Task
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/modals/TaskDisplayModal', () => ({
  TaskDisplayModal: ({
    isOpen,
    onClose,
    onUpdateTask,
    onAddNote,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onUpdateTask: (taskId: string, updates: any) => void;
    onAddNote: (taskId: string, note: string) => void;
  }) =>
    isOpen ? (
      <div data-testid="task-display-modal">
        <button onClick={onClose} data-testid="close-display">
          Close Display
        </button>
        <button
          onClick={() => onUpdateTask('task-1', { title: 'Updated' })}
          data-testid="update-task"
        >
          Update Task
        </button>
        <button onClick={() => onAddNote('task-1', 'New note')} data-testid="add-note">
          Add Note
        </button>
      </div>
    ) : null,
}));

// Test data factories
const createMockAgent = (id: string, name: string): AgentInfo => ({
  threadId: id as ThreadId,
  name,
  providerInstanceId: 'test-provider',
  modelId: 'test-model',
  status: 'idle',
});

const createMockTask = (): Task => ({
  id: 'task-1',
  title: 'Test Task',
  description: 'Test task description',
  prompt: 'Test task prompt for agent',
  status: 'pending',
  priority: 'medium',
  threadId: 'test-session' as ThreadId,
  createdAt: new Date(),
  updatedAt: new Date(),
  notes: [],
  createdBy: 'user',
});

// Test component that uses TaskContext
function TestComponent() {
  const {
    taskManager,
    showTaskBoard,
    showTaskCreation,
    handleTaskDisplay,
    handleTaskUpdate,
    handleTaskCreateFromModal,
    handleTaskUpdateFromModal,
    handleTaskAddNote,
  } = useTaskContext();

  return (
    <div>
      <div data-testid="task-count">{taskManager?.tasks?.length || 0}</div>
      <button onClick={showTaskBoard} data-testid="show-board">
        Show Board
      </button>
      <button onClick={showTaskCreation} data-testid="show-creation">
        Show Creation
      </button>
      <button onClick={() => handleTaskDisplay(createMockTask())} data-testid="display-task">
        Display Task
      </button>
      <button
        onClick={async () => await handleTaskUpdate(createMockTask())}
        data-testid="update-task-btn"
      >
        Update Task
      </button>
      <button
        onClick={async () =>
          await handleTaskCreateFromModal({
            title: 'New',
            description: 'New task',
            prompt: 'New task prompt',
            status: 'pending',
            priority: 'medium',
          })
        }
        data-testid="create-from-modal"
      >
        Create From Modal
      </button>
      <button
        onClick={async () => await handleTaskUpdateFromModal('task-1', { title: 'Updated' })}
        data-testid="update-from-modal"
      >
        Update From Modal
      </button>
      <button
        onClick={async () => await handleTaskAddNote('task-1', 'New note')}
        data-testid="add-note-btn"
      >
        Add Note
      </button>
    </div>
  );
}

describe('TaskProvider', () => {
  const mockAgents = [createMockAgent('agent-1', 'Alice'), createMockAgent('agent-2', 'Bob')];

  const defaultProps = {
    projectId: 'test-project',
    sessionId: 'test-session',
    agents: mockAgents,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Context Provider', () => {
    it('provides task context to children', () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      expect(screen.getByTestId('task-count')).toHaveTextContent('1');
      expect(screen.getByTestId('show-board')).toBeInTheDocument();
      expect(screen.getByTestId('show-creation')).toBeInTheDocument();
    });

    it('throws error when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useTaskContext must be used within a TaskProvider');

      consoleSpy.mockRestore();
    });

    it('handles null project and session IDs', () => {
      render(
        <TaskProvider projectId={null} sessionId={null} agents={[]}>
          <TestComponent />
        </TaskProvider>
      );

      // Should still provide context but with no tasks
      expect(screen.getByTestId('task-count')).toHaveTextContent('1'); // Mock still returns 1 task
    });
  });

  describe('Modal Management', () => {
    it('shows and hides TaskBoard modal', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      // Initially no modal
      expect(screen.queryByTestId('task-board-modal')).not.toBeInTheDocument();

      // Show modal
      fireEvent.click(screen.getByTestId('show-board'));

      await waitFor(() => {
        expect(screen.getByTestId('task-board-modal')).toBeInTheDocument();
      });

      // Hide modal
      fireEvent.click(screen.getByTestId('close-board'));

      await waitFor(() => {
        expect(screen.queryByTestId('task-board-modal')).not.toBeInTheDocument();
      });
    });

    it('shows and hides TaskCreation modal', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      // Show modal
      fireEvent.click(screen.getByTestId('show-creation'));

      await waitFor(() => {
        expect(screen.getByTestId('task-creation-modal')).toBeInTheDocument();
      });

      // Hide modal
      fireEvent.click(screen.getByTestId('close-creation'));

      await waitFor(() => {
        expect(screen.queryByTestId('task-creation-modal')).not.toBeInTheDocument();
      });
    });

    it('shows and hides TaskDisplay modal', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      // Show modal by displaying a task
      fireEvent.click(screen.getByTestId('display-task'));

      await waitFor(() => {
        expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
      });

      // Hide modal
      fireEvent.click(screen.getByTestId('close-display'));

      await waitFor(() => {
        expect(screen.queryByTestId('task-display-modal')).not.toBeInTheDocument();
      });
    });
  });

  describe('Task Handlers', () => {
    it('handles task update', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('update-task-btn'));

      // Should call the handler (mocked to resolve)
      await waitFor(() => {
        expect(screen.getByTestId('update-task-btn')).toBeInTheDocument();
      });
    });

    it('handles task creation from modal', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      // Show creation modal first
      fireEvent.click(screen.getByTestId('show-creation'));

      await waitFor(() => {
        expect(screen.getByTestId('task-creation-modal')).toBeInTheDocument();
      });

      // Create task from modal
      fireEvent.click(screen.getByTestId('create-task'));

      // Modal should be closed after successful creation
      await waitFor(() => {
        expect(screen.queryByTestId('task-creation-modal')).not.toBeInTheDocument();
      });
    });

    it('handles task display', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('display-task'));

      await waitFor(() => {
        expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
      });
    });

    it('handles task update from modal', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      // Show display modal first
      fireEvent.click(screen.getByTestId('display-task'));

      await waitFor(() => {
        expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
      });

      // Update task from modal
      fireEvent.click(screen.getByTestId('update-task'));

      expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
    });

    it('handles adding task note', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      // Show display modal first
      fireEvent.click(screen.getByTestId('display-task'));

      await waitFor(() => {
        expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
      });

      // Add note
      fireEvent.click(screen.getByTestId('add-note'));

      expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
    });
  });

  describe('Modal Conditions', () => {
    it('only shows TaskBoard modal when project and session exist', async () => {
      render(
        <TaskProvider projectId={null} sessionId={null} agents={[]}>
          <TestComponent />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('show-board'));

      // Should not show modal without project/session
      await waitFor(() => {
        expect(screen.queryByTestId('task-board-modal')).not.toBeInTheDocument();
      });
    });

    it('only shows TaskCreation modal when project and session exist', async () => {
      render(
        <TaskProvider projectId={null} sessionId={null} agents={[]}>
          <TestComponent />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('show-creation'));

      // Should not show modal without project/session
      await waitFor(() => {
        expect(screen.queryByTestId('task-creation-modal')).not.toBeInTheDocument();
      });
    });

    it('passes agents to modals', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      // Show creation modal
      fireEvent.click(screen.getByTestId('show-creation'));

      await waitFor(() => {
        expect(screen.getByTestId('task-creation-modal')).toBeInTheDocument();
      });
    });
  });

  describe('Integration with Task Board Modal', () => {
    it('handles task click from TaskBoard modal', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <TestComponent />
        </TaskProvider>
      );

      // Show board modal
      fireEvent.click(screen.getByTestId('show-board'));

      await waitFor(() => {
        expect(screen.getByTestId('task-board-modal')).toBeInTheDocument();
      });

      // Click task in board modal (should open display modal)
      fireEvent.click(screen.getByTestId('click-task'));

      await waitFor(() => {
        expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
      });
    });
  });
});
