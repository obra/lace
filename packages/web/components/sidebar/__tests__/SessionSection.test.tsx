// ABOUTME: Unit tests for SessionSection component with provider-based architecture
// ABOUTME: Tests agent selection, mobile/desktop behaviors, status display with providers

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SessionSection } from '@/components/sidebar/SessionSection';
import type { SessionInfo, ThreadId, AgentInfo } from '@/types/core';
import { createMockAgentContext } from '@/__tests__/utils/provider-mocks';

// Mock the AgentProvider
vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: vi.fn(),
}));

// Import the mocked hook
import { useAgentContext } from '@/components/providers/AgentProvider';
const mockUseAgentContext = vi.mocked(useAgentContext);

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
    onAgentSelect: mockOnAgentSelect,
    onClearAgent: mockOnClearAgent,
    onCloseMobileNav: mockOnCloseMobileNav,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock setup
    mockUseAgentContext.mockReturnValue(
      createMockAgentContext({
        sessionDetails: createMockSessionDetails([
          createMockAgent('agent-1', 'Alice', 'idle'),
          createMockAgent('agent-2', 'Bob', 'thinking'),
        ]),
        selectedAgent: null,
        foundAgent: null,
      })
    );
  });

  describe('Basic Structure', () => {
    it('renders with session name', () => {
      render(<SessionSection {...defaultProps} />);

      expect(screen.getByText('Test Session')).toBeInTheDocument();
      expect(screen.getByText('Active Session')).toBeInTheDocument();
    });

    it('does not render when no session details available', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: null,
          selectedAgent: null,
          foundAgent: null,
        })
      );

      const { container } = render(<SessionSection {...defaultProps} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Agent Status Display', () => {
    it('displays current agent name and status when selected', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: createMockSessionDetails([
            createMockAgent('agent-1', 'Alice', 'thinking'),
          ]),
          selectedAgent: 'agent-1' as ThreadId,
          foundAgent: createMockAgent('agent-1', 'Alice', 'thinking'),
        })
      );

      render(<SessionSection {...defaultProps} />);

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('thinking')).toBeInTheDocument();
    });

    it('shows correct status badges for different agent states', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: createMockSessionDetails([
            createMockAgent('agent-1', 'Alice', 'idle'),
            createMockAgent('agent-2', 'Bob', 'thinking'),
            createMockAgent('agent-3', 'Charlie', 'tool_execution'),
          ]),
          selectedAgent: null,
          foundAgent: null,
        })
      );

      render(<SessionSection {...defaultProps} />);

      expect(screen.getByText('idle')).toBeInTheDocument();
      expect(screen.getByText('thinking')).toBeInTheDocument();
      expect(screen.getByText('tool_execution')).toBeInTheDocument();
    });

    it('handles missing selected agent gracefully', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: createMockSessionDetails([createMockAgent('agent-1', 'Alice', 'idle')]),
          selectedAgent: 'nonexistent-agent' as ThreadId,
          foundAgent: null,
        })
      );

      render(<SessionSection {...defaultProps} />);

      // Should show agent selection UI since current agent is null
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  describe('Event Handling', () => {
    it('calls onAgentSelect when agent is clicked', () => {
      render(<SessionSection {...defaultProps} />);

      const aliceButton = screen.getByText('Alice').closest('div')!;
      fireEvent.click(aliceButton);

      expect(mockOnAgentSelect).toHaveBeenCalledWith('agent-1');
    });
  });

  describe('Mobile Behavior', () => {
    it('calls onCloseMobileNav in mobile mode after actions', () => {
      const mobileProps = { ...defaultProps, isMobile: true };
      render(<SessionSection {...mobileProps} />);

      const aliceButton = screen.getByText('Alice').closest('div')!;
      fireEvent.click(aliceButton);

      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
      expect(mockOnAgentSelect).toHaveBeenCalledWith('agent-1');
    });

    it('works without onCloseMobileNav callback', () => {
      const propsWithoutCallback = { ...defaultProps, onCloseMobileNav: undefined };

      expect(() => {
        render(<SessionSection {...propsWithoutCallback} isMobile={true} />);
      }).not.toThrow();
    });
  });

  describe('Provider Integration', () => {
    it('uses AgentProvider for session details', () => {
      render(<SessionSection {...defaultProps} />);

      expect(mockUseAgentContext).toHaveBeenCalled();
    });

    it('handles loading state from provider', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: null,
          loading: true,
          selectedAgent: null,
          foundAgent: null,
        })
      );

      const { container } = render(<SessionSection {...defaultProps} />);

      // Component should not render when sessionDetails is null
      expect(container.firstChild).toBeNull();
    });
  });
});
