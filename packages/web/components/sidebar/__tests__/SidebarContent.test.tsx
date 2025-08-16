// ABOUTME: Unit tests for SidebarContent component with provider-based architecture
// ABOUTME: Tests section rendering, provider integration, and mobile/desktop behaviors

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import type { SessionInfo, ThreadId, AgentInfo, ProjectInfo } from '@/types/core';

// Mock all the providers
vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: vi.fn(),
}));

vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: vi.fn(),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: vi.fn(),
}));

vi.mock('@/components/providers/AppStateProvider', () => ({
  useAppSelections: vi.fn(),
}));

// Mock the child components to verify they receive correct props
vi.mock('@/components/sidebar/ProjectSection', () => ({
  ProjectSection: ({
    isMobile,
    onSwitchProject,
    onCloseMobileNav,
  }: {
    isMobile: boolean;
    onSwitchProject: () => void;
    onCloseMobileNav?: () => void;
  }) => (
    <div data-testid="project-section">
      <div data-testid="is-mobile">{isMobile.toString()}</div>
      <button onClick={onSwitchProject} data-testid="switch-project">
        Switch Project
      </button>
      {onCloseMobileNav && (
        <button onClick={onCloseMobileNav} data-testid="close-mobile-nav-project">
          Close
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/sidebar/SessionSection', () => ({
  SessionSection: ({
    isMobile,
    onAgentSelect,
    onClearAgent,
    onCloseMobileNav,
  }: {
    isMobile: boolean;
    onAgentSelect: (agentId: string) => void;
    onClearAgent: () => void;
    onCloseMobileNav?: () => void;
  }) => (
    <div data-testid="session-section">
      <div data-testid="is-mobile">{isMobile.toString()}</div>
      <button onClick={() => onAgentSelect('test-agent')} data-testid="select-agent">
        Select Agent
      </button>
      <button onClick={onClearAgent} data-testid="clear-agent">
        Clear Agent
      </button>
      {onCloseMobileNav && (
        <button onClick={onCloseMobileNav} data-testid="close-mobile-nav-session">
          Close
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/sidebar/TaskSidebarSection', () => ({
  TaskSidebarSection: ({
    selectedProject,
    selectedSession,
    selectedSessionDetails,
    onCloseMobileNav,
  }: {
    selectedProject: string | null;
    selectedSession: ThreadId | null;
    selectedSessionDetails: SessionInfo | null;
    onCloseMobileNav?: () => void;
  }) => (
    <div data-testid="task-section">
      <div data-testid="task-project">{selectedProject || 'no-project'}</div>
      <div data-testid="task-session">{selectedSession || 'no-session'}</div>
      <div data-testid="task-session-name">
        {selectedSessionDetails?.name || 'no-session-details'}
      </div>
      {onCloseMobileNav && (
        <button onClick={onCloseMobileNav} data-testid="close-mobile-nav-task">
          Close
        </button>
      )}
    </div>
  ),
}));

// Import mocked hooks
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useAppSelections } from '@/components/providers/AppStateProvider';

const mockUseProjectContext = vi.mocked(useProjectContext);
const mockUseSessionContext = vi.mocked(useSessionContext);
const mockUseAgentContext = vi.mocked(useAgentContext);
const mockUseAppSelections = vi.mocked(useAppSelections);

// Test data factories
const createMockProject = (): ProjectInfo => ({
  id: 'test-project',
  name: 'Test Project',
  description: 'A test project',
  createdAt: new Date(),
  lastUsedAt: new Date(),
  sessionCount: 0,
  workingDirectory: '/test/path',
  isArchived: false,
});

const createMockAgent = (id: string, name: string): AgentInfo => ({
  threadId: id as ThreadId,
  name,
  providerInstanceId: 'test-provider',
  modelId: 'test-model',
  status: 'idle',
});

const createMockSessionDetails = (): SessionInfo => ({
  id: 'test-session' as ThreadId,
  name: 'Test Session',
  createdAt: new Date(),
  agents: [createMockAgent('agent-1', 'Agent 1')],
});

describe('SidebarContent', () => {
  const mockHandlers = {
    onSwitchProject: vi.fn(),
    onAgentSelect: vi.fn(),
    onClearAgent: vi.fn(),
    onCloseMobileNav: vi.fn(),
  };

  const defaultProps = {
    ...mockHandlers,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock returns
    mockUseProjectContext.mockReturnValue({
      selectedProject: 'test-project',
      foundProject: createMockProject(),
      projects: [createMockProject()],
      loading: false,
      error: null,
      projectsForSidebar: [createMockProject()],
      selectProject: vi.fn(),
      onProjectSelect: vi.fn(),
      updateProject: vi.fn(),
      reloadProjects: vi.fn(),
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
    });

    mockUseSessionContext.mockReturnValue({
      sessions: [],
      loading: false,
      projectConfig: null,
      createSession: vi.fn(),
      selectedSession: null,
      foundSession: null,
      selectSession: vi.fn(),
      onSessionSelect: vi.fn(),
      loadProjectConfig: vi.fn(),
      reloadSessions: vi.fn(),
      enableAgentAutoSelection: vi.fn(),
    });

    mockUseAgentContext.mockReturnValue({
      sessionDetails: createMockSessionDetails(),
      loading: false,
      selectedAgent: 'agent-1',
      foundAgent: createMockAgent('agent-1', 'Agent 1'),
      selectAgent: vi.fn(),
      createAgent: vi.fn(),
      updateAgentState: vi.fn(),
      onAgentSelect: vi.fn(),
      reloadSessionDetails: vi.fn(),
      currentAgent: null,
      agentBusy: false,
    });

    mockUseAppSelections.mockReturnValue({
      selectedProject: 'test-project',
      selectedSession: 'test-session',
      selectedAgent: 'agent-1',
      urlStateHydrated: true,
    });
  });

  describe('Component Rendering', () => {
    it('renders all sections when all data is available', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(screen.getByTestId('project-section')).toBeInTheDocument();
      expect(screen.getByTestId('session-section')).toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });

    it('renders only task section when no project is selected', () => {
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
      });

      mockUseAgentContext.mockReturnValue({
        sessionDetails: null,
        loading: false,
        selectedAgent: null,
        foundAgent: null,
        selectAgent: vi.fn(),
        createAgent: vi.fn(),
        updateAgentState: vi.fn(),
        onAgentSelect: vi.fn(),
        reloadSessionDetails: vi.fn(),
        currentAgent: null,
        agentBusy: false,
      });

      render(<SidebarContent {...defaultProps} />);

      expect(screen.queryByTestId('project-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('session-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });

    it('renders project and task sections when no session is available', () => {
      mockUseAgentContext.mockReturnValue({
        sessionDetails: null,
        loading: false,
        selectedAgent: null,
        foundAgent: null,
        selectAgent: vi.fn(),
        createAgent: vi.fn(),
        updateAgentState: vi.fn(),
        onAgentSelect: vi.fn(),
        reloadSessionDetails: vi.fn(),
        currentAgent: null,
        agentBusy: false,
      });

      render(<SidebarContent {...defaultProps} />);

      expect(screen.getByTestId('project-section')).toBeInTheDocument();
      expect(screen.queryByTestId('session-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });
  });

  describe('Props Passing', () => {
    it('passes correct props to TaskSidebarSection', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(screen.getByTestId('task-project')).toHaveTextContent('test-project');
      expect(screen.getByTestId('task-session')).toHaveTextContent('test-session');
      expect(screen.getByTestId('task-session-name')).toHaveTextContent('Test Session');
    });
  });

  describe('Mobile vs Desktop Behavior', () => {
    it('passes isMobile=false to all sections by default', () => {
      render(<SidebarContent {...defaultProps} />);

      const mobileFlags = screen.getAllByTestId('is-mobile');
      mobileFlags.forEach((flag) => {
        expect(flag).toHaveTextContent('false');
      });
    });

    it('passes isMobile=true to all sections when isMobile prop is true', () => {
      render(<SidebarContent {...defaultProps} isMobile={true} />);

      const mobileFlags = screen.getAllByTestId('is-mobile');
      mobileFlags.forEach((flag) => {
        expect(flag).toHaveTextContent('true');
      });
    });

    it('passes onCloseMobileNav to all sections in mobile mode', () => {
      render(<SidebarContent {...defaultProps} isMobile={true} />);

      expect(screen.getByTestId('close-mobile-nav-project')).toBeInTheDocument();
      expect(screen.getByTestId('close-mobile-nav-session')).toBeInTheDocument();
      expect(screen.getByTestId('close-mobile-nav-task')).toBeInTheDocument();
    });

    it('does not pass onCloseMobileNav to sections in desktop mode', () => {
      render(<SidebarContent {...defaultProps} isMobile={false} />);

      expect(screen.queryByTestId('close-mobile-nav-project')).not.toBeInTheDocument();
      expect(screen.queryByTestId('close-mobile-nav-session')).not.toBeInTheDocument();
      expect(screen.queryByTestId('close-mobile-nav-task')).not.toBeInTheDocument();
    });

    it('works without onCloseMobileNav callback', () => {
      render(<SidebarContent {...defaultProps} isMobile={true} onCloseMobileNav={undefined} />);

      // Should still render mobile sections but without close buttons
      const mobileFlags = screen.getAllByTestId('is-mobile');
      mobileFlags.forEach((flag) => {
        expect(flag).toHaveTextContent('true');
      });
    });
  });

  describe('Event Handler Propagation', () => {
    it('calls onSwitchProject when ProjectSection triggers it', () => {
      render(<SidebarContent {...defaultProps} />);

      screen.getByTestId('switch-project').click();

      expect(mockHandlers.onSwitchProject).toHaveBeenCalledTimes(1);
    });

    it('calls onAgentSelect when SessionSection triggers it', () => {
      render(<SidebarContent {...defaultProps} />);

      screen.getByTestId('select-agent').click();

      expect(mockHandlers.onAgentSelect).toHaveBeenCalledWith('test-agent');
    });

    it('calls onClearAgent when SessionSection triggers it', () => {
      render(<SidebarContent {...defaultProps} />);

      screen.getByTestId('clear-agent').click();

      expect(mockHandlers.onClearAgent).toHaveBeenCalledTimes(1);
    });

    it('calls onCloseMobileNav from all sections in mobile mode', () => {
      render(<SidebarContent {...defaultProps} isMobile={true} />);

      screen.getByTestId('close-mobile-nav-project').click();
      screen.getByTestId('close-mobile-nav-session').click();
      screen.getByTestId('close-mobile-nav-task').click();

      expect(mockHandlers.onCloseMobileNav).toHaveBeenCalledTimes(3);
    });
  });

  describe('Provider Integration', () => {
    it('uses ProjectProvider for project state', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(mockUseProjectContext).toHaveBeenCalled();
      expect(screen.getByTestId('project-section')).toBeInTheDocument();
    });

    it('uses AgentProvider for session details', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(mockUseAgentContext).toHaveBeenCalled();
      expect(screen.getByTestId('session-section')).toBeInTheDocument();
    });

    it('uses AppSelections for URL state', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(mockUseAppSelections).toHaveBeenCalled();
      expect(screen.getByTestId('task-session')).toHaveTextContent('test-session');
    });
  });

  describe('Edge Cases', () => {
    it('handles null project gracefully', () => {
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
      });

      render(<SidebarContent {...defaultProps} />);

      expect(screen.queryByTestId('project-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });

    it('handles null session details gracefully', () => {
      mockUseAgentContext.mockReturnValue({
        sessionDetails: null,
        loading: false,
        selectedAgent: null,
        foundAgent: null,
        selectAgent: vi.fn(),
        createAgent: vi.fn(),
        updateAgentState: vi.fn(),
        onAgentSelect: vi.fn(),
        reloadSessionDetails: vi.fn(),
        currentAgent: null,
        agentBusy: false,
      });

      render(<SidebarContent {...defaultProps} />);

      expect(screen.queryByTestId('session-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('project-section')).toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });
  });
});
