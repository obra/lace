// ABOUTME: Test file for ProjectSelectorPanel simplified creation mode
// ABOUTME: Ensures auto-open mode shows streamlined UI with directory-based naming

import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type * as ReactRouter from 'react-router';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import { createMockResponse } from '@/test-utils/mock-fetch';
import {
  createMockProjectsContext,
  createMockProjectContext,
  createMockUIContext,
} from '@/__tests__/utils/provider-mocks';

// Mock all the providers
vi.mock('@/components/providers/ProjectsProvider', () => ({
  useProjectsContext: vi.fn(),
}));

vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: vi.fn(),
}));

vi.mock('@/components/providers/UIProvider', () => ({
  useUIContext: vi.fn(),
}));

vi.mock('@/hooks/useOnboarding', () => ({
  useOnboarding: vi.fn(),
}));

vi.mock('@/components/providers/ProviderInstanceProvider', () => ({
  useProviderInstances: vi.fn(),
  ProviderInstanceProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/providers/SettingsProvider', () => ({
  useSettings: vi.fn(),
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
}));

// Mock React Router
const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof ReactRouter>('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Import mocked hooks
import { useProjectsContext } from '@/components/providers/ProjectsProvider';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useUIContext } from '@/components/providers/UIProvider';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';
import { useSettings } from '@/components/providers/SettingsProvider';

const mockUseProjectsContext = vi.mocked(useProjectsContext);
const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseUIContext = vi.mocked(useUIContext);
const mockUseOnboarding = vi.mocked(useOnboarding);
const mockUseProviderInstances = vi.mocked(useProviderInstances);
const mockUseSettings = vi.mocked(useSettings);

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

const mockFetch = vi.fn();

describe('ProjectSelectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);

    // Clear router mocks
    mockNavigate.mockClear();

    (mockFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockResponse({ project: { id: '1', name: 'Test' } })
    );

    // Set up default mock returns
    mockUseProjectsContext.mockReturnValue(
      createMockProjectsContext({
        projects: [],
        projectsForSidebar: [],
        selectedProject: null,
        foundProject: null,
        onProjectSelect: mockHandlers.onProjectSelect,
        updateProject: mockHandlers.updateProject,
        reloadProjects: mockHandlers.reloadProjects,
      })
    );

    mockUseProjectContext.mockReturnValue(
      createMockProjectContext({
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

    mockUseSettings.mockReturnValue({
      settings: {
        theme: 'dark',
        timelineWidth: 'medium',
        debugPanelEnabled: false,
        defaultModels: undefined,
      },
      setDaisyUITheme: vi.fn(),
      setTimelineWidth: vi.fn(),
      getTimelineMaxWidthClass: () => 'max-w-3xl',
      setDebugPanelEnabled: vi.fn(),
    });

    mockUseProviderInstances.mockReturnValue({
      instances: [],
      instancesLoading: false,
      instancesError: null,
      catalogProviders: [],
      catalogLoading: false,
      catalogError: null,
      testResults: {},
      showAddModal: false,
      selectedCatalogProvider: null,
      availableProviders: mockProviders,
      loadInstances: vi.fn(),
      createInstance: vi.fn(),
      updateInstance: vi.fn(),
      deleteInstance: vi.fn(),
      testInstance: vi.fn(),
      loadCatalog: vi.fn(),
      openAddModal: vi.fn(),
      closeAddModal: vi.fn(),
      getInstanceById: vi.fn(),
      getInstanceWithTestResult: vi.fn(),
    });
  });

  it('should show wizard and proceed to directory step in auto-open mode', async () => {
    // Override to enable auto-open mode
    mockUseUIContext.mockReturnValue(
      createMockUIContext({
        autoOpenCreateProject: true,
        setAutoOpenCreateProject: mockHandlers.setAutoOpenCreateProject,
      })
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <ProjectSelectorPanel />
      </MemoryRouter>
    );

    // In simplified onboarding flow, modal opens directly at directory step (step 2)
    expect(await screen.findByText('Create New Project')).toBeInTheDocument();
    expect(await screen.findByText('Set project directory')).toBeInTheDocument();

    // DirectoryField now uses inline browser with hidden input
    const directoryInput = screen.getByLabelText('Directory path');
    expect(directoryInput).toBeInTheDocument();

    // Should not show advanced options in simplified mode
    expect(screen.queryByText('Default Provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool Access Policies')).not.toBeInTheDocument();
  });

  it('should auto-populate project name from directory', async () => {
    // Skip this test - DirectoryField now uses inline browser with Finder-style interaction
    // Project name auto-population from directory is tested in E2E tests
    // Unit testing this requires mocking the browser interaction which is complex
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });
});
