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
import {
  createMockSessionContext,
  createMockProjectsContext,
} from '@/__tests__/utils/provider-mocks';
import { createMockAgentInfo } from '@/__tests__/utils/agent-mocks';

// Mock the providers
vi.mock('@/components/providers/SessionProvider', () => ({
  useSessionContext: vi.fn(),
}));

vi.mock('@/components/providers/ProjectsProvider', () => ({
  useProjectsContext: vi.fn(),
}));

vi.mock('@/hooks/useURLState', () => ({
  useURLState: vi.fn(),
}));

// Import the mocked hooks
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useProjectsContext } from '@/components/providers/ProjectsProvider';
import { useURLState } from '@/hooks/useURLState';

const mockUseSessionContext = vi.mocked(useSessionContext);
const mockUseProjectsContext = vi.mocked(useProjectsContext);
const mockUseURLState = vi.mocked(useURLState);

// Test data factories
const createMockAgent = (
  id: string,
  name: string,
  status: AgentInfo['status'] = 'idle'
): AgentInfo =>
  createMockAgentInfo({
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
  const mockOnCloseMobileNav = vi.fn();

  const defaultProps = {
    onCloseMobileNav: mockOnCloseMobileNav,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock setup
    mockUseSessionContext.mockReturnValue(
      createMockSessionContext({
        sessionDetails: createMockSessionDetails([
          createMockAgent('agent-1', 'Alice', 'idle'),
          createMockAgent('agent-2', 'Bob', 'thinking'),
        ]),
        selectedAgent: null,
        foundAgent: null,
      })
    );

    mockUseProjectsContext.mockReturnValue(
      createMockProjectsContext({
        selectedProject: 'test-project',
        foundProject: {
          id: 'test-project',
          name: 'Test Project',
          description: 'A test project',
          workingDirectory: '/test',
          createdAt: new Date(),
          lastUsedAt: new Date(),
          sessionCount: 0,
          isArchived: false,
        },
      })
    );

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
    it('renders with session name', () => {
      render(<SessionSection {...defaultProps} />);

      expect(screen.getByText('Test Session')).toBeInTheDocument();
    });

    it('does not render when no session details available', () => {
      mockUseSessionContext.mockReturnValue(
        createMockSessionContext({
          sessionDetails: null,
          selectedAgent: null,
          foundAgent: null,
        })
      );

      const { container } = render(<SessionSection {...defaultProps} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Mobile Behavior', () => {
    it('works without onCloseMobileNav callback', () => {
      const propsWithoutCallback = { ...defaultProps, onCloseMobileNav: undefined };

      expect(() => {
        render(<SessionSection {...propsWithoutCallback} isMobile={true} />);
      }).not.toThrow();
    });
  });

  describe('Session Navigation', () => {
    it('renders switch icon when project is selected', () => {
      render(<SessionSection {...defaultProps} />);

      const switchButton = screen.getByTestId('session-switch-button');
      expect(switchButton).toBeInTheDocument();
      expect(switchButton).toHaveAttribute('title', 'Switch to sessions');
    });

    it('does not render switch icon when no project is selected', () => {
      mockUseProjectsContext.mockReturnValue(
        createMockProjectsContext({
          selectedProject: null,
          foundProject: null,
        })
      );

      render(<SessionSection {...defaultProps} />);

      expect(screen.queryByTestId('session-switch-button')).not.toBeInTheDocument();
    });

    it('calls navigateToProject when switch icon is clicked', () => {
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

      render(<SessionSection {...defaultProps} />);

      const switchButton = screen.getByTestId('session-switch-button');
      fireEvent.click(switchButton);

      expect(mockNavigateToProject).toHaveBeenCalledWith('test-project');
    });

    it('calls navigateToProject and onCloseMobileNav when switch icon is clicked in mobile mode', () => {
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

      const mobileProps = { ...defaultProps, isMobile: true };
      render(<SessionSection {...mobileProps} />);

      const switchButton = screen.getByTestId('session-switch-button');
      fireEvent.click(switchButton);

      expect(mockNavigateToProject).toHaveBeenCalledWith('test-project');
      expect(mockOnCloseMobileNav).toHaveBeenCalledTimes(1);
    });
  });

  describe('Provider Integration', () => {
    it('uses SessionProvider for session details', () => {
      render(<SessionSection {...defaultProps} />);

      expect(mockUseSessionContext).toHaveBeenCalled();
    });

    it('uses ProjectsProvider for project context', () => {
      render(<SessionSection {...defaultProps} />);

      expect(mockUseProjectsContext).toHaveBeenCalled();
    });

    it('uses URLState for navigation', () => {
      render(<SessionSection {...defaultProps} />);

      expect(mockUseURLState).toHaveBeenCalled();
    });

    it('handles loading state from provider', () => {
      mockUseSessionContext.mockReturnValue(
        createMockSessionContext({
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
