// ABOUTME: Unit tests for ProjectSection component with provider-based architecture
// ABOUTME: Tests project display, stats, mobile/desktop behaviors, and switch project functionality with providers

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectSection } from '@/components/sidebar/ProjectSection';
import type { SessionInfo, ThreadId, AgentInfo, ProjectInfo } from '@/types/core';
import {
  createMockSessionContext,
  createMockAgentContext,
  createMockProjectContext,
} from '@/__tests__/utils/provider-mocks';

// Mock the providers
vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: vi.fn(),
}));

vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: vi.fn(),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: vi.fn(),
}));

vi.mock('@/hooks/useProviders', () => ({
  useProviders: vi.fn(),
}));

vi.mock('@/hooks/useURLState', () => ({
  useURLState: vi.fn(),
}));

vi.mock('@/components/config/ProjectEditModal', () => ({
  ProjectEditModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="project-edit-modal">Project Edit Modal</div> : null,
}));

// Import mocked hooks
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useProviders } from '@/hooks/useProviders';
import { useURLState } from '@/hooks/useURLState';

const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseSessionContext = vi.mocked(useSessionContext);
const mockUseAgentContext = vi.mocked(useAgentContext);
const mockUseProviders = vi.mocked(useProviders);
const mockUseURLState = vi.mocked(useURLState);

// Helper functions for test data
const createMockSessionsForProject = () => [
  { id: 'session-1' as ThreadId, name: 'Session 1', createdAt: new Date(), agents: [] },
  { id: 'session-2' as ThreadId, name: 'Session 2', createdAt: new Date(), agents: [] },
  { id: 'session-3' as ThreadId, name: 'Session 3', createdAt: new Date(), agents: [] },
];

// Test data factories
const createMockProject = (overrides?: Partial<ProjectInfo>): ProjectInfo => ({
  id: 'test-project',
  name: 'Test Project',
  description: 'A test project for development',
  workingDirectory: '/test/path',
  createdAt: new Date(),
  lastUsedAt: new Date(),
  sessionCount: 0,
  isArchived: false,
  ...overrides,
});

const createMockAgent = (id: string, name: string): AgentInfo => ({
  threadId: id as ThreadId,
  name,
  providerInstanceId: 'test-provider',
  modelId: 'test-model',
  status: 'idle',
});

const createMockSessionDetails = (agentCount = 2): SessionInfo => ({
  id: 'test-session' as ThreadId,
  name: 'Test Session',
  createdAt: new Date(),
  agents: Array.from({ length: agentCount }, (_, i) =>
    createMockAgent(`agent-${i + 1}`, `Agent ${i + 1}`)
  ),
});

