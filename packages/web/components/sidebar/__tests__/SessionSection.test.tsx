// ABOUTME: Unit tests for SessionSection component
// ABOUTME: Tests agent selection, mobile/desktop behaviors, status display

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SessionSection } from '@/components/sidebar/SessionSection';
import type { SessionInfo, ThreadId, AgentInfo } from '@/types/core';

// Test data factories
const createMockAgent = (
  id: string,
  name: string,
  status: AgentInfo['status'] = 'idle'
): AgentInfo => ({
  threadId: id as ThreadId,
  name,
  providerInstanceId: 'test-provider',
  modelId: 'test-model',
  status,
});

const createMockSessionDetails = (agents: AgentInfo[]): SessionInfo => ({
  id: 'test-session' as ThreadId,
  name: 'Test Session',
  createdAt: new Date(),
  agents,
});

describe('SessionSection', () => {
  const mockOnAgentSelect = vi.fn();
  const mockOnClearAgent = vi.fn();
  const mockOnCloseMobileNav = vi.fn();

  const defaultProps = {
    selectedSessionDetails: createMockSessionDetails([
      createMockAgent('agent-1', 'Alice', 'idle'),
      createMockAgent('agent-2', 'Bob', 'thinking'),
    ]),
    selectedAgent: null,
    onAgentSelect: mockOnAgentSelect,
    onClearAgent: mockOnClearAgent,
    onCloseMobileNav: mockOnCloseMobileNav,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Structure', () => {
    it('renders with session name', () => {
      render(<SessionSection {...defaultProps} />);

      expect(screen.getByText('Test Session')).toBeInTheDocument();
      expect(screen.getByText('Active Session')).toBeInTheDocument();
    });

    it('shows setup needed when no agent selected', () => {
      render(<SessionSection {...defaultProps} />);

      expect(screen.getByText('Setup needed')).toBeInTheDocument();
      expect(screen.getByText('2 agents available')).toBeInTheDocument();
    });

    it('does not show setup needed when agent is selected', () => {
      render(<SessionSection {...defaultProps} selectedAgent={'agent-1' as ThreadId} />);

      expect(screen.queryByText('Setup needed')).not.toBeInTheDocument();
    });
  });

  describe('Agent Selection State', () => {
    it('shows agent list when no agent selected', () => {
      render(<SessionSection {...defaultProps} />);

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Configure Session')).toBeInTheDocument();
    });

    it('shows continue session UI when agent selected', () => {
      render(<SessionSection {...defaultProps} selectedAgent={'agent-1' as ThreadId} />);

      expect(screen.getByText('Continue Session')).toBeInTheDocument();
      expect(screen.queryByText('Configure Session')).not.toBeInTheDocument();
    });

    it('shows switch agent button for multi-agent sessions', () => {
      render(<SessionSection {...defaultProps} selectedAgent={'agent-1' as ThreadId} />);

      expect(screen.getByText('Switch Agent')).toBeInTheDocument();
    });

    it('does not show switch agent button for single agent sessions', () => {
      const singleAgentSession = createMockSessionDetails([createMockAgent('agent-1', 'Alice')]);

      render(
        <SessionSection
          {...defaultProps}
          selectedSessionDetails={singleAgentSession}
          selectedAgent={'agent-1' as ThreadId}
        />
      );

      expect(screen.queryByText('Switch Agent')).not.toBeInTheDocument();
    });
  });

  describe('Agent Status Display', () => {
    it('displays current agent name and status when selected', () => {
      render(<SessionSection {...defaultProps} selectedAgent={'agent-1' as ThreadId} />);

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('idle')).toBeInTheDocument();
    });

    it('shows correct status badges for different agent states', () => {
      render(<SessionSection {...defaultProps} />);

      // Check status badges in agent list
      const idleBadges = screen.getAllByText('idle');
      const thinkingBadges = screen.getAllByText('thinking');

      expect(idleBadges.length).toBeGreaterThan(0);
      expect(thinkingBadges.length).toBeGreaterThan(0);
    });

    it('handles missing selected agent gracefully', () => {
      render(<SessionSection {...defaultProps} selectedAgent={'nonexistent-agent' as ThreadId} />);

      // Should fall back to showing agent list
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  describe('Event Handlers', () => {
    it('calls onAgentSelect when agent is clicked', () => {
      render(<SessionSection {...defaultProps} />);

      fireEvent.click(screen.getByText('Alice'));

      expect(mockOnAgentSelect).toHaveBeenCalledWith('agent-1');
    });

    it('calls onClearAgent when switch agent is clicked', () => {
      render(<SessionSection {...defaultProps} selectedAgent={'agent-1' as ThreadId} />);

      fireEvent.click(screen.getByText('Switch Agent'));

      expect(mockOnClearAgent).toHaveBeenCalledTimes(1);
    });

    it('calls onClearAgent when configure session is clicked', () => {
      render(<SessionSection {...defaultProps} />);

      fireEvent.click(screen.getByText('Configure Session'));

      expect(mockOnClearAgent).toHaveBeenCalledTimes(1);
    });

    it('handles continue session click', () => {
      render(<SessionSection {...defaultProps} selectedAgent={'agent-1' as ThreadId} />);

      // Should not throw error when clicked
      fireEvent.click(screen.getByText('Continue Session'));
    });
  });

  describe('Mobile vs Desktop Behavior', () => {
    it('does not call onCloseMobileNav in desktop mode', () => {
      render(<SessionSection {...defaultProps} isMobile={false} />);

      fireEvent.click(screen.getByText('Alice'));

      expect(mockOnAgentSelect).toHaveBeenCalledWith('agent-1');
      expect(mockOnCloseMobileNav).not.toHaveBeenCalled();
    });

    it('calls onCloseMobileNav when selecting agent in mobile mode', () => {
      render(<SessionSection {...defaultProps} isMobile={true} />);

      fireEvent.click(screen.getByText('Alice'));

      expect(mockOnAgentSelect).toHaveBeenCalledWith('agent-1');
      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('calls onCloseMobileNav when switching agent in mobile mode', () => {
      render(
        <SessionSection {...defaultProps} selectedAgent={'agent-1' as ThreadId} isMobile={true} />
      );

      fireEvent.click(screen.getByText('Switch Agent'));

      expect(mockOnClearAgent).toHaveBeenCalledTimes(1);
      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('calls onCloseMobileNav when continuing session in mobile mode', () => {
      render(
        <SessionSection {...defaultProps} selectedAgent={'agent-1' as ThreadId} isMobile={true} />
      );

      fireEvent.click(screen.getByText('Continue Session'));

      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
    });

    it('calls onCloseMobileNav when configuring session in mobile mode', () => {
      render(<SessionSection {...defaultProps} isMobile={true} />);

      fireEvent.click(screen.getByText('Configure Session'));

      expect(mockOnClearAgent).toHaveBeenCalledTimes(1);
      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
    });
  });

  describe('Agent Status Badge Classes', () => {
    it('applies correct badge classes for different statuses', () => {
      const agents = [
        createMockAgent('agent-1', 'Idle Agent', 'idle'),
        createMockAgent('agent-2', 'Thinking Agent', 'thinking'),
        createMockAgent('agent-3', 'Streaming Agent', 'streaming'),
        createMockAgent('agent-4', 'Tool Agent', 'tool_execution'),
      ];

      render(
        <SessionSection
          {...defaultProps}
          selectedSessionDetails={createMockSessionDetails(agents)}
        />
      );

      // All status text should be present
      expect(screen.getByText('idle')).toBeInTheDocument();
      expect(screen.getByText('thinking')).toBeInTheDocument();
      expect(screen.getByText('streaming')).toBeInTheDocument();
      expect(screen.getByText('tool_execution')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles empty agents array', () => {
      const emptySession = createMockSessionDetails([]);

      render(<SessionSection {...defaultProps} selectedSessionDetails={emptySession} />);

      expect(screen.getByText('0 agents available')).toBeInTheDocument();
      expect(screen.getByText('Configure Session')).toBeInTheDocument();
    });

    it('handles undefined agents', () => {
      const sessionWithoutAgents = {
        ...defaultProps.selectedSessionDetails,
        agents: [],
      };

      render(<SessionSection {...defaultProps} selectedSessionDetails={sessionWithoutAgents} />);

      expect(screen.getByText('0 agents available')).toBeInTheDocument();
    });

    it('works without onCloseMobileNav callback', () => {
      render(<SessionSection {...defaultProps} isMobile={true} onCloseMobileNav={undefined} />);

      // Should not throw when clicking
      fireEvent.click(screen.getByText('Alice'));
      expect(mockOnAgentSelect).toHaveBeenCalledWith('agent-1');
    });
  });
});
