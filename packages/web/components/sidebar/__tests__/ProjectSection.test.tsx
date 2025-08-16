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

// Import mocked hooks
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';

const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseSessionContext = vi.mocked(useSessionContext);
const mockUseAgentContext = vi.mocked(useAgentContext);

// Helper functions for consistent mocking
const createMockProjectContext = (overrides = {}) => ({
  selectedProject: 'test-project',
  foundProject: createMockProject(),
  currentProject: createMockProject(),
  projects: [createMockProject()],
  loading: false,
  error: null,
  projectsForSidebar: [createMockProject()],
  selectProject: vi.fn(),
  onProjectSelect: vi.fn(),
  updateProject: vi.fn(),
  reloadProjects: vi.fn(),
  ...overrides,
});

const createMockSessionContext = (overrides = {}) => ({
  sessions: [
    { id: 'session-1' as ThreadId, name: 'Session 1', createdAt: new Date(), agents: [] },
    { id: 'session-2' as ThreadId, name: 'Session 2', createdAt: new Date(), agents: [] },
    { id: 'session-3' as ThreadId, name: 'Session 3', createdAt: new Date(), agents: [] },
  ],
  loading: false,
  projectConfig: null,
  selectedSession: null,
  foundSession: null,
  selectSession: vi.fn(),
  onSessionSelect: vi.fn(),
  createSession: vi.fn(),
  loadProjectConfig: vi.fn(),
  reloadSessions: vi.fn(),
  enableAgentAutoSelection: vi.fn(),
  ...overrides,
});

