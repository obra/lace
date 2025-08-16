// ABOUTME: Unit tests for TaskSidebarSection component
// ABOUTME: Tests rendering, task statistics, button interactions, and conditional display

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskSidebarSection } from '@/components/sidebar/TaskSidebarSection';
import { useTaskManager } from '@/hooks/useTaskManager';
import type { SessionInfo, ThreadId, Task } from '@/types/core';

type TaskManager = ReturnType<typeof useTaskManager>;

// Use vi.hoisted to ensure mock functions are available during hoisting
const mockSidebarSection = vi.hoisted(() => {
  const MockSidebarSection = ({
    title,
    icon,
    children,
  }: {
    title: string;
    icon: { iconName: string };
    children: React.ReactNode;
    defaultCollapsed?: boolean;
    collapsible?: boolean;
  }) => (
    <div data-testid="sidebar-section" data-title={title}>
      {children}
    </div>
  );
  MockSidebarSection.displayName = 'MockSidebarSection';
  return MockSidebarSection;
});

const mockTaskListSidebar = vi.hoisted(() => {
  const MockTaskListSidebar = ({
    taskManager,
    onTaskClick,
    onOpenTaskBoard,
    onCreateTask,
  }: {
    taskManager: TaskManager;
    onTaskClick: (taskId: string) => void;
    onOpenTaskBoard: () => void;
    onCreateTask: () => void;
  }) => (
    <div data-testid="task-list-sidebar">
      <div>Task count: {taskManager.tasks.length}</div>
      <button onClick={() => onTaskClick('test-task')}>Click Task</button>
      <button onClick={onOpenTaskBoard}>Open Board</button>
      <button onClick={onCreateTask}>Create Task</button>
    </div>
  );
  MockTaskListSidebar.displayName = 'MockTaskListSidebar';
  return MockTaskListSidebar;
});

const mockFontAwesome = vi.hoisted(() => {
  const MockFontAwesome = ({
    icon,
    className,
  }: {
    icon: { iconName: string };
    className?: string;
  }) => (
    <span data-testid="font-awesome-icon" className={className}>
      {icon.iconName}
    </span>
  );
  MockFontAwesome.displayName = 'MockFontAwesome';
  return MockFontAwesome;
});

// Mock dependencies
vi.mock('@/components/layout/Sidebar', () => ({
  SidebarSection: mockSidebarSection,
}));

vi.mock('@/components/tasks/TaskListSidebar', () => ({
  TaskListSidebar: mockTaskListSidebar,
}));

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: mockFontAwesome,
}));

vi.mock('@/lib/fontawesome', () => ({
  faPlus: { iconName: 'plus' },
  faTasks: { iconName: 'tasks' },
}));

vi.mock('@/hooks/useTaskManager', () => ({
  useTaskManager: vi.fn(),
}));

// Test data factories
const createMockTaskManager = (
  statusDistribution: { completed: number; in_progress: number; pending: number } = {
    completed: 0,
    in_progress: 0,
    pending: 0,
  }
): TaskManager => {
  const tasks = [];
  let taskId = 1;

  // Create completed tasks
  for (let i = 0; i < statusDistribution.completed; i++) {
    tasks.push({
      id: `task-${taskId++}`,
      status: 'completed' as const,
      title: `Completed Task ${i + 1}`,
      description: 'Test description',
      prompt: 'Test prompt',
      priority: 'medium' as const,
      assignedTo: undefined,
      createdBy: 'test-user',
      threadId: 'test-thread' as ThreadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    });
  }

  // Create in_progress tasks
  for (let i = 0; i < statusDistribution.in_progress; i++) {
    tasks.push({
      id: `task-${taskId++}`,
      status: 'in_progress' as const,
      title: `Active Task ${i + 1}`,
      description: 'Test description',
      prompt: 'Test prompt',
      priority: 'medium' as const,
      assignedTo: undefined,
      createdBy: 'test-user',
      threadId: 'test-thread' as ThreadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    });
  }

  // Create pending tasks
  for (let i = 0; i < statusDistribution.pending; i++) {
    tasks.push({
      id: `task-${taskId++}`,
      status: 'pending' as const,
      title: `Pending Task ${i + 1}`,
      description: 'Test description',
      prompt: 'Test prompt',
      priority: 'medium' as const,
      assignedTo: undefined,
      createdBy: 'test-user',
      threadId: 'test-thread' as ThreadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    });
  }

  return {
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
  };
};

