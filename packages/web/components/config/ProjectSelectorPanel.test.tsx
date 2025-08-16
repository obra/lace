// ABOUTME: Test file for ProjectSelectorPanel simplified creation mode
// ABOUTME: Ensures auto-open mode shows streamlined UI with directory-based naming

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectSelectorPanel } from './ProjectSelectorPanel';
import { createMockResponse } from '@/test-utils/mock-fetch';
import {
  createMockProjectContext,
  createMockSessionContext,
} from '@/__tests__/utils/provider-mocks';

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

const mockProviders = [
  {
    name: 'anthropic',
    displayName: 'Anthropic',
    configured: true,
    requiresApiKey: true,
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        displayName: 'Claude Sonnet 4',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
    ],
  },
];

const mockHandlers = {
  onProjectSelect: vi.fn(),
  updateProject: vi.fn(),
  reloadProjects: vi.fn(),
  handleOnboardingComplete: vi.fn(),
  setAutoOpenCreateProject: vi.fn(),
  enableAgentAutoSelection: vi.fn(),
};

global.fetch = vi.fn();

describe('ProjectSelectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockResponse({ project: { id: '1', name: 'Test' } })
    );

    // Set up default mock returns
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

    mockUseSessionContext.mockReturnValue(
      createMockSessionContext({
        selectedSession: null,
        enableAgentAutoSelection: mockHandlers.enableAgentAutoSelection,
      })
    );

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
      providers: mockProviders,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('should show wizard and proceed to directory step in auto-open mode', async () => {
    // Override to enable auto-open mode
    mockUseUIState.mockReturnValue({
      showMobileNav: false,
      showDesktopSidebar: true,
      setShowMobileNav: vi.fn(),
      setShowDesktopSidebar: vi.fn(),
      toggleDesktopSidebar: vi.fn(),
      autoOpenCreateProject: true,
      setAutoOpenCreateProject: mockHandlers.setAutoOpenCreateProject,
      loading: false,
      setLoading: vi.fn(),
    });

    render(<ProjectSelectorPanel />);

    // In simplified onboarding flow, modal opens directly at directory step (step 2)
    expect(await screen.findByText('Create New Project')).toBeInTheDocument();
    expect(await screen.findByText('Set project directory')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/path/to/your/project')).toBeInTheDocument();

    // Should not show advanced options in simplified mode
    expect(screen.queryByText('Default Provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool Access Policies')).not.toBeInTheDocument();
  });

  it('should auto-populate project name from directory', async () => {
    // Override to enable auto-open mode
    mockUseUIState.mockReturnValue({
      showMobileNav: false,
      showDesktopSidebar: true,
      setShowMobileNav: vi.fn(),
      setShowDesktopSidebar: vi.fn(),
      toggleDesktopSidebar: vi.fn(),
      autoOpenCreateProject: true,
      setAutoOpenCreateProject: mockHandlers.setAutoOpenCreateProject,
      loading: false,
      setLoading: vi.fn(),
    });

    render(<ProjectSelectorPanel />);

    // In simplified onboarding flow, modal opens directly at directory step
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
    // Override to enable auto-open mode
    mockUseUIState.mockReturnValue({
      showMobileNav: false,
      showDesktopSidebar: true,
      setShowMobileNav: vi.fn(),
      setShowDesktopSidebar: vi.fn(),
      toggleDesktopSidebar: vi.fn(),
      autoOpenCreateProject: true,
      setAutoOpenCreateProject: mockHandlers.setAutoOpenCreateProject,
      loading: false,
      setLoading: vi.fn(),
    });

    render(<ProjectSelectorPanel />);

    await waitFor(() => {
      expect(screen.getByText('Advanced setup')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Advanced setup'));

    await waitFor(() => {
      expect(screen.getByText('Default Provider')).toBeInTheDocument();
    });
  });
});
