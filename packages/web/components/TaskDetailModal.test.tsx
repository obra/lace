// ABOUTME: Unit tests for TaskDetailModal component
// ABOUTME: Tests task detail viewing, editing, and note functionality

import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskDetailModal } from '@/components/old/TaskDetailModal';
import type { Task } from '@/types/api';
import { asThreadId, type ThreadId } from '@/lib/server/core-types';

const mockTask: Task = {
  id: 'task_20240101_abc123',
  title: 'Test Task',
  description: 'Test description',
  prompt: 'Test prompt for agent',
  status: 'pending',
  priority: 'high',
  assignedTo: asThreadId('lace_20240101_agent1'),
  createdBy: asThreadId('lace_20240101_human'),
  threadId: asThreadId('lace_20240101_session'),
  createdAt: '2024-01-01T10:00:00Z',
  updatedAt: '2024-01-01T10:00:00Z',
  notes: [
    {
      id: 'note_20240101_n1',
      author: asThreadId('lace_20240101_agent1'),
      content: 'Working on this task',
      timestamp: '2024-01-01T11:00:00Z',
    },
  ],
};

describe('TaskDetailModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('should render task details when open', () => {
    render(
      <TaskDetailModal
        task={mockTask}
        isOpen={true}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onAddNote={vi.fn()}
      />
    );

    expect(screen.getByText('Task Details')).toBeTruthy();
    expect(screen.getByText('Test Task')).toBeTruthy();
    expect(screen.getByText('Test description')).toBeTruthy();
    expect(screen.getByText('Test prompt for agent')).toBeTruthy();
    expect(screen.getByText('HIGH')).toBeTruthy();
    expect(screen.getByText('PENDING')).toBeTruthy();
  });

  it('should not render when closed', () => {
    const { container } = render(
      <TaskDetailModal
        task={mockTask}
        isOpen={false}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onAddNote={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should close modal when close button clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <TaskDetailModal
        task={mockTask}
        isOpen={true}
        onClose={onClose}
        onUpdate={vi.fn()}
        onAddNote={vi.fn()}
      />
    );

    const modal = container.querySelector('.fixed.inset-0');
    const closeButton = modal?.querySelector('[aria-label="Close"]');
    if (closeButton) {
      fireEvent.click(closeButton);
    }

    expect(onClose).toHaveBeenCalled();
  });

  it('should enter edit mode when edit button clicked', () => {
    render(
      <TaskDetailModal
        task={mockTask}
        isOpen={true}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onAddNote={vi.fn()}
      />
    );

    // Find all buttons and filter for the Edit button
    const buttons = screen.getAllByRole('button');
    const editButton = buttons.find((btn) => btn.textContent === 'Edit');
    if (editButton) {
      fireEvent.click(editButton);
    }

    expect(screen.getByText('Edit Task')).toBeTruthy();
    expect(screen.getByDisplayValue('Test Task')).toBeTruthy();
    expect(screen.getByDisplayValue('Test description')).toBeTruthy();
    expect(screen.getByDisplayValue('Test prompt for agent')).toBeTruthy();
  });

  it('should save changes when save button clicked', async () => {
    const onUpdate = vi.fn();
    render(
      <TaskDetailModal
        task={mockTask}
        isOpen={true}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onAddNote={vi.fn()}
      />
    );

    // Enter edit mode
    fireEvent.click(screen.getByText('Edit'));

    // Change title
    const titleInput = screen.getByDisplayValue('Test Task');
    fireEvent.change(titleInput, { target: { value: 'Updated Task' } });

    // Save
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('task_20240101_abc123', {
        title: 'Updated Task',
        description: 'Test description',
        prompt: 'Test prompt for agent',
        priority: 'high',
        assignedTo: asThreadId('lace_20240101_agent1'),
        status: 'pending',
      });
    });
  });

  it('should cancel edit mode', () => {
    render(
      <TaskDetailModal
        task={mockTask}
        isOpen={true}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onAddNote={vi.fn()}
      />
    );

    // Enter edit mode
    fireEvent.click(screen.getByText('Edit'));

    // Change title
    const titleInput = screen.getByDisplayValue('Test Task');
    fireEvent.change(titleInput, { target: { value: 'Changed Task' } });

    // Cancel
    fireEvent.click(screen.getByText('Cancel'));

    // Should be back in view mode with original title
    expect(screen.getByText('Task Details')).toBeTruthy();
    expect(screen.getByText('Test Task')).toBeTruthy();
  });

  it('should display notes', () => {
    render(
      <TaskDetailModal
        task={mockTask}
        isOpen={true}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onAddNote={vi.fn()}
      />
    );

    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.getByText('Working on this task')).toBeTruthy();
  });

  it('should add a note', async () => {
    const onAddNote = vi.fn();
    render(
      <TaskDetailModal
        task={mockTask}
        isOpen={true}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onAddNote={onAddNote}
      />
    );

    const textarea = screen.getByPlaceholderText('Add a note...');
    fireEvent.change(textarea, { target: { value: 'New note content' } });

    const addButton = screen.getByText('Add Note');
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(onAddNote).toHaveBeenCalledWith('task_20240101_abc123', 'New note content');
    });
  });

  it('should remove task when delete button clicked', () => {
    const onDelete = vi.fn();
    render(
      <TaskDetailModal
        task={mockTask}
        isOpen={true}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onAddNote={vi.fn()}
        onDelete={onDelete}
      />
    );

    const deleteButton = screen.getByText('Delete Task');
    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledWith('task_20240101_abc123');
  });
});