const createMockAgentContext = (overrides = {}) => ({
  sessionDetails: createMockSessionDetails(),
  loading: false,
  selectedAgent: 'agent-1',
  foundAgent: createMockAgent('agent-1', 'Agent 1'),
  currentAgent: createMockAgent('agent-1', 'Agent 1'),
  agentBusy: false,
  selectAgent: vi.fn(),
  onAgentSelect: vi.fn(),
  createAgent: vi.fn(),
  updateAgentState: vi.fn(),
  reloadSessionDetails: vi.fn(),
  ...overrides,
});

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
    mockUseProjectContext.mockReturnValue(createMockProjectContext());
    mockUseSessionContext.mockReturnValue(createMockSessionContext());
    mockUseAgentContext.mockReturnValue(createMockAgentContext());
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

      mockUseProjectContext.mockReturnValue({
        selectedProject: 'test-project',
        foundProject: projectWithoutDescription,
        projects: [projectWithoutDescription],
        loading: false,
        error: null,
        projectsForSidebar: [projectWithoutDescription],
        selectProject: vi.fn(),
        onProjectSelect: vi.fn(),
        updateProject: vi.fn(),
        reloadProjects: vi.fn(),
        currentProject: createMockProject(),
      });

      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByText('Test Project')).toBeInTheDocument();
      expect(screen.queryByText('A test project for development')).not.toBeInTheDocument();
    });

    it('renders switch project button', () => {
      render(<ProjectSection {...defaultProps} />);

      const switchButton = screen.getByTestId('switch-project-button');
      expect(switchButton).toBeInTheDocument();
      expect(switchButton).toHaveAttribute('title', 'Switch project');
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
    it('calls onSwitchProject when switch project button is clicked', () => {
      render(<ProjectSection {...defaultProps} />);

      fireEvent.click(screen.getByTestId('switch-project-button'));

      expect(mockOnSwitchProject).toHaveBeenCalledTimes(1);
    });

    it('does not call onCloseMobileNav in desktop mode', () => {
      render(<ProjectSection {...defaultProps} isMobile={false} />);

      fireEvent.click(screen.getByTestId('switch-project-button'));

      expect(mockOnSwitchProject).toHaveBeenCalledTimes(1);
      expect(mockOnCloseMobileNav).not.toHaveBeenCalled();
    });

    it('calls onCloseMobileNav when switching project in mobile mode', () => {
      render(<ProjectSection {...defaultProps} isMobile={true} />);

      fireEvent.click(screen.getByTestId('switch-project-button'));

      expect(mockOnSwitchProject).toHaveBeenCalledTimes(1);
      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('works without onCloseMobileNav callback', () => {
      render(<ProjectSection {...defaultProps} isMobile={true} onCloseMobileNav={undefined} />);

      // Should not throw when clicking
      fireEvent.click(screen.getByTestId('switch-project-button'));
      expect(mockOnSwitchProject).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('handles very long project names with truncation', () => {
      const longNameProject = createMockProject({
        name: 'This is an extremely long project name that should be truncated in the UI to prevent layout issues',
      });

      mockUseProjectContext.mockReturnValue({
        selectedProject: 'test-project',
        foundProject: longNameProject,
        projects: [longNameProject],
        loading: false,
        error: null,
        projectsForSidebar: [longNameProject],
        selectProject: vi.fn(),
        onProjectSelect: vi.fn(),
        updateProject: vi.fn(),
        reloadProjects: vi.fn(),
        currentProject: createMockProject(),
      });

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

      mockUseProjectContext.mockReturnValue({
        selectedProject: 'test-project',
        foundProject: longDescProject,
        projects: [longDescProject],
        loading: false,
        error: null,
        projectsForSidebar: [longDescProject],
        selectProject: vi.fn(),
        onProjectSelect: vi.fn(),
        updateProject: vi.fn(),
        reloadProjects: vi.fn(),
        currentProject: createMockProject(),
      });

      render(<ProjectSection {...defaultProps} />);

      const descriptionElement = screen.getByText(longDescProject.description!);
      expect(descriptionElement).toHaveClass('truncate');
    });

    it('handles empty project name gracefully', () => {
      const emptyNameProject = createMockProject({ name: '' });

      mockUseProjectContext.mockReturnValue({
        selectedProject: 'test-project',
        foundProject: emptyNameProject,
        projects: [emptyNameProject],
        loading: false,
        error: null,
        projectsForSidebar: [emptyNameProject],
        selectProject: vi.fn(),
        onProjectSelect: vi.fn(),
        updateProject: vi.fn(),
        reloadProjects: vi.fn(),
        currentProject: createMockProject(),
      });

      render(<ProjectSection {...defaultProps} />);

      const projectNameElement = screen.getByTestId('current-project-name-desktop');
      expect(projectNameElement).toHaveTextContent('');
    });

    it('handles missing project id', () => {
      const projectWithoutId = createMockProject({ id: '' });

      mockUseProjectContext.mockReturnValue({
        selectedProject: '', // Empty project ID should still render if foundProject exists
        foundProject: projectWithoutId,
        projects: [projectWithoutId],
        loading: false,
        error: null,
        projectsForSidebar: [projectWithoutId],
        selectProject: vi.fn(),
        onProjectSelect: vi.fn(),
        updateProject: vi.fn(),
        reloadProjects: vi.fn(),
        currentProject: createMockProject(),
      });

      const { container } = render(<ProjectSection {...defaultProps} />);

      // Component should not render when selectedProject is empty
      expect(container.firstChild).toBeNull();
    });

    it('does not render when no project is selected', () => {
      mockUseProjectContext.mockReturnValue({
        selectedProject: null,
        foundProject: null,
        projects: [],
        loading: false,
        error: null,
        projectsForSidebar: [],
        selectProject: vi.fn(),
        onProjectSelect: vi.fn(),
        updateProject: vi.fn(),
        reloadProjects: vi.fn(),
        currentProject: createMockProject(),
      });

      const { container } = render(<ProjectSection {...defaultProps} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('has proper button title for switch project', () => {
      render(<ProjectSection {...defaultProps} />);

      const switchButton = screen.getByTestId('switch-project-button');
      expect(switchButton).toHaveAttribute('title', 'Switch project');
    });

    it('maintains proper heading hierarchy', () => {
      render(<ProjectSection {...defaultProps} />);

      const projectName = screen.getByTestId('current-project-name-desktop');
      expect(projectName.tagName).toBe('H3');
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
