// ABOUTME: Test file for ProjectSelectorPanel simplified creation mode
// ABOUTME: Ensures auto-open mode shows streamlined UI with directory-based naming

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectSelectorPanel } from './ProjectSelectorPanel';
import { createMockResponse } from '@/test-utils/mock-fetch';

const mockProps = {
  projects: [],
  selectedProject: null,
  providers: [{
    name: 'anthropic',
    displayName: 'Anthropic',
    configured: true,
    requiresApiKey: true,
    models: [{ id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', contextWindow: 200000, maxOutputTokens: 8192 }]
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
    
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockResponse({ project: { id: '1', name: 'Test' } })
    );
  });

  it('should show wizard and proceed to directory step in auto-open mode', async () => {
    render(
      <ProjectSelectorPanel 
        {...mockProps} 
        autoOpenCreate={true}
        onAutoCreateHandled={vi.fn()}
      />
    );

    const welcomes = await screen.findAllByText('Welcome to Lace');
    expect(welcomes.length).toBeGreaterThan(0);

    // Step 1 -> Step 2
    await screen.findByRole('button', { name: 'Get started' });
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));

    expect(await screen.findByText('Choose your project directory')).toBeInTheDocument();
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

    // Move to directory step
    await screen.findByRole('button', { name: 'Get started' });
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('/path/to/your/project')).toBeInTheDocument();
    });

    const directoryInput = screen.getByPlaceholderText('/path/to/your/project');
    fireEvent.change(directoryInput, { target: { value: '/home/user/my-awesome-project' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('my-awesome-project')).toBeInTheDocument();
    });
  });

  it('should allow switching to advanced setup', async () => {
    render(
      <ProjectSelectorPanel 
        {...mockProps} 
        autoOpenCreate={true}
        onAutoCreateHandled={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Advanced setup')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Advanced setup'));

    await waitFor(() => {
      expect(screen.getByText('Default Provider')).toBeInTheDocument();
    });
  });
});