// ABOUTME: Unit tests for SidebarContent component
// ABOUTME: Tests section rendering, prop passing, and mobile/desktop behaviors

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import type { SessionInfo, ThreadId, AgentInfo, Task } from '@/types/core';

// Mock the child components
vi.mock('@/components/sidebar/ProjectSection', () => ({
  ProjectSection: ({
    currentProject,
    isMobile,
    onSwitchProject,
    onCloseMobileNav,
  }: {
    currentProject: { name: string };
    isMobile: boolean;
    onSwitchProject: () => void;
    onCloseMobileNav?: () => void;
  }) => (
    <div data-testid="project-section">
      <div data-testid="project-name">{currentProject.name}</div>
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
    selectedSessionDetails,
    isMobile,
    onAgentSelect,
    onClearAgent,
    onCloseMobileNav,
  }: {
    selectedSessionDetails: { name: string };
    isMobile: boolean;
    onAgentSelect: (agentId: string) => void;
    onClearAgent: () => void;
    onCloseMobileNav?: () => void;
  }) => (
    <div data-testid="session-section">
      <div data-testid="session-name">{selectedSessionDetails.name}</div>
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
  TaskSidebarSection: ({ onCloseMobileNav }: { onCloseMobileNav?: () => void }) => (
    <div data-testid="task-section">
      <div data-testid="task-count">0</div>
      <button data-testid="show-task-board">Show Board</button>
      <button data-testid="show-task-creation">Create Task</button>
      {onCloseMobileNav && (
        <button onClick={onCloseMobileNav} data-testid="close-mobile-nav-task">
          Close
        </button>
      )}
    </div>
  ),
}));

// Test data factories
const createMockProject = (
  overrides?: Partial<{ id: string; name: string; description?: string }>
) => ({
  id: 'test-project',
  name: 'Test Project',
  description: 'A test project',
  ...overrides,
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

const createMockTask = (id: string): Task => ({
  id,
  title: `Task ${id}`,
  description: 'Test task description',
  prompt: 'Test task prompt',
  status: 'pending',
  priority: 'medium',
  threadId: 'test-session' as ThreadId,
  createdAt: new Date(),
  updatedAt: new Date(),
  notes: [],
  createdBy: 'user',
});

describe('SidebarContent', () => {
  const mockHandlers = {
    onSwitchProject: vi.fn(),
    onAgentSelect: vi.fn(),
    onClearAgent: vi.fn(),
    onCloseMobileNav: vi.fn(),
  };

  const defaultProps = {
    selectedProject: 'test-project',
    currentProject: createMockProject(),
    sessionsCount: 3,
    selectedSession: 'test-session' as ThreadId,
    selectedSessionDetails: createMockSessionDetails(),
    selectedAgent: 'agent-1' as ThreadId,
    ...mockHandlers,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Component Rendering', () => {
    it('renders all sections when all data is available', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(screen.getByTestId('project-section')).toBeInTheDocument();
      expect(screen.getByTestId('session-section')).toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });

    it('renders only task section when no project is selected', () => {
      render(
        <SidebarContent {...defaultProps} selectedProject={null} selectedSessionDetails={null} />
      );

      expect(screen.queryByTestId('project-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('session-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });

    it('renders project and task sections when no session is available', () => {
      render(<SidebarContent {...defaultProps} selectedSessionDetails={null} />);

      expect(screen.getByTestId('project-section')).toBeInTheDocument();
      expect(screen.queryByTestId('session-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });
  });

  describe('Props Passing', () => {
    it('passes correct props to ProjectSection', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(screen.getByTestId('project-name')).toHaveTextContent('Test Project');
      expect(screen.getByTestId('switch-project')).toBeInTheDocument();
    });

    it('passes correct props to SessionSection', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(screen.getByTestId('session-name')).toHaveTextContent('Test Session');
      expect(screen.getByTestId('select-agent')).toBeInTheDocument();
      expect(screen.getByTestId('clear-agent')).toBeInTheDocument();
    });

    it('passes correct props to TaskSidebarSection', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(screen.getByTestId('task-count')).toHaveTextContent('0');
      expect(screen.getByTestId('show-task-board')).toBeInTheDocument();
      expect(screen.getByTestId('show-task-creation')).toBeInTheDocument();
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

  describe('Edge Cases', () => {
    it('handles null taskManager gracefully', () => {
      render(<SidebarContent {...defaultProps} />);

      expect(screen.getByTestId('task-section')).toBeInTheDocument();
      expect(screen.getByTestId('task-count')).toHaveTextContent('0');
    });

    it('handles empty project', () => {
      const emptyProject = createMockProject({ name: '', description: undefined });

      render(<SidebarContent {...defaultProps} currentProject={emptyProject} />);

      expect(screen.getByTestId('project-section')).toBeInTheDocument();
      expect(screen.getByTestId('project-name')).toHaveTextContent('');
    });

    it('handles null selectedAgent', () => {
      render(<SidebarContent {...defaultProps} selectedAgent={null} />);

      expect(screen.getByTestId('session-section')).toBeInTheDocument();
    });

    it('renders correctly with minimal props', () => {
      const minimalProps = {
        selectedProject: null,
        currentProject: createMockProject(),
        sessionsCount: 0,
        selectedSession: null,
        selectedSessionDetails: null,
        selectedAgent: null,
        onSwitchProject: vi.fn(),
        onAgentSelect: vi.fn(),
        onClearAgent: vi.fn(),
      };

      render(<SidebarContent {...minimalProps} />);

      // Should only render TaskSidebarSection since no project is selected
      expect(screen.queryByTestId('project-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('session-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });
  });
});
