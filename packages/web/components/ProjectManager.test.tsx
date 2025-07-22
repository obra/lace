// ABOUTME: Integration tests for ProjectManager component
// ABOUTME: Tests project listing, creation, and management functionality with real project operations

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectManager } from '@/components/old/ProjectManager';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { Project } from '@/lib/server/lace-imports';
import type { ProjectInfo } from '@/types/api';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ProjectManager', () => {
  const tempContext = useTempLaceDir();
  const mockOnProjectSelect = vi.fn();
  const mockOnProjectCreated = vi.fn();
  let testProjects: ProjectInfo[];

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create some real test projects
    const project1 = Project.create(
      'Test Project 1',
      tempContext.tempDir,
      'A test project'
    );
    const project2 = Project.create(
      'Test Project 2', 
      tempContext.tempDir,
      'Another test project'
    );
    
    // Archive the second project
    project2.archive();
    
    testProjects = [
      {
        id: project1.getId(),
        name: 'Test Project 1',
        description: 'A test project',
        workingDirectory: tempContext.tempDir,
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      },
      {
        id: project2.getId(),
        name: 'Test Project 2',
        description: 'Another test project',
        workingDirectory: tempContext.tempDir,
        isArchived: true,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      },
    ];
    
    // Set up default fetch mock to return our test projects
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projects: testProjects }),
        });
      }
      return Promise.resolve({ ok: false });
    });
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

    await act(async () => {
      fireEvent.click(screen.getByText('Show Archived'));
    });

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

    await act(async () => {
      fireEvent.click(screen.getByText('Test Project 1'));
    });

    expect(mockOnProjectSelect).toHaveBeenCalledWith(testProjects[0].id);
  });

  it('should open create project modal', async () => {
    render(
      <ProjectManager
        selectedProjectId={null}
        onProjectSelect={mockOnProjectSelect}
        onProjectCreated={mockOnProjectCreated}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('New Project'));
    });

    expect(screen.getByText('Create New Project')).toBeTruthy();
  });

  it('should handle project deletion', async () => {
    // Mock window.confirm and fetch for delete operation
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/projects' && (!options || options.method !== 'DELETE')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projects: testProjects }),
        });
      }
      if (options?.method === 'DELETE') {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false });
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

    await act(async () => {
      fireEvent.click(screen.getAllByText('Delete')[0]);
    });

    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('should handle project archiving', async () => {
    // Mock fetch for update operation
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/projects' && (!options || options.method !== 'PUT')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projects: testProjects }),
        });
      }
      if (options?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...testProjects[0], isArchived: true }),
        });
      }
      return Promise.resolve({ ok: false });
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

    await act(async () => {
      fireEvent.click(screen.getAllByText('Archive')[0]);
    });

    // Verify the archive action was attempted (component uses PATCH method)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/projects/'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });

  it('should show loading state initially', async () => {
    // Mock a slow fetch to test loading state
    mockFetch.mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            ok: true,
            json: () => Promise.resolve({ projects: [] }),
          });
        }, 100);
      });
    });

    await act(async () => {
      render(
        <ProjectManager
          selectedProjectId={null}
          onProjectSelect={mockOnProjectSelect}
          onProjectCreated={mockOnProjectCreated}
        />
      );
    });

    // Should show loading initially when no projects are loaded yet
    expect(screen.getByText('Loading projects...')).toBeTruthy();
  });

  it('should show error state when API fails', async () => {
    // Mock fetch to return an error
    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });
    });

    await act(async () => {
      render(
        <ProjectManager
          selectedProjectId={null}
          onProjectSelect={mockOnProjectSelect}
          onProjectCreated={mockOnProjectCreated}
        />
      );
    });

    // Wait for error state to appear (the component shows the error message from the response)
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeTruthy();
    });
  });
});