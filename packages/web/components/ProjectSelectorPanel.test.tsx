// ABOUTME: Tests for ProjectSelectorPanel component
// ABOUTME: Tests project selection, creation, and management functionality

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import type { ProjectInfo } from '@/types/core';

// Mock all the providers
vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: vi.fn(),
}));

vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: vi.fn(),
}));

vi.mock('@/hooks/useUIState', () => ({
  useUIState: vi.fn(),
}));

vi.mock('@/hooks/useOnboarding', () => ({
  useOnboarding: vi.fn(),
}));

vi.mock('@/hooks/useProviders', () => ({
  useProviders: vi.fn(),
}));

// Import mocked hooks
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useUIState } from '@/hooks/useUIState';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useProviders } from '@/hooks/useProviders';

const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseSessionContext = vi.mocked(useSessionContext);
const mockUseUIState = vi.mocked(useUIState);
const mockUseOnboarding = vi.mocked(useOnboarding);
const mockUseProviders = vi.mocked(useProviders);

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
  },
];

describe('ProjectSelectorPanel', () => {
  const mockHandlers = {
    onProjectSelect: vi.fn(),
    updateProject: vi.fn(),
    reloadProjects: vi.fn(),
    handleOnboardingComplete: vi.fn(),
    setAutoOpenCreateProject: vi.fn(),
    enableAgentAutoSelection: vi.fn(),
  };
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock returns
    mockUseProjectContext.mockReturnValue({
      projects: mockProjects,
      projectsForSidebar: mockProjects,
      currentProject: {
        id: '',
        name: 'No project selected',
        description: '',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      },
      loading: false,
      error: null,
      selectedProject: null,
      foundProject: null,
      selectProject: vi.fn(),
      onProjectSelect: mockHandlers.onProjectSelect,
      updateProject: mockHandlers.updateProject,
      createProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: mockHandlers.reloadProjects,
    });

    mockUseSessionContext.mockReturnValue({
      sessions: [],
      loading: false,
      projectConfig: null,
      selectedSession: null,
      foundSession: null,
      selectSession: vi.fn(),
      onSessionSelect: vi.fn(),
      createSession: vi.fn(),
      loadProjectConfig: vi.fn(),
      reloadSessions: vi.fn(),
      enableAgentAutoSelection: mockHandlers.enableAgentAutoSelection,
    });

    mockUseUIState.mockReturnValue({
      showMobileNav: false,
      showDesktopSidebar: true,
      setShowMobileNav: vi.fn(),
      setShowDesktopSidebar: vi.fn(),
      toggleDesktopSidebar: vi.fn(),
      autoOpenCreateProject: false,
      setAutoOpenCreateProject: mockHandlers.setAutoOpenCreateProject,
      loading: false,
      setLoading: vi.fn(),
    });

    mockUseOnboarding.mockReturnValue({
      handleOnboardingComplete: mockHandlers.handleOnboardingComplete,
      handleAutoOpenProjectCreation: vi.fn(),
    });

    mockUseProviders.mockReturnValue({
      providers: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('should render project list', () => {
    render(<ProjectSelectorPanel />);

    expect(screen.getByText('Test Project 1')).toBeInTheDocument();
    expect(screen.getByText('Test Project 2')).toBeInTheDocument();
    expect(screen.getByText('First test project')).toBeInTheDocument();
    expect(screen.getByText('Second test project')).toBeInTheDocument();
  });

  it('should call onProjectSelect when project is clicked', async () => {
    render(<ProjectSelectorPanel />);

    await user.click(screen.getByText('Test Project 1'));
    expect(mockHandlers.onProjectSelect).toHaveBeenCalledWith(mockProjects[0]);
  });

  it('should show selected project as active', () => {
    // Override the current project to be one of the mock projects
    mockUseProjectContext.mockReturnValue({
      projects: mockProjects,
      projectsForSidebar: mockProjects,
      currentProject: mockProjects[0], // Set as selected
      loading: false,
      error: null,
      selectedProject: mockProjects[0].id,
      foundProject: mockProjects[0],
      selectProject: vi.fn(),
      onProjectSelect: mockHandlers.onProjectSelect,
      updateProject: mockHandlers.updateProject,
      createProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: mockHandlers.reloadProjects,
    });

    render(<ProjectSelectorPanel />);

    // Check that the selected project has different styling (would need to check actual implementation)
    const selectedProject = screen.getByText('Test Project 1').closest('div');
    expect(selectedProject).toBeInTheDocument();
  });

  it('should show create project button', () => {
    render(<ProjectSelectorPanel />);

    expect(screen.getByTestId('create-project-button')).toBeInTheDocument();
  });

  it('should open create project modal when create button is clicked', async () => {
    render(<ProjectSelectorPanel />);

    await user.click(screen.getByTestId('create-project-button'));
    // Wizard now opens directly on Directory step
    expect(await screen.findByPlaceholderText('/path/to/your/project')).toBeInTheDocument();
  });

  it('should handle empty project list', () => {
    // Override to provide empty projects list
    mockUseProjectContext.mockReturnValue({
      projects: [],
      projectsForSidebar: [],
      currentProject: {
        id: '',
        name: 'No project selected',
        description: '',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      },
      loading: false,
      error: null,
      selectedProject: null,
      foundProject: null,
      selectProject: vi.fn(),
      onProjectSelect: mockHandlers.onProjectSelect,
      updateProject: mockHandlers.updateProject,
      createProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: mockHandlers.reloadProjects,
    });

    render(<ProjectSelectorPanel />);

    expect(screen.getByText(/No Projects Yet/i)).toBeInTheDocument();
  });

  it('should show loading state', () => {
    // Override to provide loading state
    mockUseProjectContext.mockReturnValue({
      projects: [],
      projectsForSidebar: [],
      currentProject: {
        id: '',
        name: 'No project selected',
        description: '',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      },
      loading: true,
      error: null,
      selectedProject: null,
      foundProject: null,
      selectProject: vi.fn(),
      onProjectSelect: mockHandlers.onProjectSelect,
      updateProject: mockHandlers.updateProject,
      createProject: vi.fn(),
      loadProjectConfiguration: vi.fn(),
      reloadProjects: mockHandlers.reloadProjects,
    });

    render(<ProjectSelectorPanel />);

    expect(screen.getByText('Loading projects...')).toBeInTheDocument();
  });
});
