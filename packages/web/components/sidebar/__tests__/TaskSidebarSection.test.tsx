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
import { createMockSessionContext, createMockAgentContext } from '@/__tests__/utils/provider-mocks';

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
}));

vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: vi.fn(),
}));

vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: vi.fn(),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: vi.fn(),
}));

// Import mocked hooks
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';

const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseSessionContext = vi.mocked(useSessionContext);
const mockUseAgentContext = vi.mocked(useAgentContext);

// Mock child components
vi.mock('@/components/layout/Sidebar', () => ({
  SidebarSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="sidebar-section" data-title={title}>
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

    // Set up provider mocks with default values
    mockUseProjectContext.mockReturnValue({
      selectedProject: 'test-project',
      projects: [],
      currentProject: createMockProject(),
      loading: false,
      error: null,
      projectsForSidebar: [],
      foundProject: createMockProject(),
      selectProject: vi.fn(),
      onProjectSelect: vi.fn(),
      updateProject: vi.fn(),
      createProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: vi.fn(),
    });

    mockUseSessionContext.mockReturnValue({
      selectedSession: 'test-session' as ThreadId,
      sessions: [],
      loading: false,
      projectConfig: null,
      foundSession: null,
      selectSession: vi.fn(),
      onSessionSelect: vi.fn(),
      createSession: vi.fn(),
      loadProjectConfig: vi.fn(),
      reloadSessions: vi.fn(),
      enableAgentAutoSelection: vi.fn(),
    });

    mockUseAgentContext.mockReturnValue({
      sessionDetails: createMockSessionDetails(),
      loading: false,
      selectedAgent: 'test-agent',
      foundAgent: null,
      currentAgent: null,
      agentBusy: false,
      selectAgent: vi.fn(),
      onAgentSelect: vi.fn(),
      createAgent: vi.fn(),
      updateAgentState: vi.fn(),
      reloadSessionDetails: vi.fn(),
    });
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
      mockUseProjectContext.mockReturnValue({
        selectedProject: null,
        projects: [],
        currentProject: createMockProject(),
        loading: false,
        error: null,
        projectsForSidebar: [],
        foundProject: null,
        selectProject: vi.fn(),
        onProjectSelect: vi.fn(),
        updateProject: vi.fn(),
        createProject: vi.fn(),
        loadProjectConfiguration: vi.fn(),
        reloadProjects: vi.fn(),
      });

      const { container } = render(<TaskSidebarSection {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when selectedSession is null', () => {
      mockTaskContext.taskManager = createMockTaskManager();
      mockUseSessionContext.mockReturnValue({
        selectedSession: null,
        sessions: [],
        loading: false,
        projectConfig: null,
        foundSession: null,
        selectSession: vi.fn(),
        onSessionSelect: vi.fn(),
        createSession: vi.fn(),
        loadProjectConfig: vi.fn(),
        reloadSessions: vi.fn(),
        enableAgentAutoSelection: vi.fn(),
      });

      const { container } = render(<TaskSidebarSection {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when selectedSessionDetails is null', () => {
      mockTaskContext.taskManager = createMockTaskManager();
      mockUseAgentContext.mockReturnValue({
        sessionDetails: null,
        loading: false,
        selectedAgent: 'test-agent',
        foundAgent: null,
        currentAgent: null,
        agentBusy: false,
        selectAgent: vi.fn(),
        onAgentSelect: vi.fn(),
        createAgent: vi.fn(),
        updateAgentState: vi.fn(),
        reloadSessionDetails: vi.fn(),
      });

      const { container } = render(<TaskSidebarSection {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders when all required props are provided', () => {
      mockTaskContext.taskManager = createMockTaskManager([createMockTask('1')]);

      render(<TaskSidebarSection {...defaultProps} />);

      expect(screen.getByTestId('sidebar-section')).toBeInTheDocument();
    });
  });

  describe('Task Statistics', () => {
    it('displays correct task counts with mixed statuses', () => {
      const tasks = [
        createMockTask('1', 'completed'),
        createMockTask('2', 'completed'),
        createMockTask('3', 'in_progress'),
        createMockTask('4', 'pending'),
        createMockTask('5', 'pending'),
        createMockTask('6', 'pending'),
      ];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      expect(screen.getByText('Task Board (6)')).toBeInTheDocument();
      expect(screen.getByText('2 done')).toBeInTheDocument();
      expect(screen.getByText('1 active')).toBeInTheDocument();
      expect(screen.getByText('3 pending')).toBeInTheDocument();
    });

    it('hides statistics when no tasks exist', () => {
      mockTaskContext.taskManager = createMockTaskManager([]);

      render(<TaskSidebarSection {...defaultProps} />);

      expect(screen.getByText('Task Board (0)')).toBeInTheDocument();
      expect(screen.queryByText('done')).not.toBeInTheDocument();
      expect(screen.queryByText('active')).not.toBeInTheDocument();
      expect(screen.queryByText('pending')).not.toBeInTheDocument();
    });

    it('displays correct counts with only completed tasks', () => {
      const tasks = [
        createMockTask('1', 'completed'),
        createMockTask('2', 'completed'),
        createMockTask('3', 'completed'),
      ];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      expect(screen.getByText('3 done')).toBeInTheDocument();
      expect(screen.getByText('0 active')).toBeInTheDocument();
      expect(screen.getByText('0 pending')).toBeInTheDocument();
    });
  });

  describe('Button Interactions', () => {
    it('calls showTaskBoard when task board button is clicked', () => {
      const tasks = [createMockTask('1')];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      fireEvent.click(screen.getByText('Task Board (1)'));
      expect(mockTaskContext.showTaskBoard).toHaveBeenCalledTimes(1);
      expect(defaultProps.onCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('calls showTaskCreation when add task button is clicked', () => {
      mockTaskContext.taskManager = createMockTaskManager([]);

      render(<TaskSidebarSection {...defaultProps} />);

      fireEvent.click(screen.getByTestId('add-task-button'));
      expect(mockTaskContext.showTaskCreation).toHaveBeenCalledTimes(1);
      expect(defaultProps.onCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('disables task board button when no tasks exist', () => {
      mockTaskContext.taskManager = createMockTaskManager([]);

      render(<TaskSidebarSection {...defaultProps} />);

      const taskBoardButton = screen.getByText('Task Board (0)');
      expect(taskBoardButton).toBeDisabled();
    });

    it('enables task board button when tasks exist', () => {
      const tasks = [createMockTask('1')];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      const taskBoardButton = screen.getByText('Task Board (1)');
      expect(taskBoardButton).not.toBeDisabled();
    });
  });

  describe('TaskListSidebar Integration', () => {
    it('passes taskManager to TaskListSidebar', () => {
      const tasks = [
        createMockTask('1', 'completed'),
        createMockTask('2', 'in_progress'),
        createMockTask('3', 'pending'),
        createMockTask('4', 'pending'),
        createMockTask('5', 'pending'),
      ];
      mockTaskContext.taskManager = createMockTaskManager(tasks);

      render(<TaskSidebarSection {...defaultProps} />);

      expect(screen.getByTestId('task-list-sidebar')).toBeInTheDocument();
      expect(screen.getByText('Task count: 5')).toBeInTheDocument();
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

      // Should not throw error
      expect(() => {
        fireEvent.click(screen.getByText('Task Board (1)'));
        fireEvent.click(screen.getByTestId('add-task-button'));
      }).not.toThrow();
    });
  });
});
