// ABOUTME: Unit tests for TaskListSidebar component
// ABOUTME: Tests task grouping, filtering, and sidebar interactions

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { TaskListSidebar } from '@/components/tasks/TaskListSidebar';
import type { Task } from '@/types/core';
import { asThreadId, asAssigneeId } from '@/types/core';

// Mock the useTaskManager hook
vi.mock('@/hooks/useTaskManager', () => ({
  useTaskManager: vi.fn(),
}));

// Import the mock after setting up the mock
import { useTaskManager } from '@/hooks/useTaskManager';
const mockUseTaskManager = vi.mocked(useTaskManager);

// Mock FontAwesome icons
vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon, className }: { icon: unknown; className?: string }) => (
    <span data-testid="icon" className={className} data-icon={String(icon)} />
  ),
}));

// Mock Sidebar components
vi.mock('@/components/layout/Sidebar', () => ({
  SidebarButton: ({
    children,
    onClick,
    variant,
    size,
    className,
    title,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    size?: string;
    className?: string;
    title?: string;
  }) => (
    <button
      data-testid="sidebar-button"
      onClick={onClick}
      data-variant={variant}
      data-size={size}
      className={className}
      title={title}
    >
      {children}
    </button>
  ),
}));

const mockTasks: Task[] = [
  {
    id: 'task-1',
    title: 'High Priority Task',
    description: 'Important task',
    prompt: 'Do important work',
    status: 'in_progress',
    priority: 'high',
    assignedTo: asAssigneeId('human'),
    createdBy: asThreadId('lace_20250101_user01'),
    threadId: asThreadId('lace_20250101_sess01'),
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    notes: [],
  },
  {
    id: 'task-2',
    title: 'Pending Task',
    description: 'Task to do',
    prompt: 'Complete this task',
    status: 'pending',
    priority: 'medium',
    assignedTo: undefined,
    createdBy: asThreadId('lace_20250101_user01'),
    threadId: asThreadId('lace_20250101_sess01'),
    createdAt: new Date('2024-01-15T09:00:00Z'),
    updatedAt: new Date('2024-01-15T09:00:00Z'),
    notes: [],
  },
  {
    id: 'task-3',
    title: 'Blocked Task',
    description: 'Task blocked by dependency',
    prompt: 'Wait for dependency',
    status: 'blocked',
    priority: 'low',
    assignedTo: asAssigneeId('agent-123'),
    createdBy: asThreadId('lace_20250101_user01'),
    threadId: asThreadId('lace_20250101_sess01'),
    createdAt: new Date('2024-01-15T08:00:00Z'),
    updatedAt: new Date('2024-01-15T08:00:00Z'),
    notes: [],
  },
];

