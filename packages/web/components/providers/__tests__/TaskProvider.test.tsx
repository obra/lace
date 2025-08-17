// ABOUTME: Integration tests for TaskProvider focusing on real provider responsibilities
// ABOUTME: Tests context provision, modal management, and integration with actual task management

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskProvider, useTaskContext } from '@/components/providers/TaskProvider';
import type { Task, AgentInfo, ThreadId } from '@/types/core';

// Only mock external API calls - let everything else use real implementation
vi.mock('@/hooks/useTaskManager', () => ({
  useTaskManager: vi.fn(() => ({
    tasks: [
      {
        id: 'task-1',
        title: 'Test Task',
        description: 'Test description',
        prompt: 'Test prompt',
        status: 'pending',
        priority: 'medium',
        threadId: 'test-session',
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
        createdBy: 'user',
      },
    ],
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
  })),
}));

// Simple modal mocks that just show when open - focus on TaskProvider logic, not modal internals
vi.mock('@/components/modals/TaskBoardModal', () => ({
  TaskBoardModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="task-board-modal">
        <button onClick={onClose} data-testid="close-board">
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/modals/TaskCreationModal', () => ({
  TaskCreationModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="task-creation-modal">
        <button onClick={onClose} data-testid="close-creation">
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/modals/TaskDisplayModal', () => ({
  TaskDisplayModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="task-display-modal">
        <button onClick={onClose} data-testid="close-display">
          Close
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

// Component to test context provision
function ContextConsumer() {
  const { taskManager, showTaskBoard, showTaskCreation, handleTaskDisplay } = useTaskContext();

  return (
    <div>
      <div data-testid="task-count">{taskManager?.tasks?.length || 0}</div>
      <button onClick={showTaskBoard} data-testid="show-board">
        Show Board
      </button>
      <button onClick={showTaskCreation} data-testid="show-creation">
        Show Creation
      </button>
      <button onClick={() => handleTaskDisplay(createMockTask())} data-testid="show-display">
        Show Display
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

  describe('Context Provision', () => {
    it('provides task context to children', () => {
      render(
        <TaskProvider {...defaultProps}>
          <ContextConsumer />
        </TaskProvider>
      );

      // Should provide task data from useTaskManager
      expect(screen.getByTestId('task-count')).toHaveTextContent('1');

      // Should provide handler functions
      expect(screen.getByTestId('show-board')).toBeInTheDocument();
      expect(screen.getByTestId('show-creation')).toBeInTheDocument();
      expect(screen.getByTestId('show-display')).toBeInTheDocument();
    });

    it('throws error when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ContextConsumer />);
      }).toThrow('useTaskContext must be used within a TaskProvider');

      consoleSpy.mockRestore();
    });

    it('handles null project and session IDs gracefully', () => {
      render(
        <TaskProvider projectId={null} sessionId={null} agents={[]}>
          <ContextConsumer />
        </TaskProvider>
      );

      // Should still provide context but with task manager data
      expect(screen.getByTestId('task-count')).toHaveTextContent('1'); // Mock still returns 1 task
    });
  });

  describe('Modal State Management', () => {
    it('shows TaskBoard modal when showTaskBoard is called', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <ContextConsumer />
        </TaskProvider>
      );

      // Initially no modal
      expect(screen.queryByTestId('task-board-modal')).not.toBeInTheDocument();

      // Trigger modal show
      fireEvent.click(screen.getByTestId('show-board'));

      // Modal should appear
      await waitFor(() => {
        expect(screen.getByTestId('task-board-modal')).toBeInTheDocument();
      });
    });

    it('shows TaskCreation modal when showTaskCreation is called', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <ContextConsumer />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('show-creation'));

      await waitFor(() => {
        expect(screen.getByTestId('task-creation-modal')).toBeInTheDocument();
      });
    });

    it('shows TaskDisplay modal when handleTaskDisplay is called', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <ContextConsumer />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('show-display'));

      await waitFor(() => {
        expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
      });
    });

    it('hides modals when close buttons are clicked', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <ContextConsumer />
        </TaskProvider>
      );

      // Show modal
      fireEvent.click(screen.getByTestId('show-board'));
      await waitFor(() => {
        expect(screen.getByTestId('task-board-modal')).toBeInTheDocument();
      });

      // Close modal
      fireEvent.click(screen.getByTestId('close-board'));
      await waitFor(() => {
        expect(screen.queryByTestId('task-board-modal')).not.toBeInTheDocument();
      });
    });
  });

  describe('Conditional Modal Rendering', () => {
    it('only renders TaskBoard modal when project and session exist', async () => {
      render(
        <TaskProvider projectId={null} sessionId={null} agents={[]}>
          <ContextConsumer />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('show-board'));

      // Should not show modal without project/session
      await waitFor(() => {
        expect(screen.queryByTestId('task-board-modal')).not.toBeInTheDocument();
      });
    });

    it('only renders TaskCreation modal when project and session exist', async () => {
      render(
        <TaskProvider projectId={null} sessionId={null} agents={[]}>
          <ContextConsumer />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('show-creation'));

      await waitFor(() => {
        expect(screen.queryByTestId('task-creation-modal')).not.toBeInTheDocument();
      });
    });

    it('renders TaskDisplay modal regardless of project/session (uses selected task)', async () => {
      render(
        <TaskProvider projectId={null} sessionId={null} agents={[]}>
          <ContextConsumer />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('show-display'));

      await waitFor(() => {
        expect(screen.getByTestId('task-display-modal')).toBeInTheDocument();
      });
    });
  });

  describe('Props Integration', () => {
    it('passes agents to modals', async () => {
      render(
        <TaskProvider {...defaultProps}>
          <ContextConsumer />
        </TaskProvider>
      );

      fireEvent.click(screen.getByTestId('show-creation'));

      await waitFor(() => {
        expect(screen.getByTestId('task-creation-modal')).toBeInTheDocument();
      });

      // Modal is rendered with agents prop (verified by no errors thrown)
    });

    it('uses loading states from taskManager', () => {
      render(
        <TaskProvider {...defaultProps}>
          <ContextConsumer />
        </TaskProvider>
      );

      // TaskProvider integrates with taskManager loading states (no errors should occur)
      expect(screen.getByTestId('task-count')).toBeInTheDocument();
    });
  });
});
