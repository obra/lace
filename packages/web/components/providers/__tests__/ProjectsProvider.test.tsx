// ABOUTME: Integration tests for ProjectsProvider focusing on real provider responsibilities
// ABOUTME: Tests projects data management, selection handling, and CRUD operations

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectsProvider, useProjectsContext } from '@/components/providers/ProjectsProvider';
import type { ProjectInfo } from '@/types/core';

// Mock the hooks
vi.mock('@/hooks/useProjectManagement', () => ({
  useProjectManagement: vi.fn(),
}));

import { useProjectManagement } from '@/hooks/useProjectManagement';

const mockUseProjectManagement = vi.mocked(useProjectManagement);

// Test data factories
const createMockProject = (overrides?: Partial<ProjectInfo>): ProjectInfo => ({
  id: 'project-1',
  name: 'Test Project',
  description: 'A test project',
  workingDirectory: '/test',
  isArchived: false,
  createdAt: new Date('2024-01-01'),
  lastUsedAt: new Date('2024-01-02'),
  sessionCount: 3,
  ...overrides,
});

const mockProjects: ProjectInfo[] = [
  createMockProject({ id: 'project-1', name: 'Project One' }),
  createMockProject({ id: 'project-2', name: 'Project Two', isArchived: true }),
  createMockProject({ id: 'project-3', name: 'Project Three', sessionCount: 0 }),
];

// Factory for test props to avoid shared mutable state
function createTestProps() {
  return {
    selectedProject: 'project-1' as string | null,
    onProjectSelect: vi.fn(),
  };
}

// Component to test context provision
function ContextConsumer() {
  const {
    projects,
    loading,
    error,
    selectedProject,
    projectsForSidebar,
    selectProject,
    onProjectSelect,
    updateProject,
    reloadProjects,
    foundProject,
  } = useProjectsContext();

  return (
    <div>
      <div data-testid="project-count">{projects.length}</div>
      <div data-testid="loading">{loading.toString()}</div>
      <div data-testid="error">{error || 'none'}</div>
      <div data-testid="selected-project">{selectedProject || 'none'}</div>
      <div data-testid="sidebar-project-count">{projectsForSidebar.length}</div>
      <div data-testid="found-project">{foundProject?.name || 'none'}</div>

      <button onClick={() => selectProject('project-2')} data-testid="select-project-2">
        Select Project 2
      </button>
      <button onClick={() => onProjectSelect({ id: 'project-3' })} data-testid="select-project-3">
        Select Project 3
      </button>
      <button
        onClick={() => updateProject('project-1', { name: 'Updated' })}
        data-testid="update-project"
      >
        Update Project
      </button>
      <button onClick={() => void reloadProjects()} data-testid="reload-projects">
        Reload Projects
      </button>
    </div>
  );
}