describe('TaskListSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock return value
    mockUseTaskManager.mockReturnValue({
      tasks: mockTasks,
      isLoading: false,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      error: null,
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      addNote: vi.fn(),
      refetch: vi.fn(),
      handleTaskCreated: vi.fn(),
      handleTaskUpdated: vi.fn(),
      handleTaskDeleted: vi.fn(),
      handleTaskNoteAdded: vi.fn(),
    });
  });

  it('should not render task summary (feature removed)', () => {
    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} />);

    // Task summary was removed in UI refactor
    expect(screen.queryByText('3 tasks • 1 in progress')).not.toBeInTheDocument();
  });

  it('should show in progress tasks section with chevron and count', () => {
    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} />);

    expect(screen.getByText('In Progress (1)')).toBeInTheDocument();
    // Tasks are initially expanded, so should see the task
    expect(screen.getByText('High Priority Task')).toBeInTheDocument();
  });

  it('should show pending tasks section collapsed by default', () => {
    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} />);

    expect(screen.getByText('Pending (1)')).toBeInTheDocument();
    // Pending section starts collapsed, so task should not be visible initially
    expect(screen.queryByText('Pending Task')).not.toBeInTheDocument();
  });

  it('should show blocked tasks section collapsed by default', () => {
    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} />);

    expect(screen.getByText('Blocked (1)')).toBeInTheDocument();
    // Blocked section starts collapsed, so task should not be visible initially
    expect(screen.queryByText('Blocked Task')).not.toBeInTheDocument();
  });

  it('should call onOpenTaskBoard when task is clicked', async () => {
    const mockOnOpenTaskBoard = vi.fn();
    const user = userEvent.setup();

    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} onOpenTaskBoard={mockOnOpenTaskBoard} />);

    // Find the task item and click it
    const taskItem = screen.getByText('High Priority Task').closest('[role="button"]');
    expect(taskItem).toBeInTheDocument();

    await user.click(taskItem!);
    expect(mockOnOpenTaskBoard).toHaveBeenCalled();
  });

  it('should not render create task button (functionality moved to section header)', () => {
    const mockOnCreateTask = vi.fn();

    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} onCreateTask={mockOnCreateTask} />);

    // The "Add task" button is now in the parent component's section header, not in this component
    expect(screen.queryByText('Add task')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-task-button')).not.toBeInTheDocument();
  });

  it('should show loading state', () => {
    mockUseTaskManager.mockReturnValue({
      tasks: [],
      isLoading: true,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      error: null,
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      addNote: vi.fn(),
      refetch: vi.fn(),
      handleTaskCreated: vi.fn(),
      handleTaskUpdated: vi.fn(),
      handleTaskDeleted: vi.fn(),
      handleTaskNoteAdded: vi.fn(),
    });

    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} />);

    expect(screen.getByRole('status')).toBeInTheDocument(); // loading spinner
  });

  it('should render empty when no tasks (no empty state message)', () => {
    mockUseTaskManager.mockReturnValue({
      tasks: [],
      isLoading: false,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      error: null,
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      addNote: vi.fn(),
      refetch: vi.fn(),
      handleTaskCreated: vi.fn(),
      handleTaskUpdated: vi.fn(),
      handleTaskDeleted: vi.fn(),
      handleTaskNoteAdded: vi.fn(),
    });

    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} />);

    // Verify that no tasks are shown and no "No tasks yet" message is displayed
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/In Progress/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pending/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Blocked/)).not.toBeInTheDocument();
  });

  it('should expand and collapse task sections when clicked', async () => {
    const user = userEvent.setup();
    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} />);

    // Pending section should start collapsed
    expect(screen.getByText('Pending (1)')).toBeInTheDocument();
    expect(screen.queryByText('Pending Task')).not.toBeInTheDocument();

    // Click to expand pending section
    await user.click(screen.getByText('Pending (1)'));
    expect(screen.getByText('Pending Task')).toBeInTheDocument();

    // Click to collapse it again
    await user.click(screen.getByText('Pending (1)'));
    expect(screen.queryByText('Pending Task')).not.toBeInTheDocument();
  });

  it('should limit tasks shown per section', () => {
    // Create many tasks to test limits
    const manyTasks: Task[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `in-progress-${i}`,
        title: `In Progress Task ${i + 1}`,
        description: `Task ${i + 1}`,
        prompt: `Do task ${i + 1}`,
        status: 'in_progress' as const,
        priority: 'medium' as const,
        assignedTo: asAssigneeId('human'),
        createdBy: asThreadId('lace_20250101_user01'),
        threadId: asThreadId('lace_20250101_sess01'),
        createdAt: new Date('2024-01-15T10:00:00Z'),
        updatedAt: new Date('2024-01-15T10:00:00Z'),
        notes: [],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `pending-${i}`,
        title: `Pending Task ${i + 1}`,
        description: `Task ${i + 1}`,
        prompt: `Do task ${i + 1}`,
        status: 'pending' as const,
        priority: 'medium' as const,
        assignedTo: undefined,
        createdBy: asThreadId('lace_20250101_user01'),
        threadId: asThreadId('lace_20250101_sess01'),
        createdAt: new Date('2024-01-15T09:00:00Z'),
        updatedAt: new Date('2024-01-15T09:00:00Z'),
        notes: [],
      })),
    ];

    mockUseTaskManager.mockReturnValue({
      tasks: manyTasks,
      isLoading: false,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      error: null,
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      addNote: vi.fn(),
      refetch: vi.fn(),
      handleTaskCreated: vi.fn(),
      handleTaskUpdated: vi.fn(),
      handleTaskDeleted: vi.fn(),
      handleTaskNoteAdded: vi.fn(),
    });

    const mockTaskManager = useTaskManager('test-project', 'lace_20250101_sess01');
    render(<TaskListSidebar taskManager={mockTaskManager} />);

    // Should show section headers with correct counts
    expect(screen.getByText('In Progress (5)')).toBeInTheDocument();
    expect(screen.getByText('Pending (4)')).toBeInTheDocument();

    // In progress is expanded by default, should show max 3 tasks
    expect(screen.getByText('In Progress Task 1')).toBeInTheDocument();
    expect(screen.getByText('In Progress Task 2')).toBeInTheDocument();
    expect(screen.getByText('In Progress Task 3')).toBeInTheDocument();
    expect(screen.queryByText('In Progress Task 4')).not.toBeInTheDocument();
    expect(screen.queryByText('In Progress Task 5')).not.toBeInTheDocument();

    // Pending starts collapsed, so no tasks should be visible initially
    expect(screen.queryByText('Pending Task 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending Task 2')).not.toBeInTheDocument();
  });
});
