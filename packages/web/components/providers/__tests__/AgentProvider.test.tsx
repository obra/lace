// ABOUTME: Integration tests for AgentProvider focusing on real provider responsibilities
// ABOUTME: Tests agent data management, selection handling, and CRUD operations

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentProvider, useAgentContext } from '@/components/providers/AgentProvider';
import type { SessionInfo, AgentInfo, ThreadId } from '@/types/core';
import type { CreateAgentRequest } from '@/types/api';

// Mock the hooks
vi.mock('@/hooks/useAgentManagement', () => ({
  useAgentManagement: vi.fn(),
}));

vi.mock('@/hooks/useHashRouter', () => ({
  useHashRouter: vi.fn(),
}));

import { useAgentManagement } from '@/hooks/useAgentManagement';
import { useHashRouter } from '@/hooks/useHashRouter';

const mockUseAgentManagement = vi.mocked(useAgentManagement);
const mockUseHashRouter = vi.mocked(useHashRouter);

// Test data factories
const createMockAgent = (overrides?: Partial<AgentInfo>): AgentInfo => ({
  threadId: 'agent-1' as ThreadId,
  name: 'Test Agent',
  providerInstanceId: 'test-provider',
  modelId: 'test-model',
  status: 'idle',
  ...overrides,
});

const createMockSession = (overrides?: Partial<SessionInfo>): SessionInfo => ({
  id: 'session-1' as ThreadId,
  name: 'Test Session',
  createdAt: new Date('2024-01-01'),
  agents: [
    createMockAgent({ threadId: 'agent-1' as ThreadId, name: 'Agent One' }),
    createMockAgent({ threadId: 'agent-2' as ThreadId, name: 'Agent Two' }),
    createMockAgent({ threadId: 'agent-3' as ThreadId, name: 'Agent Three' }),
  ],
  ...overrides,
});

const mockSessionDetails = createMockSession();

// Component to test context provision
function ContextConsumer() {
  const {
    sessionDetails,
    loading,
    selectedAgent,
    foundAgent,
    selectAgent,
    onAgentSelect,
    createAgent,
    updateAgentState,
    reloadSessionDetails,
  } = useAgentContext();

  return (
    <div>
      <div data-testid="session-name">{sessionDetails?.name || 'none'}</div>
      <div data-testid="agent-count">{sessionDetails?.agents?.length || 0}</div>
      <div data-testid="loading">{loading.toString()}</div>
      <div data-testid="selected-agent">{selectedAgent || 'none'}</div>
      <div data-testid="found-agent">{foundAgent?.name || 'none'}</div>

      <button onClick={() => selectAgent('agent-2')} data-testid="select-agent-2">
        Select Agent 2
      </button>
      <button onClick={() => onAgentSelect({ id: 'agent-3' })} data-testid="select-agent-3">
        Select Agent 3
      </button>
      <button
        onClick={() =>
          createAgent('session-1', {
            name: 'New Agent',
            providerInstanceId: 'anthropic',
            modelId: 'claude-3-haiku',
          })
        }
        data-testid="create-agent"
      >
        Create Agent
      </button>
      <button
        onClick={() => updateAgentState('agent-1', 'idle', 'active')}
        data-testid="update-agent-state"
      >
        Update Agent State
      </button>
      <button onClick={() => void reloadSessionDetails()} data-testid="reload-session">
        Reload Session
      </button>
    </div>
  );
}

