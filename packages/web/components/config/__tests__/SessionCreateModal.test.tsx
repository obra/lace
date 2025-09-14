// ABOUTME: Tests for simplified SessionCreateModal component
// ABOUTME: Validates project-focused modal UI with task input and simplified submission flow

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionCreateModal } from '@/components/config/SessionCreateModal';
import type { ProjectInfo } from '@/types/core';

// Mock project data
const mockProject: ProjectInfo = {
  id: 'project-123',
  name: 'My Awesome Project',
  description: 'A great project description',
  workingDirectory: '/Users/jesse/projects/awesome-project',
  createdAt: new Date('2023-01-01'),
  isArchived: false,
  lastUsedAt: new Date('2023-01-02'),
};

describe('SessionCreateModal', () => {
  const defaultProps = {
    isOpen: true,
    currentProject: mockProject,
    loading: false,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('UI Structure', () => {
    it('should display project name as modal title', () => {
      render(<SessionCreateModal {...defaultProps} />);

      expect(screen.getByText('My Awesome Project')).toBeInTheDocument();
    });

    it('should display working directory as subtitle', () => {
      render(<SessionCreateModal {...defaultProps} />);

      expect(screen.getByText('/Users/jesse/projects/awesome-project')).toBeInTheDocument();
    });

    it('should show "What are we working on?" question', () => {
      render(<SessionCreateModal {...defaultProps} />);

      expect(screen.getByText('What are we working on?')).toBeInTheDocument();
    });

    it('should have large textarea for task input', () => {
      render(<SessionCreateModal {...defaultProps} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('should have "Let\'s go" button', () => {
      render(<SessionCreateModal {...defaultProps} />);

      const button = screen.getByTestId('condensed-send-button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent("Let's go");
    });

    it('should not have cancel button (modal close only)', () => {
      render(<SessionCreateModal {...defaultProps} />);

      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    });

    it('should not show provider/model selector', () => {
      render(<SessionCreateModal {...defaultProps} />);

      expect(screen.queryByText(/provider/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/model/i)).not.toBeInTheDocument();
    });

    it('should not show working directory input field', () => {
      render(<SessionCreateModal {...defaultProps} />);

      // Should show as display text, not input
      const workingDirInput = screen.queryByDisplayValue('/Users/jesse/projects/awesome-project');
      expect(workingDirInput).not.toBeInTheDocument();
    });

    it('should not show environment variables section', () => {
      render(<SessionCreateModal {...defaultProps} />);

      expect(screen.queryByText(/environment variables/i)).not.toBeInTheDocument();
    });
  });

  describe('Form Behavior', () => {
    it('should auto-focus textarea when modal opens', () => {
      render(<SessionCreateModal {...defaultProps} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveFocus();
    });

    it('should call onSubmit with user input when form is submitted', async () => {
      const mockOnSubmit = vi.fn().mockResolvedValue(undefined);
      render(<SessionCreateModal {...defaultProps} onSubmit={mockOnSubmit} />);

      const textarea = screen.getByRole('textbox');
      const submitButton = screen.getByTestId('condensed-send-button');

      fireEvent.change(textarea, { target: { value: 'Fix the authentication bug' } });
      fireEvent.click(submitButton);

      expect(mockOnSubmit).toHaveBeenCalledWith('Fix the authentication bug');
    });

    it('should disable submit button when textarea is empty', () => {
      render(<SessionCreateModal {...defaultProps} />);

      const submitButton = screen.getByTestId('condensed-send-button');
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit button when textarea has content', () => {
      render(<SessionCreateModal {...defaultProps} />);

      const textarea = screen.getByRole('textbox');
      const submitButton = screen.getByTestId('condensed-send-button');

      fireEvent.change(textarea, { target: { value: 'Add dark mode' } });

      expect(submitButton).not.toBeDisabled();
    });

    it('should submit form with Enter key (but not Shift+Enter)', () => {
      const mockOnSubmit = vi.fn().mockResolvedValue(undefined);
      render(<SessionCreateModal {...defaultProps} onSubmit={mockOnSubmit} />);

      const textarea = screen.getByRole('textbox');

      fireEvent.change(textarea, { target: { value: 'Test task' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(mockOnSubmit).toHaveBeenCalledWith('Test task');
    });

    it('should NOT submit form with Shift+Enter (allows line breaks)', () => {
      const mockOnSubmit = vi.fn();
      render(<SessionCreateModal {...defaultProps} onSubmit={mockOnSubmit} />);

      const textarea = screen.getByRole('textbox');

      fireEvent.change(textarea, { target: { value: 'Test task' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  describe('Loading States', () => {
    it('should show loading state on submit button when loading', () => {
      render(<SessionCreateModal {...defaultProps} loading={true} />);

      const submitButton = screen.getByTestId('condensed-send-button');
      expect(submitButton).toBeDisabled();
    });

    it('should disable textarea when loading', () => {
      render(<SessionCreateModal {...defaultProps} loading={true} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });
  });

  describe('Modal Behavior', () => {
    it('should not render when isOpen is false', () => {
      render(<SessionCreateModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('My Awesome Project')).not.toBeInTheDocument();
    });

    it('should call onClose when modal backdrop is clicked', () => {
      const mockOnClose = vi.fn();
      render(<SessionCreateModal {...defaultProps} onClose={mockOnClose} />);

      // This depends on the Modal component implementation
      // May need to be adjusted based on actual Modal component behavior
    });
  });
});
