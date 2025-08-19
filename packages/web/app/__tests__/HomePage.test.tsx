// ABOUTME: Unit tests for HomePage component onboarding and project selection
// ABOUTME: Tests project selection flow and onboarding logic (migrated from LaceApp integration tests)

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HomePage } from '@/app/HomePage';

// Mock the providers
vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: vi.fn(),
}));

vi.mock('@/components/providers/UIProvider', () => ({
  useUIContext: () => ({
    autoOpenCreateProject: false,
    setAutoOpenCreateProject: vi.fn(),
  }),
}));

vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: () => ({
    enableAgentAutoSelection: vi.fn(),
  }),
}));

vi.mock('@/hooks/useOnboarding', () => ({
  useOnboarding: () => ({
    handleAutoOpenProjectCreation: vi.fn(),
  }),
}));

// Mock child components
vi.mock('@/components/config/ProjectSelectorPanel', () => ({
  ProjectSelectorPanel: () => (
    <div data-testid="project-selector-panel">Project Selector Panel</div>
  ),
}));

vi.mock('@/components/onboarding/FirstProjectHero', () => ({
  FirstProjectHero: ({ onCreateFirstProject }: { onCreateFirstProject: () => void }) => (
    <div data-testid="first-project-hero">
      <button data-testid="create-first-project" onClick={onCreateFirstProject}>
        Create First Project
      </button>
    </div>
  ),
}));

vi.mock('@/components/pages/views/LoadingView', () => ({
  LoadingView: () => <div data-testid="loading-view">Loading...</div>,
}));

import { useProjectContext } from '@/components/providers/ProjectProvider';

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should show loading view while projects are loading', async () => {
    vi.mocked(useProjectContext).mockReturnValue({
      projects: [],
      loading: true,
      error: null,
      selectedProject: null,
      foundProject: null,
      currentProject: {
        id: '',
        name: 'No project selected',
        description: 'Select a project to get started',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      },
      projectsForSidebar: [],
      selectProject: vi.fn(),
      onProjectSelect: vi.fn(),
      updateProject: vi.fn(),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: vi.fn(),
    });

    render(<HomePage />);

    expect(screen.getByTestId('loading-view')).toBeInTheDocument();
  });

  it('should show FirstProjectHero when no projects exist', async () => {
    vi.mocked(useProjectContext).mockReturnValue({
      projects: [],
      loading: false,
      error: null,
      selectedProject: null,
      foundProject: null,
      currentProject: {
        id: '',
        name: 'No project selected',
        description: 'Select a project to get started',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      },
      projectsForSidebar: [],
      selectProject: vi.fn(),
      onProjectSelect: vi.fn(),
      updateProject: vi.fn(),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: vi.fn(),
    });

    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByTestId('first-project-hero')).toBeInTheDocument();
    });
  });

  it('should show ProjectSelectorPanel when projects exist', async () => {
    const mockProject = {
      id: 'test-project',
      name: 'Test Project',
      description: 'Test project description',
      workingDirectory: '/test',
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      sessionCount: 1,
    };

    vi.mocked(useProjectContext).mockReturnValue({
      projects: [mockProject],
      loading: false,
      error: null,
      selectedProject: null,
      foundProject: null,
      currentProject: mockProject,
      projectsForSidebar: [mockProject],
      selectProject: vi.fn(),
      onProjectSelect: vi.fn(),
      updateProject: vi.fn(),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: vi.fn(),
    });

    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByTestId('project-selector-panel')).toBeInTheDocument();
    });
  });

  it('should show both FirstProjectHero and ProjectSelectorPanel when autoOpenCreateProject is true', async () => {
    const mockUIContext = {
      autoOpenCreateProject: true,
      setAutoOpenCreateProject: vi.fn(),
    };

    // Re-mock UIProvider for this test
    vi.doMock('@/components/providers/UIProvider', () => ({
      useUIContext: () => mockUIContext,
    }));

    // Re-import after mock
    const { HomePage: HomePageWithMock } = await import('../HomePage');

    const mockProject = {
      id: 'test-project',
      name: 'Test Project',
      description: 'Test project description',
      workingDirectory: '/test',
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      sessionCount: 1,
    };

    vi.mocked(useProjectContext).mockReturnValue({
      projects: [mockProject],
      loading: false,
      error: null,
      selectedProject: null,
      foundProject: null,
      currentProject: mockProject,
      projectsForSidebar: [mockProject],
      selectProject: vi.fn(),
      onProjectSelect: vi.fn(),
      updateProject: vi.fn(),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: vi.fn(),
    });

    render(<HomePageWithMock />);

    await waitFor(() => {
      expect(screen.getByTestId('project-selector-panel')).toBeInTheDocument();
    });
  });
});
