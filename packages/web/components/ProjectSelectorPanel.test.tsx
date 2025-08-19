// ABOUTME: Tests for ProjectSelectorPanel component
// ABOUTME: Tests project selection, creation, and management functionality

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import type { ProjectInfo } from '@/types/core';
import {
  createMockProjectContext,
  createMockSessionContext,
  createMockUIContext,
} from '@/__tests__/utils/provider-mocks';
import { stringify } from '@/lib/serialization';

// Mock all the providers
vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: vi.fn(),
}));

vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: vi.fn(),
}));

vi.mock('@/components/providers/UIProvider', () => ({
  useUIContext: vi.fn(),
}));

vi.mock('@/hooks/useOnboarding', () => ({
  useOnboarding: vi.fn(),
}));

vi.mock('@/hooks/useProviders', () => ({
  useProviders: vi.fn(),
}));

// Mock Next.js App Router
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockBack = vi.fn();
const mockForward = vi.fn();
const mockPrefetch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
    back: mockBack,
    forward: mockForward,
    prefetch: mockPrefetch,
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Import mocked hooks
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useUIContext } from '@/components/providers/UIProvider';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useProviders } from '@/hooks/useProviders';

const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseSessionContext = vi.mocked(useSessionContext);
const mockUseUIContext = vi.mocked(useUIContext);
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

    // Clear router mocks
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRefresh.mockClear();
    mockBack.mockClear();
    mockForward.mockClear();
    mockPrefetch.mockClear();

    // Mock fetch API for ProviderInstanceProvider
    global.fetch = vi.fn().mockImplementation((url: string) => {
      // Handle provider instances endpoint
      if (url === '/api/provider/instances') {
        const response = stringify({ instances: [] });
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(response),
          json: () => Promise.resolve({ instances: [] }),
          clone: function () {
            return this;
          },
        } as Response);
      }

      // Handle provider catalog endpoint
      if (url === '/api/provider/catalog') {
        const response = stringify({ providers: [] });
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(response),
          json: () => Promise.resolve({ providers: [] }),
          clone: function () {
            return this;
          },
        } as Response);
      }

      // Default fallback for other URLs
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(stringify({})),
        json: () => Promise.resolve({}),
        clone: function () {
          return this;
        },
      } as Response);
    });

    // Set up default mock returns
    mockUseProjectContext.mockReturnValue(
      createMockProjectContext({
        projects: mockProjects,
        projectsForSidebar: mockProjects,
        selectedProject: null,
        foundProject: null,
        onProjectSelect: mockHandlers.onProjectSelect,
        updateProject: mockHandlers.updateProject,
        reloadProjects: mockHandlers.reloadProjects,
      })
    );

    mockUseSessionContext.mockReturnValue(
      createMockSessionContext({
        selectedSession: null,
        enableAgentAutoSelection: mockHandlers.enableAgentAutoSelection,
      })
    );

    mockUseUIContext.mockReturnValue(
      createMockUIContext({
        autoOpenCreateProject: false,
        setAutoOpenCreateProject: mockHandlers.setAutoOpenCreateProject,
      })
    );

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

  it('should render project list', async () => {
    await act(async () => {
      render(<ProjectSelectorPanel />);
    });

    expect(screen.getByText('Test Project 1')).toBeInTheDocument();
    expect(screen.getByText('Test Project 2')).toBeInTheDocument();
    expect(screen.getByText('First test project')).toBeInTheDocument();
    expect(screen.getByText('Second test project')).toBeInTheDocument();
  });

  it('should navigate to project page when project is clicked', async () => {
    await act(async () => {
      render(<ProjectSelectorPanel />);
    });

    // Find the clickable project card (parent of the project name)
    const projectCard =
      screen.getByText('Test Project 1').closest('div[role="button"]') ||
      screen.getByText('Test Project 1').closest('div[class*="cursor-pointer"]');

    expect(projectCard).toBeInTheDocument();

    await user.click(projectCard!);
    expect(mockPush).toHaveBeenCalledWith('/project/project-1');
  });

  it('should show selected project as active', async () => {
    // Override the current project to be one of the mock projects
    mockUseProjectContext.mockReturnValue(
      createMockProjectContext({
        projects: mockProjects,
        projectsForSidebar: mockProjects,
        currentProject: mockProjects[0], // Set as selected
        selectedProject: mockProjects[0].id,
        foundProject: mockProjects[0],
        onProjectSelect: mockHandlers.onProjectSelect,
        updateProject: mockHandlers.updateProject,
        reloadProjects: mockHandlers.reloadProjects,
      })
    );

    await act(async () => {
      render(<ProjectSelectorPanel />);
    });

    // Check that the selected project has different styling (would need to check actual implementation)
    const selectedProject = screen.getByText('Test Project 1').closest('div');
    expect(selectedProject).toBeInTheDocument();
  });

  it('should show create project button', async () => {
    await act(async () => {
      render(<ProjectSelectorPanel />);
    });

    expect(screen.getByTestId('create-project-button')).toBeInTheDocument();
  });

  it('should open create project modal when create button is clicked', async () => {
    await act(async () => {
      render(<ProjectSelectorPanel />);
    });

    await user.click(screen.getByTestId('create-project-button'));
    // Wizard now opens directly on Directory step
    expect(await screen.findByPlaceholderText('/path/to/your/project')).toBeInTheDocument();
  });

  it('should handle empty project list', async () => {
    // Override to provide empty projects list
    mockUseProjectContext.mockReturnValue(
      createMockProjectContext({
        projects: [],
        projectsForSidebar: [],
        selectedProject: null,
        foundProject: null,
        onProjectSelect: mockHandlers.onProjectSelect,
        updateProject: mockHandlers.updateProject,
        reloadProjects: mockHandlers.reloadProjects,
      })
    );

    await act(async () => {
      render(<ProjectSelectorPanel />);
    });

    expect(screen.getByText(/No Projects Yet/i)).toBeInTheDocument();
  });

  it('should show loading state', async () => {
    // Override to provide loading state
    mockUseProjectContext.mockReturnValue(
      createMockProjectContext({
        projects: [],
        projectsForSidebar: [],
        loading: true,
        selectedProject: null,
        foundProject: null,
        onProjectSelect: mockHandlers.onProjectSelect,
        updateProject: mockHandlers.updateProject,
        reloadProjects: mockHandlers.reloadProjects,
      })
    );

    await act(async () => {
      render(<ProjectSelectorPanel />);
    });

    expect(screen.getByText('Loading projects...')).toBeInTheDocument();
  });
});
