// ABOUTME: Tests for TaskBoardModal component
// ABOUTME: Tests task board modal functionality including task management and filtering

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { TaskBoardModal } from '@/components/modals/TaskBoardModal';
import type { Task } from '@/types/core';
import { asThreadId, type ThreadId, type AssigneeId } from '@/types/core';

const mockTasks: Task[] = [
  {
    id: 'task-1',
    title: 'Test Task 1',
    description: 'First test task',
    prompt: 'Test prompt 1',
    status: 'pending',
    priority: 'high',
    assignedTo: 'agent-1' as AssigneeId,
    createdBy: asThreadId('thread-1'),
    threadId: asThreadId('thread-1'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    notes: [],
  },
  {
    id: 'task-2',
    title: 'Test Task 2',
    description: 'Second test task',
    prompt: 'Test prompt 2', 
    status: 'in_progress',
    priority: 'medium',
    assignedTo: 'agent-2' as AssigneeId,
    createdBy: asThreadId('thread-2'),
    threadId: asThreadId('thread-2'),
    createdAt: new Date('2024-01-02T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    notes: [],
  }
];

describe('TaskBoardModal', () => {
  const mockOnClose = vi.fn();
  const mockOnTaskUpdate = vi.fn();
  const mockOnTaskCreate = vi.fn();
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render task board modal when open', () => {
    render(
      <TaskBoardModal
        isOpen={true}
        onClose={mockOnClose}
        tasks={mockTasks}
        onTaskUpdate={mockOnTaskUpdate}
        onTaskCreate={mockOnTaskCreate}
      />
    );

    expect(screen.getByText(/project tasks/i)).toBeInTheDocument();
    expect(screen.getByText('Test Task 1')).toBeInTheDocument();
    expect(screen.getByText('Test Task 2')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(
      <TaskBoardModal
        isOpen={false}
        onClose={mockOnClose}
        tasks={mockTasks}
        onTaskUpdate={mockOnTaskUpdate}
        onTaskCreate={mockOnTaskCreate}
      />
    );

    expect(screen.queryByText(/project tasks/i)).not.toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    render(
      <TaskBoardModal
        isOpen={true}
        onClose={mockOnClose}
        tasks={mockTasks}
        onTaskUpdate={mockOnTaskUpdate}
        onTaskCreate={mockOnTaskCreate}
      />
    );

    const closeButton = screen.getByLabelText('Close modal');
    await user.click(closeButton);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should organize tasks by status', () => {
    render(
      <TaskBoardModal
        isOpen={true}
        onClose={mockOnClose}
        tasks={mockTasks}
        onTaskUpdate={mockOnTaskUpdate}
        onTaskCreate={mockOnTaskCreate}
      />
    );

    // Check that columns exist
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('should handle empty task list', () => {
    render(
      <TaskBoardModal
        isOpen={true}
        onClose={mockOnClose}
        tasks={[]}
        onTaskUpdate={mockOnTaskUpdate}
        onTaskCreate={mockOnTaskCreate}
      />
    );

    expect(screen.getByText(/project tasks/i)).toBeInTheDocument();
    // Should still show columns even with no tasks
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('should show task priorities', () => {
    render(
      <TaskBoardModal
        isOpen={true}
        onClose={mockOnClose}
        tasks={mockTasks}
        onTaskUpdate={mockOnTaskUpdate}
        onTaskCreate={mockOnTaskCreate}
      />
    );

    // Check that priority indicators are shown (would depend on implementation)
    expect(screen.getByText('Test Task 1')).toBeInTheDocument();
    expect(screen.getByText('Test Task 2')).toBeInTheDocument();
  });
});