const mockSessionDetails: SessionInfo = {
  id: 'test-session' as ThreadId,
  name: 'Test Session',
  agents: [],
  createdAt: new Date(),
};

describe('TaskSidebarSection', () => {
  const defaultProps = {
    selectedProject: 'test-project',
    selectedSession: 'test-session' as ThreadId,
    selectedSessionDetails: mockSessionDetails,
    onShowTaskBoard: vi.fn(),
    onShowTaskCreation: vi.fn(),
    onCloseMobileNav: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Conditional Rendering', () => {
    it('returns null when taskManager is null', () => {
      const { container } = render(<TaskSidebarSection {...defaultProps} taskManager={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when selectedProject is null', () => {
      const taskManager = createMockTaskManager();
      const { container } = render(
        <TaskSidebarSection {...defaultProps} selectedProject={null} taskManager={taskManager} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('returns null when selectedSession is null', () => {
      const taskManager = createMockTaskManager();
      const { container } = render(
        <TaskSidebarSection {...defaultProps} selectedSession={null} taskManager={taskManager} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('returns null when selectedSessionDetails is null', () => {
      const taskManager = createMockTaskManager();
      const { container } = render(
        <TaskSidebarSection
          {...defaultProps}
          selectedSessionDetails={null}
          taskManager={taskManager}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders when all required props are provided', () => {
      const taskManager = createMockTaskManager();
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      expect(screen.getByTestId('sidebar-section')).toBeInTheDocument();
    });
  });

  describe('Task Statistics', () => {
    it('displays correct task counts with mixed statuses', () => {
      const taskManager = createMockTaskManager({ completed: 2, in_progress: 1, pending: 3 });
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      expect(screen.getByText('Task Board (6)')).toBeInTheDocument();
      expect(screen.getByText('2 done')).toBeInTheDocument();
      expect(screen.getByText('1 active')).toBeInTheDocument();
      expect(screen.getByText('3 pending')).toBeInTheDocument();
    });

    it('hides statistics when no tasks exist', () => {
      const taskManager = createMockTaskManager();
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      expect(screen.getByText('Task Board (0)')).toBeInTheDocument();
      expect(screen.queryByText('done')).not.toBeInTheDocument();
      expect(screen.queryByText('active')).not.toBeInTheDocument();
      expect(screen.queryByText('pending')).not.toBeInTheDocument();
    });

    it('displays correct counts with only completed tasks', () => {
      const taskManager = createMockTaskManager({ completed: 3, in_progress: 0, pending: 0 });
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      expect(screen.getByText('3 done')).toBeInTheDocument();
      expect(screen.getByText('0 active')).toBeInTheDocument();
      expect(screen.getByText('0 pending')).toBeInTheDocument();
    });
  });

  describe('Button Interactions', () => {
    it('calls onShowTaskBoard when task board button is clicked', () => {
      const taskManager = createMockTaskManager({ completed: 0, in_progress: 0, pending: 1 });
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      fireEvent.click(screen.getByText('Task Board (1)'));
      expect(defaultProps.onShowTaskBoard).toHaveBeenCalledTimes(1);
    });

    it('calls onShowTaskCreation when add task button is clicked', () => {
      const taskManager = createMockTaskManager();
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      fireEvent.click(screen.getByTestId('add-task-button'));
      expect(defaultProps.onShowTaskCreation).toHaveBeenCalledTimes(1);
    });

    it('disables task board button when no tasks exist', () => {
      const taskManager = createMockTaskManager();
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      const taskBoardButton = screen.getByText('Task Board (0)');
      expect(taskBoardButton).toBeDisabled();
    });

    it('enables task board button when tasks exist', () => {
      const taskManager = createMockTaskManager({ completed: 0, in_progress: 0, pending: 1 });
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      const taskBoardButton = screen.getByText('Task Board (1)');
      expect(taskBoardButton).not.toBeDisabled();
    });
  });

  describe('Mobile Navigation', () => {
    it('calls onCloseMobileNav when task board button is clicked', () => {
      const taskManager = createMockTaskManager({ completed: 0, in_progress: 0, pending: 1 });
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      fireEvent.click(screen.getByText('Task Board (1)'));
      expect(defaultProps.onCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('calls onCloseMobileNav when add task button is clicked', () => {
      const taskManager = createMockTaskManager();
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      fireEvent.click(screen.getByTestId('add-task-button'));
      expect(defaultProps.onCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('works without onCloseMobileNav callback', () => {
      const taskManager = createMockTaskManager({ completed: 0, in_progress: 0, pending: 1 });
      render(
        <TaskSidebarSection
          {...defaultProps}
          taskManager={taskManager}
          onCloseMobileNav={undefined}
        />
      );

      // Should not throw error
      expect(() => {
        fireEvent.click(screen.getByText('Task Board (1)'));
        fireEvent.click(screen.getByTestId('add-task-button'));
      }).not.toThrow();
    });
  });

  describe('TaskListSidebar Integration', () => {
    it('passes taskManager to TaskListSidebar', () => {
      const taskManager = createMockTaskManager({ completed: 2, in_progress: 1, pending: 2 });
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      expect(screen.getByTestId('task-list-sidebar')).toBeInTheDocument();
      expect(screen.getByText('Task count: 5')).toBeInTheDocument();
    });

    it('handles TaskListSidebar callbacks correctly', () => {
      const taskManager = createMockTaskManager({ completed: 0, in_progress: 0, pending: 1 });
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      // Test onTaskClick callback
      fireEvent.click(screen.getByText('Click Task'));
      expect(defaultProps.onCloseMobileNav).toHaveBeenCalled();

      // Test onOpenTaskBoard callback
      fireEvent.click(screen.getByText('Open Board'));
      expect(defaultProps.onShowTaskBoard).toHaveBeenCalled();

      // Test onCreateTask callback
      fireEvent.click(screen.getByText('Create Task'));
      expect(defaultProps.onShowTaskCreation).toHaveBeenCalled();
    });
  });

  describe('UI Elements', () => {
    it('renders sidebar section with correct title and icon', () => {
      const taskManager = createMockTaskManager();
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      const sidebarSection = screen.getByTestId('sidebar-section');
      expect(sidebarSection).toHaveAttribute('data-title', 'Tasks');
    });

    it('renders FontAwesome icons correctly', () => {
      const taskManager = createMockTaskManager();
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      const plusIcon = screen.getByText('plus');
      expect(plusIcon).toBeInTheDocument();
      expect(plusIcon).toHaveClass('w-3', 'h-3', 'text-base-content/60');
    });

    it('applies correct styling classes', () => {
      const taskManager = createMockTaskManager({ completed: 1, in_progress: 0, pending: 0 });
      render(<TaskSidebarSection {...defaultProps} taskManager={taskManager} />);

      // Check task overview container styling
      const overviewDiv = screen.getByText('Task Board (1)').closest('div')?.parentElement;
      expect(overviewDiv).toHaveClass(
        'bg-base-300/20',
        'backdrop-blur-sm',
        'border',
        'border-base-300/15',
        'rounded-xl',
        'p-3',
        'mb-3',
        'shadow-sm',
        '-ml-1'
      );
    });
  });
});
