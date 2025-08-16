// ABOUTME: Unit tests for ProjectSection component
// ABOUTME: Tests project display, stats, mobile/desktop behaviors, and switch project functionality

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectSection } from '@/components/sidebar/ProjectSection';
import type { SessionInfo, ThreadId, AgentInfo } from '@/types/core';

// Test data factories
const createMockProject = (
  overrides?: Partial<{ id: string; name: string; description?: string }>
) => ({
  id: 'test-project',
  name: 'Test Project',
  description: 'A test project for development',
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
    currentProject: createMockProject(),
    sessionsCount: 3,
    selectedSessionDetails: createMockSessionDetails(),
    onSwitchProject: mockOnSwitchProject,
    onCloseMobileNav: mockOnCloseMobileNav,
  };

  beforeEach(() => {
    vi.clearAllMocks();
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

      render(<ProjectSection {...defaultProps} currentProject={projectWithoutDescription} />);

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
      render(<ProjectSection {...defaultProps} sessionsCount={1} />);

      expect(screen.getByTestId('sessions-count')).toHaveTextContent('1 session');
    });

    it('displays sessions count correctly for zero sessions', () => {
      render(<ProjectSection {...defaultProps} sessionsCount={0} />);

      expect(screen.getByTestId('sessions-count')).toHaveTextContent('0 sessions');
    });

    it('displays agents count when session details provided', () => {
      render(<ProjectSection {...defaultProps} />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('2 agents');
    });

    it('displays agents count correctly for single agent', () => {
      const sessionWithOneAgent = createMockSessionDetails(1);

      render(<ProjectSection {...defaultProps} selectedSessionDetails={sessionWithOneAgent} />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('1 agent');
    });

    it('displays agents count correctly for zero agents', () => {
      const sessionWithNoAgents = createMockSessionDetails(0);

      render(<ProjectSection {...defaultProps} selectedSessionDetails={sessionWithNoAgents} />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('0 agents');
    });

    it('does not display agents count when no session details provided', () => {
      render(<ProjectSection {...defaultProps} selectedSessionDetails={null} />);

      expect(screen.queryByTestId('agents-count')).not.toBeInTheDocument();
    });

    it('handles undefined agents in session details', () => {
      const sessionWithUndefinedAgents = {
        ...createMockSessionDetails(),
        agents: undefined,
      };

      render(
        <ProjectSection {...defaultProps} selectedSessionDetails={sessionWithUndefinedAgents} />
      );

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
      const { isMobile, ...propsWithoutMobile } = defaultProps;
      render(<ProjectSection {...propsWithoutMobile} />);

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

      render(<ProjectSection {...defaultProps} currentProject={longNameProject} />);

      const projectNameElement = screen.getByTestId('current-project-name-desktop');
      expect(projectNameElement).toHaveClass('truncate');
      expect(projectNameElement).toHaveTextContent(longNameProject.name);
    });

    it('handles very long project descriptions with truncation', () => {
      const longDescProject = createMockProject({
        description:
          'This is an extremely long project description that should be truncated in the UI to prevent layout issues and maintain clean appearance',
      });

      render(<ProjectSection {...defaultProps} currentProject={longDescProject} />);

      const descriptionElement = screen.getByText(longDescProject.description);
      expect(descriptionElement).toHaveClass('truncate');
    });

    it('handles empty project name gracefully', () => {
      const emptyNameProject = createMockProject({ name: '' });

      render(<ProjectSection {...defaultProps} currentProject={emptyNameProject} />);

      const projectNameElement = screen.getByTestId('current-project-name-desktop');
      expect(projectNameElement).toHaveTextContent('');
    });

    it('handles missing project id', () => {
      const projectWithoutId = createMockProject({ id: '' });

      render(<ProjectSection {...defaultProps} currentProject={projectWithoutId} />);

      // Should still render the component
      expect(screen.getByText('Test Project')).toBeInTheDocument();
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
});
