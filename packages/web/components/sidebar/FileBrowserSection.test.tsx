// ABOUTME: Tests for FileBrowserSection component
// ABOUTME: Tests sidebar integration, search functionality, file selection, and modal interactions

// Mock child components
vi.mock('@/components/files/SessionFileTree', () => ({
  SessionFileTree: vi.fn(({ onFileSelect, searchTerm }) => (
    <div data-testid="session-file-tree">
      <div>Search: {searchTerm}</div>
      <button onClick={() => onFileSelect('test.ts', 'test.ts')}>test.ts</button>
    </div>
  )),
}));

vi.mock('@/components/modals/FileViewerModal', () => ({
  FileViewerModal: vi.fn(({ isOpen, filePath, fileName, onClose }) =>
    isOpen ? (
      <div data-testid="file-viewer-modal">
        <div>
          Viewing: {fileName} ({filePath})
        </div>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}));

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileBrowserSection } from '@/components/sidebar/FileBrowserSection';

describe('FileBrowserSection', () => {
  const defaultProps = {
    sessionId: 'test-session-123',
  };

  it('should render file browser section', () => {
    render(<FileBrowserSection sessionId="test-session" />);

    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('should render file browser section with search and tree', () => {
    render(<FileBrowserSection {...defaultProps} />);

    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();
    expect(screen.getByTestId('session-file-tree')).toBeInTheDocument();
  });

  it('should update search term when typing in search input', async () => {
    render(<FileBrowserSection {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search files...');

    // Use fireEvent instead of userEvent to avoid timing issues
    fireEvent.change(searchInput, { target: { value: 'test' } });

    // Verify the input value changed
    expect(searchInput).toHaveValue('test');

    // Verify the search term was passed to SessionFileTree
    expect(screen.getByText('Search: test')).toBeInTheDocument();
  });

  it('should open file viewer modal when file is selected', async () => {
    render(<FileBrowserSection {...defaultProps} />);

    const fileButton = screen.getByText('test.ts');
    await userEvent.click(fileButton);

    expect(screen.getByTestId('file-viewer-modal')).toBeInTheDocument();
    expect(screen.getByText('Viewing: test.ts (test.ts)')).toBeInTheDocument();
  });

  it('should close file viewer modal when close button is clicked', async () => {
    render(<FileBrowserSection {...defaultProps} />);

    // Open modal
    const fileButton = screen.getByText('test.ts');
    await userEvent.click(fileButton);

    expect(screen.getByTestId('file-viewer-modal')).toBeInTheDocument();

    // Close modal
    const closeButton = screen.getByText('Close');
    await userEvent.click(closeButton);

    expect(screen.queryByTestId('file-viewer-modal')).not.toBeInTheDocument();
  });

  it('should handle collapsible functionality', () => {
    render(<FileBrowserSection {...defaultProps} defaultCollapsed={false} />);

    // The actual toggle behavior is handled by SidebarSection component
    // This test verifies the component renders correctly
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('should render correctly when not collapsed', () => {
    render(<FileBrowserSection {...defaultProps} defaultCollapsed={false} />);

    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();
  });

  it('should handle collapsed state properly', () => {
    render(<FileBrowserSection {...defaultProps} defaultCollapsed={true} />);

    expect(screen.getByText('Files')).toBeInTheDocument();
    // The SidebarSection handles the collapsed state internally
    // This test verifies the component renders with the collapsed prop
  });
});
