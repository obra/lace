// ABOUTME: Test file for ProjectSelectorPanel simplified creation mode
// ABOUTME: Ensures auto-open mode shows streamlined UI with directory-based naming

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectSelectorPanel } from './ProjectSelectorPanel';

const mockProps = {
  projects: [],
  selectedProject: null,
  providers: [{
    name: 'anthropic',
    displayName: 'Anthropic',
    configured: true,
    models: [{ id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' }]
  }],
  onProjectSelect: vi.fn(),
  onProjectCreate: vi.fn(),
  onProjectUpdate: vi.fn(),
  loading: false,
};

global.fetch = vi.fn();

describe('ProjectSelectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ project: { id: '1', name: 'Test' } }),
    });
  });

  it('should show simplified creation form in auto-open mode', async () => {
    render(
      <ProjectSelectorPanel 
        {...mockProps} 
        autoOpenCreate={true}
        onAutoCreateHandled={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Welcome to Lace')).toBeInTheDocument();
    });

    expect(screen.getByText('Choose your project directory')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/path/to/your/project')).toBeInTheDocument();
    
    // Should not show advanced options in simplified mode
    expect(screen.queryByText('Default Provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool Access Policies')).not.toBeInTheDocument();
  });

  it('should auto-populate project name from directory', async () => {
    render(
      <ProjectSelectorPanel 
        {...mockProps} 
        autoOpenCreate={true}
        onAutoCreateHandled={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('/path/to/your/project')).toBeInTheDocument();
    });

    const directoryInput = screen.getByPlaceholderText('/path/to/your/project');
    fireEvent.change(directoryInput, { target: { value: '/home/user/my-awesome-project' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('my-awesome-project')).toBeInTheDocument();
    });
  });

  it('should show advanced options toggle', async () => {
    render(
      <ProjectSelectorPanel 
        {...mockProps} 
        autoOpenCreate={true}
        onAutoCreateHandled={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Advanced Options')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Advanced Options'));

    await waitFor(() => {
      expect(screen.getByText('Default Provider')).toBeInTheDocument();
    });
  });
});