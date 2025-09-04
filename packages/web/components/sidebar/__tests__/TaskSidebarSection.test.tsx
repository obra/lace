// ABOUTME: Unit tests for TaskSidebarSection component
// ABOUTME: Tests rendering with TaskProvider context, task statistics, and integration behavior

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskSidebarSection } from '@/components/sidebar/TaskSidebarSection';
import { TaskProvider } from '@/components/providers/TaskProvider';
import type { SessionInfo, ThreadId, Task, AgentInfo } from '@/types/core';
import {
  createMockSessionContext,
  createMockAgentContext,
  createMockProjectContext,
} from '@/__tests__/utils/provider-mocks';

// Mock TaskProvider context to control behavior
const mockTaskContext = vi.hoisted(() => ({
  taskManager: null as ReturnType<typeof createMockTaskManager> | null,
  showTaskBoard: vi.fn(),
  showTaskCreation: vi.fn(),
  handleTaskDisplay: vi.fn(),
  handleTaskUpdate: vi.fn(),
  handleTaskCreate: vi.fn(),
  handleTaskCreateFromModal: vi.fn(),
  handleTaskUpdateFromModal: vi.fn(),
  handleTaskAddNote: vi.fn(),
}));

vi.mock('@/components/providers/TaskProvider', () => ({
  TaskProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useTaskContext: () => mockTaskContext,
  useOptionalTaskContext: () => mockTaskContext,
}));

vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: vi.fn(),
}));

vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: vi.fn(),
  useOptionalSessionContext: vi.fn(),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useOptionalAgentContext: vi.fn(),
}));

// Import mocked hooks
import { useProjectContext } from '@/components/providers/ProjectProvider';
import {
  useSessionContext,
  useOptionalSessionContext,
} from '@/components/providers/SessionProvider';
import { useOptionalAgentContext } from '@/components/providers/AgentProvider';

const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseSessionContext = vi.mocked(useSessionContext);
const mockUseOptionalSessionContext = vi.mocked(useOptionalSessionContext);
const mockUseOptionalAgentContext = vi.mocked(useOptionalAgentContext);

// Mock child components
vi.mock('@/components/layout/Sidebar', () => ({
  SidebarSection: ({
    title,
    children,
    headerActions,
  }: {
    title?: string;
    children: React.ReactNode;
    headerActions?: React.ReactNode;
  }) => (
    <div data-testid="sidebar-section" data-title={title}>
      {headerActions && <div data-testid="header-actions">{headerActions}</div>}
      {children}
    </div>
  ),
}));

vi.mock('@/components/tasks/TaskListSidebar', () => ({
  TaskListSidebar: ({
    taskManager,
    onOpenTaskBoard,
    onCreateTask,
  }: {
    taskManager: { tasks: Task[] };
    onOpenTaskBoard: () => void;
    onCreateTask: () => void;
  }) => (
    <div data-testid="task-list-sidebar">
      <div>Task count: {taskManager?.tasks?.length || 0}</div>
      <button onClick={onOpenTaskBoard} data-testid="task-list-board">
        Open Board
      </button>
      <button onClick={onCreateTask} data-testid="task-list-create">
        Create Task
      </button>
    </div>
  ),
}));

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon, className }: { icon: { iconName: string }; className?: string }) => (
    <span data-testid="font-awesome-icon" className={className}>
      {icon.iconName}
    </span>
  ),
}));

vi.mock('@/lib/fontawesome', () => ({
  faPlus: { iconName: 'plus' },
  faTasks: { iconName: 'tasks' },
}));

// Test data factories
const createMockTask = (id: string, status: Task['status'] = 'pending'): Task => ({
  id,
  title: `Task ${id}`,
  description: 'Test task description',
  prompt: 'Test task prompt',
  status,
  priority: 'medium',
  threadId: 'test-session' as ThreadId,
  createdAt: new Date(),
  updatedAt: new Date(),
  notes: [],
  createdBy: 'user',
});

const createMockAgent = (id: string, name: string): AgentInfo => ({
  threadId: id as ThreadId,
  name,
  providerInstanceId: 'test-provider',
  modelId: 'test-model',
  status: 'idle',
});

