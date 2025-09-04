// ABOUTME: Unit test for AgentsSection optimistic UI behavior
// ABOUTME: Tests that agent selection provides immediate visual feedback

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentsSection } from '@/components/sidebar/AgentsSection';
import type { SessionInfo, ThreadId, AgentInfo } from '@/types/core';
import { createMockAgentContext } from '@/__tests__/utils/provider-mocks';

// Mock the AgentProvider
vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: vi.fn(),
}));

// Mock Sidebar components
vi.mock('@/components/layout/Sidebar', () => ({
  SidebarItem: ({
    children,
    onClick,
    active,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    active?: boolean;
  }) => (
    <button onClick={onClick} className={active ? 'active' : 'inactive'} data-testid="sidebar-item">
      {children}
    </button>
  ),
}));

// Mock FontAwesome
vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon }: { icon: unknown }) => <span data-testid="icon">{String(icon)}</span>,
}));

vi.mock('@/lib/fontawesome', () => ({
  faRobot: 'faRobot',
  faCog: 'faCog',
}));

// Import mocked hook
import { useAgentContext } from '@/components/providers/AgentProvider';
const mockUseAgentContext = vi.mocked(useAgentContext);

// Test data factories
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
  agents: [
    createMockAgent('agent-1', 'Agent 1'),
    createMockAgent('agent-2', 'Agent 2'),
    createMockAgent('agent-3', 'Agent 3'),
  ],
});

describe('AgentsSection - Optimistic UI', () => {
  const mockHandlers = {
    onAgentSelect: vi.fn(),
    onConfigureAgent: vi.fn(),
    onCloseMobileNav: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Set up default mock return
    mockUseAgentContext.mockReturnValue(
      createMockAgentContext({
        sessionDetails: createMockSessionDetails(),
        selectedAgent: 'agent-1' as ThreadId,
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should immediately highlight clicked agent while navigation is in progress', () => {
    render(<AgentsSection {...mockHandlers} />);

    // Check if component renders at all
    const agentElements = screen.getAllByText(/Agent \d/);
    expect(agentElements).toHaveLength(3);

    const sidebarItems = screen.getAllByTestId('sidebar-item');
    expect(sidebarItems).toHaveLength(3);

    // Initially, agent-1 should be active
    expect(sidebarItems[0]).toHaveClass('active');
    expect(sidebarItems[1]).toHaveClass('inactive');
    expect(sidebarItems[2]).toHaveClass('inactive');

    // Click on agent-2
    fireEvent.click(sidebarItems[1]);

    // Should immediately show agent-2 as active (optimistic UI)
    expect(sidebarItems[0]).toHaveClass('inactive');
    expect(sidebarItems[1]).toHaveClass('active');
    expect(sidebarItems[2]).toHaveClass('inactive');

    // Verify the callback was called
    expect(mockHandlers.onAgentSelect).toHaveBeenCalledWith('agent-2');
  });

  it('should clear optimistic selection when URL state updates', () => {
    const { rerender } = render(<AgentsSection {...mockHandlers} />);

    const sidebarItems = screen.getAllByTestId('sidebar-item');

    // Click on agent-2 (should show optimistic selection)
    fireEvent.click(sidebarItems[1]);
    expect(sidebarItems[1]).toHaveClass('active');

    // Simulate URL state update (navigation completed)
    mockUseAgentContext.mockReturnValue(
      createMockAgentContext({
        sessionDetails: createMockSessionDetails(),
        selectedAgent: 'agent-2' as ThreadId,
      })
    );

    rerender(<AgentsSection {...mockHandlers} />);

    // Should still show agent-2 as active, but now from URL state
    expect(sidebarItems[1]).toHaveClass('active');
  });

  it('should handle multiple rapid clicks correctly', () => {
    render(<AgentsSection {...mockHandlers} />);

    const sidebarItems = screen.getAllByTestId('sidebar-item');

    // Click agent-2, then agent-3 quickly
    fireEvent.click(sidebarItems[1]);
    fireEvent.click(sidebarItems[2]);

    // Should show the last clicked agent (agent-3) as active
    expect(sidebarItems[0]).toHaveClass('inactive');
    expect(sidebarItems[1]).toHaveClass('inactive');
    expect(sidebarItems[2]).toHaveClass('active');

    // Should have called onAgentSelect for both clicks
    expect(mockHandlers.onAgentSelect).toHaveBeenCalledTimes(2);
    expect(mockHandlers.onAgentSelect).toHaveBeenNthCalledWith(1, 'agent-2');
    expect(mockHandlers.onAgentSelect).toHaveBeenNthCalledWith(2, 'agent-3');
  });
});
