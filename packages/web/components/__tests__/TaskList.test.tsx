// ABOUTME: Unit tests for TaskList component
// ABOUTME: Tests task list display, filtering, and interactions

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TaskList } from '@/components/TaskList';
import type { Task } from '@/types/api';

const mockTasks: Task[] = [
  {
    id: 'task_20240101_abc123',
    title: 'Complete feature',
    description: 'Implement new feature',
    prompt: 'Implement X feature with Y requirements',
    status: 'pending' as const,
    priority: 'high' as const,
    assignedTo: 'lace_20240101_agent1',
    createdBy: 'lace_20240101_creator',
    threadId: 'lace_20240101_session',
    createdAt: '2024-01-01T10:00:00Z',
    updatedAt: '2024-01-01T10:00:00Z',
    notes: [],
  },
  {
    id: 'task_20240101_def456',
    title: 'Fix bug',
    description: 'Fix critical bug',
    prompt: 'Debug and fix the issue',
    status: 'in_progress' as const,
    priority: 'medium' as const,
    assignedTo: 'lace_20240101_agent2',
    createdBy: 'human',
    threadId: 'lace_20240101_session',
    createdAt: '2024-01-01T11:00:00Z',
    updatedAt: '2024-01-01T12:00:00Z',
    notes: [
      {
        id: 'note_20240101_n1',
        author: 'lace_20240101_agent2',
        content: 'Working on this',
        timestamp: '2024-01-01T11:30:00Z',
      },
    ],
  },
  {
    id: 'task_20240101_ghi789',
    title: 'Documentation',
    description: 'Update docs',
    prompt: 'Update documentation for new feature',
    status: 'completed' as const,
    priority: 'low' as const,
    createdBy: 'human',
    threadId: 'lace_20240101_session',
    createdAt: '2024-01-01T09:00:00Z',
    updatedAt: '2024-01-01T13:00:00Z',
    notes: [],
  },
];

describe('TaskList', () => {
  it('should render tasks', () => {
    render(<TaskList tasks={mockTasks} onTaskClick={vi.fn()} />);

    expect(screen.getByText('Complete feature')).toBeTruthy();
    expect(screen.getByText('Fix bug')).toBeTruthy();
    expect(screen.getByText('Documentation')).toBeTruthy();

    // Check descriptions
    expect(screen.getByText('Implement new feature')).toBeTruthy();
    expect(screen.getByText('Fix critical bug')).toBeTruthy();

    // Check priorities
    expect(screen.getByText('HIGH')).toBeTruthy();
    expect(screen.getByText('MEDIUM')).toBeTruthy();
    expect(screen.getByText('LOW')).toBeTruthy();
  });

  it('should handle task click', () => {
    const onTaskClick = vi.fn();
    render(<TaskList tasks={mockTasks} onTaskClick={onTaskClick} />);

    fireEvent.click(screen.getByText('Complete feature'));
    expect(onTaskClick).toHaveBeenCalledWith(mockTasks[0]);
  });

  it('should show empty state', () => {
    render(<TaskList tasks={[]} onTaskClick={vi.fn()} />);

    expect(screen.getByText('No tasks found')).toBeTruthy();
  });

  it('should show loading state', () => {
    render(<TaskList tasks={[]} onTaskClick={vi.fn()} loading />);

    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('should show error state', () => {
    render(<TaskList tasks={[]} onTaskClick={vi.fn()} error="Failed to load tasks" />);

    expect(screen.getByText('Error: Failed to load tasks')).toBeTruthy();
  });

  it('should handle status change', () => {
    const onStatusChange = vi.fn();
    render(
      <TaskList
        tasks={mockTasks}
        onTaskClick={vi.fn()}
        onStatusChange={onStatusChange}
      />
    );

    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(statusSelect, { target: { value: 'completed' } });

    expect(onStatusChange).toHaveBeenCalledWith('task_20240101_abc123', 'completed');
  });

  it('should sort tasks by priority', () => {
    render(<TaskList tasks={mockTasks} onTaskClick={vi.fn()} />);

    const taskTitles = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent);
    
    // High priority should be first
    expect(taskTitles[0]).toBe('Complete feature');
    // Medium priority should be second
    expect(taskTitles[1]).toBe('Fix bug');
    // Low priority should be last
    expect(taskTitles[2]).toBe('Documentation');
  });

  it('should show note count', () => {
    render(<TaskList tasks={mockTasks} onTaskClick={vi.fn()} />);

    expect(screen.getByText('1 notes')).toBeTruthy();
  });

  it('should format assignee names', () => {
    render(<TaskList tasks={mockTasks} onTaskClick={vi.fn()} />);

    // formatAssignee extracts the last part of thread ID
    expect(screen.getByText('Assigned to: agent1')).toBeTruthy();
    expect(screen.getByText('Assigned to: agent2')).toBeTruthy();
    expect(screen.getByText('Assigned to: Unassigned')).toBeTruthy();
  });

  it('should show status icons', () => {
    render(<TaskList tasks={mockTasks} onTaskClick={vi.fn()} />);

    expect(screen.getAllByText('⏳').length).toBeGreaterThan(0); // pending
    expect(screen.getAllByText('🔄').length).toBeGreaterThan(0); // in_progress
    expect(screen.getAllByText('✅').length).toBeGreaterThan(0); // completed
  });
});