describe('ProjectSection', () => {
  const mockOnSwitchProject = vi.fn();
  const mockOnCloseMobileNav = vi.fn();

  const defaultProps = {
    onSwitchProject: mockOnSwitchProject,
    onCloseMobileNav: mockOnCloseMobileNav,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock returns using helpers
    mockUseProjectContext.mockReturnValue(
      createMockProjectContext({
        selectedProject: 'test-project',
        foundProject: createMockProject(),
        projects: [createMockProject()],
        projectsForSidebar: [createMockProject()],
        updateProject: vi.fn(),
        loadProjectConfiguration: vi.fn().mockResolvedValue({}),
      })
    );
    mockUseSessionContext.mockReturnValue(
      createMockSessionContext({
        sessions: createMockSessionsForProject(),
      })
    );
    mockUseAgentContext.mockReturnValue(
      createMockAgentContext({
        sessionDetails: createMockSessionDetails(),
        selectedAgent: 'agent-1' as ThreadId,
        foundAgent: createMockAgent('agent-1', 'Agent 1'),
        currentAgent: createMockAgent('agent-1', 'Agent 1'),
      })
    );
    mockUseProviders.mockReturnValue({
      providers: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseURLState.mockReturnValue({
      project: 'test-project',
      session: null,
      agent: null,
      navigateToProject: vi.fn(),
      navigateToSession: vi.fn(),
      navigateToAgent: vi.fn(),
      navigateToRoot: vi.fn(),
    });
  });

  describe('Basic Structure', () => {
    it('renders with workspace title and folder icon', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByText('Workspace')).toBeInTheDocument();
    });

    it('displays project name and description', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByText('Test Project')).toBeInTheDocument();
      expect(screen.getByText('A test project for development')).toBeInTheDocument();
    });

    it('displays project name without description when description is undefined', () => {
      const projectWithoutDescription = createMockProject({ description: undefined });

      mockUseProjectContext.mockReturnValue(
        createMockProjectContext({
          selectedProject: 'test-project',
          foundProject: projectWithoutDescription,
          projects: [projectWithoutDescription],
          projectsForSidebar: [projectWithoutDescription],
        })
      );

      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByText('Test Project')).toBeInTheDocument();
      expect(screen.queryByText('A test project for development')).not.toBeInTheDocument();
    });

    it('renders workspace settings button', () => {
      render(<ProjectSection {...defaultProps} />);

      const settingsButton = screen.getByTestId('workspace-settings-button');
      expect(settingsButton).toBeInTheDocument();
      expect(settingsButton).toHaveAttribute('title', 'Workspace settings');
    });
  });

  describe('Project Stats', () => {
    it('displays sessions count correctly for multiple sessions', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('sessions-count')).toHaveTextContent('3 sessions');
    });

    it('displays sessions count correctly for single session', () => {
      mockUseSessionContext.mockReturnValue(
        createMockSessionContext({
          sessions: [
            { id: 'session-1' as ThreadId, name: 'Session 1', createdAt: new Date(), agents: [] },
          ],
        })
      );

      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('sessions-count')).toHaveTextContent('1 session');
    });

    it('displays sessions count correctly for zero sessions', () => {
      mockUseSessionContext.mockReturnValue(
        createMockSessionContext({
          sessions: [],
        })
      );

      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('sessions-count')).toHaveTextContent('0 sessions');
    });

    it('displays agents count when session details provided', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('2 agents');
    });

    it('displays agents count correctly for single agent', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: createMockSessionDetails(1),
        })
      );

      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('1 agent');
    });

    it('displays agents count correctly for zero agents', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: createMockSessionDetails(0),
          selectedAgent: null,
          foundAgent: null,
        })
      );

      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('0 agents');
    });

    it('does not display agents count when no session details provided', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: null,
          selectedAgent: null,
          foundAgent: null,
        })
      );

      render(<ProjectSection {...defaultProps} />);

      expect(screen.queryByTestId('agents-count')).not.toBeInTheDocument();
    });

    it('handles empty agents in session details', () => {
      const sessionWithEmptyAgents = {
        ...createMockSessionDetails(),
        agents: [],
      };

      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: sessionWithEmptyAgents,
          selectedAgent: null,
          foundAgent: null,
        })
      );

      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('0 agents');
    });
  });

  describe('Mobile vs Desktop Test IDs', () => {
    it('uses mobile test ID when isMobile is true', () => {
      render(<ProjectSection {...defaultProps} isMobile={true} />);

      expect(screen.getByTestId('current-project-name')).toBeInTheDocument();
      expect(screen.queryByTestId('current-project-name-desktop')).not.toBeInTheDocument();
    });

    it('uses desktop test ID when isMobile is false', () => {
      render(<ProjectSection {...defaultProps} isMobile={false} />);

      expect(screen.getByTestId('current-project-name-desktop')).toBeInTheDocument();
      expect(screen.queryByTestId('current-project-name')).not.toBeInTheDocument();
    });

    it('defaults to desktop test ID when isMobile is not provided', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('current-project-name-desktop')).toBeInTheDocument();
    });
  });

  describe('Switch Project Functionality', () => {
    it('calls onSwitchProject when header navigation icon is clicked', () => {
      render(<ProjectSection {...defaultProps} />);

      fireEvent.click(screen.getByTestId('workspace-switch-header-button'));

      expect(mockOnSwitchProject).toHaveBeenCalledTimes(1);
    });

    it('does not call onCloseMobileNav in desktop mode', () => {
      render(<ProjectSection {...defaultProps} isMobile={false} />);

      fireEvent.click(screen.getByTestId('workspace-switch-header-button'));

      expect(mockOnSwitchProject).toHaveBeenCalledTimes(1);
      expect(mockOnCloseMobileNav).not.toHaveBeenCalled();
    });

    it('calls onCloseMobileNav when switching project in mobile mode', () => {
      render(<ProjectSection {...defaultProps} isMobile={true} />);

      fireEvent.click(screen.getByTestId('workspace-switch-header-button'));

      expect(mockOnSwitchProject).toHaveBeenCalledTimes(1);
      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('works without onCloseMobileNav callback', () => {
      render(<ProjectSection {...defaultProps} isMobile={true} onCloseMobileNav={undefined} />);

      // Should not throw when clicking
      fireEvent.click(screen.getByTestId('workspace-switch-header-button'));
      expect(mockOnSwitchProject).toHaveBeenCalledTimes(1);
    });

    it('calls navigateToProject when sessions count is clicked', () => {
      const mockNavigateToProject = vi.fn();
      mockUseURLState.mockReturnValue({
        project: 'test-project',
        session: null,
        agent: null,
        navigateToProject: mockNavigateToProject,
        navigateToSession: vi.fn(),
        navigateToAgent: vi.fn(),
        navigateToRoot: vi.fn(),
      });

      render(<ProjectSection {...defaultProps} />);

      fireEvent.click(screen.getByTestId('sessions-count'));

      expect(mockNavigateToProject).toHaveBeenCalledWith('test-project');
    });

    it('calls navigateToProject and onCloseMobileNav when sessions count is clicked in mobile mode', () => {
      const mockNavigateToProject = vi.fn();
      mockUseURLState.mockReturnValue({
        project: 'test-project',
        session: null,
        agent: null,
        navigateToProject: mockNavigateToProject,
        navigateToSession: vi.fn(),
        navigateToAgent: vi.fn(),
        navigateToRoot: vi.fn(),
      });

      render(<ProjectSection {...defaultProps} isMobile={true} />);

      fireEvent.click(screen.getByTestId('sessions-count'));

      expect(mockNavigateToProject).toHaveBeenCalledWith('test-project');
      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('handles very long project names with truncation', () => {
      const longNameProject = createMockProject({
        name: 'This is an extremely long project name that should be truncated in the UI to prevent layout issues',
      });

      mockUseProjectContext.mockReturnValue(
        createMockProjectContext({
          selectedProject: 'test-project',
          foundProject: longNameProject,
          projects: [longNameProject],
          projectsForSidebar: [longNameProject],
        })
      );

      render(<ProjectSection {...defaultProps} />);

      const projectNameElement = screen.getByTestId('current-project-name-desktop');
      expect(projectNameElement).toHaveClass('truncate');
      expect(projectNameElement).toHaveTextContent(longNameProject.name);
    });

    it('handles very long project descriptions with truncation', () => {
      const longDescProject = createMockProject({
        description:
          'This is an extremely long project description that should be truncated in the UI to prevent layout issues and maintain clean appearance',
      });

      mockUseProjectContext.mockReturnValue(
        createMockProjectContext({
          selectedProject: 'test-project',
          foundProject: longDescProject,
          projects: [longDescProject],
          projectsForSidebar: [longDescProject],
        })
      );

      render(<ProjectSection {...defaultProps} />);

      const descriptionElement = screen.getByText(longDescProject.description!);
      expect(descriptionElement).toHaveClass('truncate');
    });

    it('handles empty project name gracefully', () => {
      const emptyNameProject = createMockProject({ name: '' });

      mockUseProjectContext.mockReturnValue(
        createMockProjectContext({
          selectedProject: 'test-project',
          foundProject: emptyNameProject,
          projects: [emptyNameProject],
          projectsForSidebar: [emptyNameProject],
        })
      );

      render(<ProjectSection {...defaultProps} />);

      const projectNameElement = screen.getByTestId('current-project-name-desktop');
      expect(projectNameElement).toHaveTextContent('');
    });

    it('handles missing project id', () => {
      const projectWithoutId = createMockProject({ id: '' });

      mockUseProjectContext.mockReturnValue(
        createMockProjectContext({
          selectedProject: '', // Empty project ID should still render if foundProject exists
          foundProject: projectWithoutId,
          projects: [projectWithoutId],
          projectsForSidebar: [projectWithoutId],
        })
      );

      const { container } = render(<ProjectSection {...defaultProps} />);

      // Component should not render when selectedProject is empty
      expect(container.firstChild).toBeNull();
    });

    it('does not render when no project is selected', () => {
      mockUseProjectContext.mockReturnValue(
        createMockProjectContext({
          selectedProject: null,
          foundProject: null,
          projects: [],
          projectsForSidebar: [],
        })
      );

      const { container } = render(<ProjectSection {...defaultProps} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('has proper button title for workspace settings', () => {
      render(<ProjectSection {...defaultProps} />);

      const settingsButton = screen.getByTestId('workspace-settings-button');
      expect(settingsButton).toHaveAttribute('title', 'Workspace settings');
    });

    it('maintains proper heading hierarchy', () => {
      render(<ProjectSection {...defaultProps} />);

      const projectName = screen.getByTestId('current-project-name-desktop');
      expect(projectName.tagName).toBe('H3');
    });
  });

  describe('Workspace Navigation', () => {
    it('renders stacked navigation arrows as single icon in header that opens project selector', () => {
      render(<ProjectSection {...defaultProps} />);

      // Single stacked navigation icon should be present and clickable
      const switchButton = screen.getByTestId('workspace-switch-header-button');

      expect(switchButton).toBeInTheDocument();
      expect(switchButton).toHaveAttribute('title', 'Switch workspace');
      expect(switchButton).not.toBeDisabled();
    });

    it('workspace settings button opens the project edit modal', () => {
      render(<ProjectSection {...defaultProps} />);

      const settingsButton = screen.getByTestId('workspace-settings-button');

      // Modal should not be visible initially
      expect(screen.queryByTestId('project-edit-modal')).not.toBeInTheDocument();

      // Click settings button
      fireEvent.click(settingsButton);

      // Modal should now be visible
      expect(screen.getByTestId('project-edit-modal')).toBeInTheDocument();
    });
  });

  describe('Provider Integration', () => {
    it('uses ProjectProvider for project state', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(mockUseProjectContext).toHaveBeenCalled();
    });

    it('uses SessionProvider for session count', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(mockUseSessionContext).toHaveBeenCalled();
    });

    it('uses AgentProvider for agent count', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(mockUseAgentContext).toHaveBeenCalled();
    });
  });
});