const createMockSessionDetails = (): SessionInfo => ({
  id: 'test-session' as ThreadId,
  name: 'Test Session',
  createdAt: new Date(),
  agents: [createMockAgent('agent-1', 'Agent 1')],
});

const createMockTaskManager = (tasks: Task[] = []) => ({
  tasks,
  isLoading: false,
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  error: null,
  refetch: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  addNote: vi.fn(),
  handleTaskCreated: vi.fn(),
  handleTaskUpdated: vi.fn(),
  handleTaskDeleted: vi.fn(),
  handleTaskNoteAdded: vi.fn(),
});

describe('TaskSidebarSection', () => {
  const defaultProps = {
    onCloseMobileNav: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mockTaskContext to prevent state leakage between tests
    mockTaskContext.taskManager = null;
    mockTaskContext.showTaskBoard = vi.fn();
    mockTaskContext.showTaskCreation = vi.fn();
    mockTaskContext.handleTaskDisplay = vi.fn();
    mockTaskContext.handleTaskUpdate = vi.fn();
    mockTaskContext.handleTaskCreate = vi.fn();
    mockTaskContext.handleTaskCreateFromModal = vi.fn();
    mockTaskContext.handleTaskUpdateFromModal = vi.fn();
    mockTaskContext.handleTaskAddNote = vi.fn();

    // Set up provider mocks with default values
    mockUseProjectContext.mockReturnValue(
      createMockProjectContext({
        selectedProject: 'test-project',
        currentProject: createMockProject(),
        projectsForSidebar: [],
        foundProject: createMockProject(),
      })
    );

    const mockSessionContext = createMockSessionContext({
      selectedSession: 'test-session' as ThreadId,
    });

    mockUseSessionContext.mockReturnValue(mockSessionContext);
    mockUseOptionalSessionContext.mockReturnValue(mockSessionContext);

    const mockAgentContext = createMockAgentContext({
      sessionDetails: createMockSessionDetails(),
      selectedAgent: 'test-agent' as ThreadId,
    });

    mockUseOptionalAgentContext.mockReturnValue(mockAgentContext);
  });

  // Helper function to create mock project
  function createMockProject() {
    return {
      id: 'test-project',
      name: 'Test Project',
      description: 'Test Description',
      workingDirectory: '/test',
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      sessionCount: 1,
    };
  }

  describe('Conditional Rendering', () => {
    it('returns null when taskManager is null', () => {
      mockTaskContext.taskManager = null;

      const { container } = render(<TaskSidebarSection {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when selectedProject is null', () => {
      mockTaskContext.taskManager = createMockTaskManager();
      mockUseProjectContext.mockReturnValue(
        createMockProjectContext({
          selectedProject: null,
          foundProject: null,
        })
      );

      const { container } = render(<TaskSidebarSection {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when selectedSession is null', () => {
      mockTaskContext.taskManager = createMockTaskManager();
      const nullSessionContext = createMockSessionContext({
        selectedSession: null,
      });
      mockUseSessionContext.mockReturnValue(nullSessionContext);
      mockUseOptionalSessionContext.mockReturnValue(nullSessionContext);

      const { container } = render(<TaskSidebarSection {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when selectedSessionDetails is null', () => {
      mockTaskContext.taskManager = createMockTaskManager();
      mockUseOptionalAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: null,
          selectedAgent: 'test-agent' as ThreadId,
        })
      );

      const { container } = render(<TaskSidebarSection {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders when all required props are provided', () => {
      mockTaskContext.taskManager = createMockTaskManager([createMockTask('1')]);

      render(<TaskSidebarSection {...defaultProps} />);

      expect(screen.getByTestId('sidebar-section')).toBeInTheDocument();
    });
  });

  describe('Unassigned Task Filtering', () => {
    it('filters and passes only unassigned tasks to TaskListSidebar', () => {
      const tasks = [
        createMockTask('1', 'completed'), // unassigned
        createMockTask('2', 'completed'), // unassigned
        { ...createMockTask('3', 'in_progress'), assignedTo: 'agent-1' as any }, // assigned - should be filtered out
        createMockTask('4', 'pending'), // unassigned
        createMockTask('5', 'pending'), // unassigned
        { ...createMockTask('6', 'pending'), assignedTo: 'agent-2' as any }, // assigned - should be filtered out
      ];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      // Should only pass 4 unassigned tasks (2 completed, 2 pending) to TaskListSidebar
      expect(screen.getByText('Task count: 4')).toBeInTheDocument();
    });

    it('passes zero tasks when all tasks are assigned', () => {
      const tasks = [
        { ...createMockTask('1', 'in_progress'), assignedTo: 'agent-1' as any }, // all assigned
        { ...createMockTask('2', 'pending'), assignedTo: 'agent-2' as any },
      ];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      // TaskListSidebar should receive 0 tasks
      expect(screen.getByText('Task count: 0')).toBeInTheDocument();
    });

    it('passes all tasks when none are assigned', () => {
      const tasks = [
        createMockTask('1', 'completed'), // unassigned
        createMockTask('2', 'in_progress'), // unassigned
        createMockTask('3', 'pending'), // unassigned
      ];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      // TaskListSidebar should receive all 3 tasks
      expect(screen.getByText('Task count: 3')).toBeInTheDocument();
    });
  });

  describe('Button Interactions', () => {
    it('calls showTaskCreation when add task button is clicked', () => {
      mockTaskContext.taskManager = createMockTaskManager([]);

      render(<TaskSidebarSection {...defaultProps} />);

      fireEvent.click(screen.getByTestId('add-task-button'));
      expect(mockTaskContext.showTaskCreation).toHaveBeenCalledTimes(1);
      expect(defaultProps.onCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('renders add task button in header actions', () => {
      mockTaskContext.taskManager = createMockTaskManager([]);

      render(<TaskSidebarSection {...defaultProps} />);

      expect(screen.getByTestId('header-actions')).toBeInTheDocument();
      expect(screen.getByTestId('add-task-button')).toBeInTheDocument();
    });
  });

  describe('TaskListSidebar Integration', () => {
    it('passes only unassigned tasks to TaskListSidebar', () => {
      const tasks = [
        createMockTask('1', 'completed'), // unassigned
        { ...createMockTask('2', 'in_progress'), assignedTo: 'agent-1' as any }, // assigned - filtered out
        createMockTask('3', 'pending'), // unassigned
        createMockTask('4', 'pending'), // unassigned
        { ...createMockTask('5', 'pending'), assignedTo: 'agent-2' as any }, // assigned - filtered out
      ];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      expect(screen.getByTestId('task-list-sidebar')).toBeInTheDocument();
      // Should only pass 3 unassigned tasks (1 completed, 2 pending)
      expect(screen.getByText('Task count: 3')).toBeInTheDocument();
    });

    it('handles TaskListSidebar callbacks correctly', () => {
      const tasks = [createMockTask('1')];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      // Test onOpenTaskBoard callback - should call showTaskBoard
      fireEvent.click(screen.getByTestId('task-list-board'));
      expect(mockTaskContext.showTaskBoard).toHaveBeenCalled();
      expect(defaultProps.onCloseMobileNav).toHaveBeenCalled();

      // Test onCreateTask callback - should call showTaskCreation
      fireEvent.click(screen.getByTestId('task-list-create'));
      expect(mockTaskContext.showTaskCreation).toHaveBeenCalled();
      expect(defaultProps.onCloseMobileNav).toHaveBeenCalled();
    });
  });

  describe('UI Elements', () => {
    it('renders sidebar section with correct title', () => {
      mockTaskContext.taskManager = createMockTaskManager([]);

      render(<TaskSidebarSection {...defaultProps} />);

      const sidebarSection = screen.getByTestId('sidebar-section');
      expect(sidebarSection).toHaveAttribute('data-title', 'Tasks');
    });

    it('renders FontAwesome icons correctly', () => {
      mockTaskContext.taskManager = createMockTaskManager([]);

      render(<TaskSidebarSection {...defaultProps} />);

      const plusIcon = screen.getByText('plus');
      expect(plusIcon).toBeInTheDocument();
      expect(plusIcon).toHaveClass('w-3', 'h-3', 'text-base-content/60');
    });
  });

  describe('Mobile Navigation', () => {
    it('works without onCloseMobileNav callback', () => {
      const tasks = [createMockTask('1')];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} onCloseMobileNav={undefined} />);

      // Should not throw error when clicking add task button
      expect(() => {
        fireEvent.click(screen.getByTestId('add-task-button'));
      }).not.toThrow();
    });
  });
});
