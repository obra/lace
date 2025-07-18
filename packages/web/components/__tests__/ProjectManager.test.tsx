// ABOUTME: Unit tests for ProjectManager component
// ABOUTME: Tests project listing, creation, and management functionality

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectManager } from '@/components/ProjectManager';
import { useProjectAPI } from '@/hooks/useProjectAPI';
import type { ProjectInfo } from '@/types/api';

// Mock the useProjectAPI hook
vi.mock('@/hooks/useProjectAPI');

const mockProjects: ProjectInfo[] = [
  {
    id: 'project-1',
    name: 'Test Project 1',
    description: 'A test project',
    workingDirectory: '/test/path1',
    isArchived: false,
    createdAt: new Date('2024-01-01'),
    lastUsedAt: new Date('2024-01-01'),
    sessionCount: 2,
  },
  {
    id: 'project-2',
    name: 'Test Project 2',
    description: 'Another test project',
    workingDirectory: '/test/path2',
    isArchived: true,
    createdAt: new Date('2024-01-02'),
    lastUsedAt: new Date('2024-01-02'),
    sessionCount: 0,
  },
];

const mockUseProjectAPI = {
  listProjects: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  loading: false,
  error: null,
};

describe('ProjectManager', () => {
  const mockOnProjectSelect = vi.fn();
  const mockOnProjectCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    const mockedHook = useProjectAPI as vi.MockedFunction<typeof useProjectAPI>;
    mockedHook.mockReturnValue(mockUseProjectAPI as ReturnType<typeof useProjectAPI>);
    mockUseProjectAPI.listProjects.mockResolvedValue(mockProjects);
  });

  afterEach(() => {
    cleanup();
  });

  it('should render project list', async () => {
    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeTruthy();
    });

    expect(screen.getByText('Test Project 1')).toBeTruthy();
    expect(screen.getByText('A test project')).toBeTruthy();
    expect(screen.getByText('2 sessions • Created 12/31/2023')).toBeTruthy();
  });

  it('should not show archived projects by default', async () => {
    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeTruthy();
    });

    expect(screen.getByText('Test Project 1')).toBeTruthy();
    expect(screen.queryByText('Test Project 2')).toBeNull();
  });

  it('should show archived projects when toggled', async () => {
    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Show Archived'));

    await waitFor(() => {
      expect(screen.getByText('Test Project 2')).toBeTruthy();
    });

    expect(screen.getByText('Test Project 2')).toBeTruthy();
    expect(screen.getByText('Archived')).toBeTruthy();
  });

  it('should handle project selection', async () => {
    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Test Project 1'));

    expect(mockOnProjectSelect).toHaveBeenCalledWith('project-1');
  });

  it('should open create project modal', async () => {
    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    fireEvent.click(screen.getByText('New Project'));

    expect(screen.getByText('Create New Project')).toBeTruthy();
  });

  it('should handle project deletion', async () => {
    mockUseProjectAPI.deleteProject.mockResolvedValue(true);
    
    // Mock window.confirm
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText('Delete')[0]);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockUseProjectAPI.deleteProject).toHaveBeenCalledWith('project-1');
    });

    confirmSpy.mockRestore();
  });

  it('should handle project archiving', async () => {
    mockUseProjectAPI.updateProject.mockResolvedValue({
      ...mockProjects[0],
      isArchived: true,
    });

    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Test Project 1')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText('Archive')[0]);

    await waitFor(() => {
      expect(mockUseProjectAPI.updateProject).toHaveBeenCalledWith('project-1', { isArchived: true });
    });
  });

  it('should show loading state', () => {
    const mockedHook = useProjectAPI as vi.MockedFunction<typeof useProjectAPI>;
    mockedHook.mockReturnValue({
      ...mockUseProjectAPI,
      loading: true,
    } as ReturnType<typeof useProjectAPI>);

    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    expect(screen.getByText('Loading projects...')).toBeTruthy();
  });

  it('should show error state', () => {
    const mockedHook = useProjectAPI as vi.MockedFunction<typeof useProjectAPI>;
    mockedHook.mockReturnValue({
      ...mockUseProjectAPI,
      error: 'Failed to load projects',
    } as ReturnType<typeof useProjectAPI>);

    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    expect(screen.getByText('Failed to load projects')).toBeTruthy();
  });
});