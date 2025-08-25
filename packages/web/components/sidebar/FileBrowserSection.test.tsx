// ABOUTME: Tests for FileBrowserSection component
// ABOUTME: Tests sidebar integration, search functionality, file selection, and modal interactions

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileBrowserSection } from './FileBrowserSection';

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

describe('FileBrowserSection', () => {
  const defaultProps = {
    sessionId: 'test-session-123',
    workingDirectory: '/home/user/project',
  };

  it('should not render when no working directory is provided', () => {
    render(<FileBrowserSection sessionId="test-session" workingDirectory="" />);

    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });

  it('should not render when working directory is undefined', () => {
    render(<FileBrowserSection sessionId="test-session" />);

    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });

  it('should render file browser section with search and tree', () => {
    render(<FileBrowserSection {...defaultProps} />);

    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();
    expect(screen.getByTestId('session-file-tree')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument(); // Working directory name
  });

  it('should update search term when typing in search input', async () => {
    render(<FileBrowserSection {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search files...');

    // Use fireEvent instead of userEvent to avoid timing issues
    fireEvent.change(searchInput, { target: { value: 'test' } });

    // Verify the input value changed
    expect(searchInput).toHaveValue('test');
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

  it('should show working directory name in header when not collapsed', () => {
    render(
      <FileBrowserSection
        {...defaultProps}
        workingDirectory="/very/long/path/to/project"
        defaultCollapsed={false}
      />
    );

    expect(screen.getByText('project')).toBeInTheDocument();
  });

  it('should handle collapsed state properly', () => {
    render(<FileBrowserSection {...defaultProps} defaultCollapsed={true} />);

    expect(screen.getByText('Files')).toBeInTheDocument();
    // The SidebarSection handles the collapsed state internally
    // This test verifies the component renders with the collapsed prop
  });
});
