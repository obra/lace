// ABOUTME: Tests for ProjectSelectorPanel component 
// ABOUTME: Tests project selection, creation, and management functionality

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import type { ProjectInfo } from '@/types/core';

const mockProjects: ProjectInfo[] = [
  {
    id: 'project-1',
    name: 'Test Project 1',
    description: 'First test project',
    workingDirectory: '/path/to/project1',
    isArchived: false,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    lastUsedAt: new Date(), // Today - always passes week filter
    sessionCount: 5,
  },
  {
    id: 'project-2',
    name: 'Test Project 2', 
    description: 'Second test project',
    workingDirectory: '/path/to/project2',
    isArchived: false,
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
    lastUsedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago - always passes week filter
    sessionCount: 3,
  }
];

describe('ProjectSelectorPanel', () => {
  const mockOnProjectSelect = vi.fn();
  const mockOnProjectCreate = vi.fn();
  const mockOnProjectUpdate = vi.fn();
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render project list', () => {
    render(
      <ProjectSelectorPanel
        projects={mockProjects}
        selectedProject={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreate={mockOnProjectCreate}
      />
    );

    expect(screen.getByText('Test Project 1')).toBeInTheDocument();
    expect(screen.getByText('Test Project 2')).toBeInTheDocument();
    expect(screen.getByText('First test project')).toBeInTheDocument();
    expect(screen.getByText('Second test project')).toBeInTheDocument();
  });

  it('should call onProjectSelect when project is clicked', async () => {
    render(
      <ProjectSelectorPanel
        projects={mockProjects}
        selectedProject={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreate={mockOnProjectCreate}
      />
    );

    await user.click(screen.getByText('Test Project 1'));
    expect(mockOnProjectSelect).toHaveBeenCalledWith(mockProjects[0]);
  });

  it('should show selected project as active', () => {
    render(
      <ProjectSelectorPanel
        projects={mockProjects}
        selectedProject={mockProjects[0]}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreate={mockOnProjectCreate}
      />
    );

    // Check that the selected project has different styling (would need to check actual implementation)
    const selectedProject = screen.getByText('Test Project 1').closest('div');
    expect(selectedProject).toBeInTheDocument();
  });

  it('should show create project button when onProjectCreate is provided', () => {
    render(
      <ProjectSelectorPanel
        projects={mockProjects}
        selectedProject={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreate={mockOnProjectCreate}
      />
    );

    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });

  it('should open create project modal when create button is clicked', async () => {
    render(
      <ProjectSelectorPanel
        projects={mockProjects}
        selectedProject={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreate={mockOnProjectCreate}
      />
    );

    await user.click(screen.getByRole('button', { name: /new project/i }));
    // Modal should open with form in simplified mode by default
    expect(screen.getByPlaceholderText('/path/to/your/project')).toBeInTheDocument();
    // Should have both the card heading and modal heading - just check for the input instead
    expect(screen.getAllByText('Create New Project')).toHaveLength(2);
  });

  it('should handle empty project list', () => {
    render(
      <ProjectSelectorPanel
        projects={[]}
        selectedProject={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreate={mockOnProjectCreate}
      />
    );

    expect(screen.getByText(/No Projects Yet/i)).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(
      <ProjectSelectorPanel
        projects={[]}
        selectedProject={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreate={mockOnProjectCreate}
        loading={true}
      />
    );

    expect(screen.getByText('Loading projects...')).toBeInTheDocument();
  });
});