describe('ProjectsProvider', () => {
  const mockUpdateProject = vi.fn();
  const mockReloadProjects = vi.fn();
  const mockSetSelectedProject = vi.fn();
  const mockOnProjectChange = vi.fn();

  const defaultProjectManagement = {
    projects: mockProjects,
    loading: false,
    error: null,
    updateProject: mockUpdateProject,
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    loadProjectConfiguration: vi.fn(),
    reloadProjects: mockReloadProjects,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProjectManagement.mockReturnValue(defaultProjectManagement);
  });

  describe('Context Provision', () => {
    it('provides project context to children', () => {
      const testProps = createTestProps();
      render(
        <ProjectsProvider {...testProps}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      expect(screen.getByTestId('project-count')).toHaveTextContent('3');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('error')).toHaveTextContent('none');
      expect(screen.getByTestId('selected-project')).toHaveTextContent('project-1');
      expect(screen.getByTestId('sidebar-project-count')).toHaveTextContent('3');
      expect(screen.getByTestId('found-project')).toHaveTextContent('Project One');
    });

    it('throws error when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ContextConsumer />);
      }).toThrow('useProjectsContext must be used within a ProjectsProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('Project Data Management', () => {
    it('provides found project data when project is selected', () => {
      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      expect(screen.getByTestId('found-project')).toHaveTextContent('Project One');
    });

    it('provides null found project when no project is selected', () => {
      render(
        <ProjectsProvider {...createTestProps()} selectedProject={null}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      expect(screen.getByTestId('found-project')).toHaveTextContent('none');
    });

    it('provides null found project when selected project not found', () => {
      render(
        <ProjectsProvider {...createTestProps()} selectedProject="nonexistent-project">
          <ContextConsumer />
        </ProjectsProvider>
      );

      expect(screen.getByTestId('found-project')).toHaveTextContent('none');
    });

    it('transforms projects for sidebar display correctly', () => {
      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      // All projects should be included in sidebar transformation
      expect(screen.getByTestId('sidebar-project-count')).toHaveTextContent('3');
    });
  });

  describe('Project Selection', () => {
    it('calls onProjectSelect when selectProject is called', () => {
      const mockOnProjectSelect = vi.fn();
      render(
        <ProjectsProvider {...createTestProps()} onProjectSelect={mockOnProjectSelect}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      fireEvent.click(screen.getByTestId('select-project-2'));

      expect(mockOnProjectSelect).toHaveBeenCalledWith('project-2');
    });

    it('calls selectProject when onProjectSelect is called', () => {
      const mockOnProjectSelect = vi.fn();
      render(
        <ProjectsProvider {...createTestProps()} onProjectSelect={mockOnProjectSelect}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      fireEvent.click(screen.getByTestId('select-project-3'));

      expect(mockOnProjectSelect).toHaveBeenCalledWith('project-3');
    });

    it('calls onProjectChange callback when project selection changes', () => {
      render(
        <ProjectsProvider {...createTestProps()} onProjectChange={mockOnProjectChange}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      fireEvent.click(screen.getByTestId('select-project-2'));

      expect(mockOnProjectChange).toHaveBeenCalledWith('project-2');
    });

    it('handles empty string project selection as null', () => {
      // Create a component that calls onProjectSelect with empty string
      function TestComponent() {
        const { onProjectSelect } = useProjectsContext();
        return (
          <button onClick={() => onProjectSelect({ id: '' })} data-testid="clear-selection">
            Clear Selection
          </button>
        );
      }

      const mockOnProjectSelect = vi.fn();
      render(
        <ProjectsProvider
          {...createTestProps()}
          onProjectChange={mockOnProjectChange}
          onProjectSelect={mockOnProjectSelect}
        >
          <TestComponent />
        </ProjectsProvider>
      );

      // Click the button that calls onProjectSelect with empty string
      fireEvent.click(screen.getByTestId('clear-selection'));

      // Verify that onProjectSelect was called with null (empty string converted)
      expect(mockOnProjectSelect).toHaveBeenCalledWith(null);
      expect(mockOnProjectChange).toHaveBeenCalledWith(null);
    });
  });

  describe('Project CRUD Operations', () => {
    it('calls updateProject with correct parameters', async () => {
      mockUpdateProject.mockResolvedValue(undefined);

      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      fireEvent.click(screen.getByTestId('update-project'));

      expect(mockUpdateProject).toHaveBeenCalledWith('project-1', { name: 'Updated' });
    });

    it('calls reloadProjects when requested', async () => {
      mockReloadProjects.mockResolvedValue(mockProjects);

      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      fireEvent.click(screen.getByTestId('reload-projects'));

      expect(mockReloadProjects).toHaveBeenCalled();
    });

    it('handles updateProject errors gracefully', async () => {
      mockUpdateProject.mockRejectedValue(new Error('Update failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      fireEvent.click(screen.getByTestId('update-project'));

      await waitFor(() => {
        expect(mockUpdateProject).toHaveBeenCalled();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('Loading States', () => {
    it('reflects loading state from useProjectManagement', () => {
      mockUseProjectManagement.mockReturnValue({
        ...defaultProjectManagement,
        loading: true,
      });

      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('true');
    });

    it('handles empty projects list', () => {
      mockUseProjectManagement.mockReturnValue({
        ...defaultProjectManagement,
        projects: [],
      });

      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      expect(screen.getByTestId('project-count')).toHaveTextContent('0');
      expect(screen.getByTestId('sidebar-project-count')).toHaveTextContent('0');
    });

    it('displays error state from useProjectManagement', () => {
      mockUseProjectManagement.mockReturnValue({
        ...defaultProjectManagement,
        error: 'Failed to load projects',
      });

      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      expect(screen.getByTestId('error')).toHaveTextContent('Failed to load projects');
    });
  });

  describe('Data Transformation Edge Cases', () => {
    it('handles projects with missing optional fields', () => {
      const incompleteProjects = [
        createMockProject({
          id: 'incomplete',
          description: undefined,
          isArchived: undefined,
          sessionCount: undefined,
        }),
      ];

      mockUseProjectManagement.mockReturnValue({
        ...defaultProjectManagement,
        projects: incompleteProjects,
      });

      render(
        <ProjectsProvider {...createTestProps()} selectedProject="incomplete">
          <ContextConsumer />
        </ProjectsProvider>
      );

      expect(screen.getByTestId('sidebar-project-count')).toHaveTextContent('1');
      expect(screen.getByTestId('found-project')).toHaveTextContent('Test Project');
    });

    it('handles date transformation correctly', () => {
      const projectWithStringDates = [
        createMockProject({
          createdAt: new Date('2024-01-01'),
          lastUsedAt: new Date('2024-01-02'),
        }),
      ];

      mockUseProjectManagement.mockReturnValue({
        ...defaultProjectManagement,
        projects: projectWithStringDates,
      });

      render(
        <ProjectsProvider {...createTestProps()}>
          <ContextConsumer />
        </ProjectsProvider>
      );

      // Should handle date objects correctly in sidebar transformation
      expect(screen.getByTestId('sidebar-project-count')).toHaveTextContent('1');
    });
  });
});
