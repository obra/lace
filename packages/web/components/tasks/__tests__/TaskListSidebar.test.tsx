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
import type { Task } from '@/types/api';

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
  SidebarButton: ({ children, onClick, variant, size, className, title }: {
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
    assignedTo: 'human',
    createdBy: 'test-user',
    threadId: 'test-session',
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
    createdBy: 'test-user',
    threadId: 'test-session',
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
    assignedTo: 'agent-123',
    createdBy: 'test-user',
    threadId: 'test-session',
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
    });
  });

  it('should render task summary', () => {
    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
      />
    );

    expect(screen.getByText('3 tasks • 1 in progress')).toBeInTheDocument();
  });

  it('should show in progress tasks first', () => {
    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
      />
    );

    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('High Priority Task')).toBeInTheDocument();
  });

  it('should show pending tasks', () => {
    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
      />
    );

    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Pending Task')).toBeInTheDocument();
  });

  it('should show blocked tasks', () => {
    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
      />
    );

    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Blocked Task')).toBeInTheDocument();
  });

  it('should call onOpenTaskBoard when task is clicked', async () => {
    const mockOnOpenTaskBoard = vi.fn();
    const user = userEvent.setup();

    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
        onOpenTaskBoard={mockOnOpenTaskBoard}
      />
    );

    // Find the task item and click it
    const taskItem = screen.getByText('High Priority Task').closest('[role="button"]');
    expect(taskItem).toBeInTheDocument();
    
    await user.click(taskItem!);
    expect(mockOnOpenTaskBoard).toHaveBeenCalled();
  });


  it('should call onCreateTask when create task button is clicked', async () => {
    const mockOnCreateTask = vi.fn();
    const user = userEvent.setup();

    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
        onCreateTask={mockOnCreateTask}
      />
    );

    // Look for the "Add task" button
    await user.click(screen.getByText('Add task'));
    expect(mockOnCreateTask).toHaveBeenCalled();
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
    });

    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument(); // loading spinner
  });

  it('should show empty state when no tasks', () => {
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
    });

    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
      />
    );

    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
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
        assignedTo: 'human',
        createdBy: 'test-user',
        threadId: 'test-session',
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
        createdBy: 'test-user',
        threadId: 'test-session',
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
    });

    render(
      <TaskListSidebar
        projectId="test-project"
        sessionId="test-session"
      />
    );

    // Should show max 3 in progress tasks
    expect(screen.getByText('In Progress Task 1')).toBeInTheDocument();
    expect(screen.getByText('In Progress Task 2')).toBeInTheDocument();
    expect(screen.getByText('In Progress Task 3')).toBeInTheDocument();
    expect(screen.queryByText('In Progress Task 4')).not.toBeInTheDocument();
    expect(screen.queryByText('In Progress Task 5')).not.toBeInTheDocument();

    // Should show max 2 pending tasks
    expect(screen.getByText('Pending Task 1')).toBeInTheDocument();
    expect(screen.getByText('Pending Task 2')).toBeInTheDocument();
    expect(screen.queryByText('Pending Task 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending Task 4')).not.toBeInTheDocument();

  });
});