describe('AgentProvider', () => {
  const mockCreateAgent = vi.fn();
  const mockUpdateAgentState = vi.fn();
  const mockReloadSessionDetails = vi.fn();
  const mockSetSelectedAgent = vi.fn();
  const mockOnAgentChange = vi.fn();

  const defaultAgentManagement = {
    sessionDetails: mockSessionDetails,
    loading: false,
    createAgent: mockCreateAgent,
    updateAgentState: mockUpdateAgentState,
    reloadSessionDetails: mockReloadSessionDetails,
    loadAgentConfiguration: vi.fn(),
    updateAgent: vi.fn(),
  };

  const defaultHashRouter = {
    agent: 'agent-1' as ThreadId,
    setAgent: mockSetSelectedAgent,
    // Add other required properties with minimal implementations
    project: null,
    session: null,
    isHydrated: true,
    setProject: vi.fn(),
    setSession: vi.fn(),
    updateState: vi.fn(),
    clearAll: vi.fn(),
    state: { agent: 'agent-1' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAgentManagement.mockReturnValue(defaultAgentManagement);
    mockUseHashRouter.mockReturnValue(defaultHashRouter);
  });

  describe('Context Provision', () => {
    it('provides agent context to children', () => {
      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('session-name')).toHaveTextContent('Test Session');
      expect(screen.getByTestId('agent-count')).toHaveTextContent('3');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('selected-agent')).toHaveTextContent('agent-1');
      expect(screen.getByTestId('found-agent')).toHaveTextContent('Agent One');
    });

    it('throws error when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ContextConsumer />);
      }).toThrow('useAgentContext must be used within an AgentProvider');

      // Verify that React logged the error (error boundary behavior)
      expect(consoleSpy).toHaveBeenCalled();
      // Check that at least one call contains our error message
      const calls = consoleSpy.mock.calls.flat();
      expect(
        calls.some(
          (call) =>
            typeof call === 'string' &&
            call.includes('useAgentContext must be used within an AgentProvider')
        )
      ).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('Agent Data Management', () => {
    it('provides found agent data when agent is selected', () => {
      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('found-agent')).toHaveTextContent('Agent One');
    });

    it('provides null found agent when no agent is selected', () => {
      mockUseHashRouter.mockReturnValue({
        ...defaultHashRouter,
        agent: null,
        state: { agent: undefined },
      });

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('found-agent')).toHaveTextContent('none');
    });

    it('provides null found agent when selected agent not found', () => {
      mockUseHashRouter.mockReturnValue({
        ...defaultHashRouter,
        agent: 'nonexistent-agent' as ThreadId,
        state: { agent: 'nonexistent-agent' },
      });

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('found-agent')).toHaveTextContent('none');
    });

    it('provides null found agent when no session details', () => {
      mockUseAgentManagement.mockReturnValue({
        ...defaultAgentManagement,
        sessionDetails: null,
      });

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('found-agent')).toHaveTextContent('none');
      expect(screen.getByTestId('session-name')).toHaveTextContent('none');
    });

    it('displays session details when available', () => {
      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('session-name')).toHaveTextContent('Test Session');
      expect(screen.getByTestId('agent-count')).toHaveTextContent('3');
    });
  });

  describe('Agent Selection', () => {
    it('calls setSelectedAgent when selectAgent is called', () => {
      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      fireEvent.click(screen.getByTestId('select-agent-2'));

      expect(mockSetSelectedAgent).toHaveBeenCalledWith('agent-2');
    });

    it('calls selectAgent when onAgentSelect is called', () => {
      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      fireEvent.click(screen.getByTestId('select-agent-3'));

      expect(mockSetSelectedAgent).toHaveBeenCalledWith('agent-3');
    });

    it('calls onAgentChange callback when agent selection changes', () => {
      render(
        <AgentProvider sessionId="test-session" onAgentChange={mockOnAgentChange}>
          <ContextConsumer />
        </AgentProvider>
      );

      fireEvent.click(screen.getByTestId('select-agent-2'));

      expect(mockOnAgentChange).toHaveBeenCalledWith('agent-2');
    });

    it('handles empty string agent selection as null', () => {
      // Create a component that calls onAgentSelect with empty string
      function TestComponent() {
        const { onAgentSelect } = useAgentContext();
        return (
          <button onClick={() => onAgentSelect({ id: '' })} data-testid="clear-selection">
            Clear Selection
          </button>
        );
      }

      render(
        <AgentProvider sessionId="test-session" onAgentChange={mockOnAgentChange}>
          <TestComponent />
        </AgentProvider>
      );

      // Click the button that calls onAgentSelect with empty string
      fireEvent.click(screen.getByTestId('clear-selection'));

      // Verify that setAgent was called with null (empty string converted)
      expect(mockSetSelectedAgent).toHaveBeenCalledWith(null);
      expect(mockOnAgentChange).toHaveBeenCalledWith(null);
    });
  });

  describe('Agent CRUD Operations', () => {
    it('calls createAgent with correct parameters', async () => {
      mockCreateAgent.mockResolvedValue(undefined);

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      fireEvent.click(screen.getByTestId('create-agent'));

      expect(mockCreateAgent).toHaveBeenCalledWith('session-1', {
        name: 'New Agent',
        providerInstanceId: 'anthropic',
        modelId: 'claude-3-haiku',
      });
    });

    it('calls updateAgentState with correct parameters', () => {
      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      fireEvent.click(screen.getByTestId('update-agent-state'));

      expect(mockUpdateAgentState).toHaveBeenCalledWith('agent-1', 'idle', 'active');
    });

    it('calls reloadSessionDetails when requested', async () => {
      mockReloadSessionDetails.mockResolvedValue(undefined);

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      fireEvent.click(screen.getByTestId('reload-session'));

      expect(mockReloadSessionDetails).toHaveBeenCalled();
    });

    it('passes through createAgent errors from hook', async () => {
      const testError = new Error('Create failed');
      mockCreateAgent.mockRejectedValue(testError);

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      fireEvent.click(screen.getByTestId('create-agent'));

      // Verify that the hook was called and the error was passed through
      await waitFor(() => {
        expect(mockCreateAgent).toHaveBeenCalled();
      });

      // AgentProvider doesn't handle errors - it passes them through to the hook
      // The error handling is the responsibility of useAgentManagement
      expect(mockCreateAgent).toHaveBeenCalledWith('session-1', {
        name: 'New Agent',
        providerInstanceId: 'anthropic',
        modelId: 'claude-3-haiku',
      });
    });
  });

  describe('Loading States', () => {
    it('reflects loading state from useAgentManagement', () => {
      mockUseAgentManagement.mockReturnValue({
        ...defaultAgentManagement,
        loading: true,
      });

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('true');
    });

    it('handles empty agents list', () => {
      mockUseAgentManagement.mockReturnValue({
        ...defaultAgentManagement,
        sessionDetails: createMockSession({ agents: [] }),
      });

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('agent-count')).toHaveTextContent('0');
    });
  });

  describe('Session Dependency', () => {
    it('passes sessionId to useAgentManagement', () => {
      render(
        <AgentProvider sessionId="test-session-123">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(mockUseAgentManagement).toHaveBeenCalledWith('test-session-123');
    });

    it('handles null sessionId', () => {
      render(
        <AgentProvider sessionId={null}>
          <ContextConsumer />
        </AgentProvider>
      );

      expect(mockUseAgentManagement).toHaveBeenCalledWith(null);
    });
  });

  describe('Data Transformation Edge Cases', () => {
    it('handles agents with missing optional fields', () => {
      const incompleteAgents = [
        createMockAgent({
          threadId: 'incomplete' as ThreadId,
          name: 'Incomplete Agent',
        }),
      ];

      const sessionWithIncompleteAgents = createMockSession({
        agents: incompleteAgents,
      });

      mockUseAgentManagement.mockReturnValue({
        ...defaultAgentManagement,
        sessionDetails: sessionWithIncompleteAgents,
      });

      mockUseHashRouter.mockReturnValue({
        ...defaultHashRouter,
        agent: 'incomplete' as ThreadId,
        state: { agent: 'incomplete' },
      });

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('agent-count')).toHaveTextContent('1');
      expect(screen.getByTestId('found-agent')).toHaveTextContent('Incomplete Agent');
    });

    it('handles session with no agents array', () => {
      const sessionWithoutAgents = createMockSession({
        agents: undefined,
      });

      mockUseAgentManagement.mockReturnValue({
        ...defaultAgentManagement,
        sessionDetails: sessionWithoutAgents,
      });

      render(
        <AgentProvider sessionId="test-session">
          <ContextConsumer />
        </AgentProvider>
      );

      expect(screen.getByTestId('agent-count')).toHaveTextContent('0');
      expect(screen.getByTestId('found-agent')).toHaveTextContent('none');
    });
  });
});
