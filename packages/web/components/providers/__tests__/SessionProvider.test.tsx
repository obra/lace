// ABOUTME: Integration tests for SessionProvider focusing on real provider responsibilities
// ABOUTME: Tests session agent data management, selection handling, and CRUD operations

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SessionProvider, useSessionContext } from '@/components/providers/SessionProvider';
import type { SessionInfo, AgentInfo, ThreadId } from '@/types/core';
import { createMockAgentInfo } from '@/__tests__/utils/agent-mocks';

const TEST_SESSION_ID = 'test-session';

// Mock the hooks
vi.mock('@/hooks/useAgentManagement', () => ({
  useAgentManagement: vi.fn(),
}));

// SessionProvider now uses selectedAgentId prop instead of hash router

import { useAgentManagement } from '@/hooks/useAgentManagement';

const mockUseAgentManagement = vi.mocked(useAgentManagement);

// Test data factories
const createMockAgent = (overrides?: Partial<AgentInfo>): AgentInfo =>
  createMockAgentInfo({
    threadId: 'lace_20240101_agent1' as ThreadId,
    name: 'Test Agent',
    providerInstanceId: 'test-provider',
    modelId: 'test-model',
    status: 'idle',
    ...overrides,
  });

const createMockSession = (overrides?: Partial<SessionInfo>): SessionInfo => ({
  id: 'lace_20240101_sess01' as ThreadId,
  name: 'Test Session',
  createdAt: new Date('2024-01-01'),
  agents: [
    createMockAgent({ threadId: 'lace_20240101_agent1' as ThreadId, name: 'Agent One' }),
    createMockAgent({ threadId: 'lace_20240101_agent2' as ThreadId, name: 'Agent Two' }),
    createMockAgent({ threadId: 'lace_20240101_agent3' as ThreadId, name: 'Agent Three' }),
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
  } = useSessionContext();

  return (
    <div>
      <div data-testid="session-name">{sessionDetails?.name || 'none'}</div>
      <div data-testid="agent-count">{sessionDetails?.agents?.length || 0}</div>
      <div data-testid="loading">{loading.toString()}</div>
      <div data-testid="selected-agent">{selectedAgent || 'none'}</div>
      <div data-testid="found-agent">{foundAgent?.name || 'none'}</div>

      <button onClick={() => selectAgent('lace_20240101_agent2')} data-testid="select-agent-2">
        Select Agent 2
      </button>
      <button
        onClick={() => onAgentSelect({ id: 'lace_20240101_agent3' })}
        data-testid="select-agent-3"
      >
        Select Agent 3
      </button>
      <button
        onClick={() =>
          createAgent(TEST_SESSION_ID, {
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
        onClick={() => updateAgentState('lace_20240101_agent1', 'thinking')}
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

describe('SessionProvider', () => {
  const mockCreateAgent = vi.fn();
  const mockUpdateAgentState = vi.fn();
  const mockReloadSessionDetails = vi.fn();
  // Mock for onAgentChange callback
  const mockOnAgentChangeCallback = vi.fn();

  const defaultAgentManagement = {
    sessionDetails: mockSessionDetails,
    loading: false,
    createAgent: mockCreateAgent,
    updateAgentState: mockUpdateAgentState,
    reloadSessionDetails: mockReloadSessionDetails,
    loadAgentConfiguration: vi.fn(),
    updateAgent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAgentManagement.mockReturnValue(defaultAgentManagement);
  });

  describe('Context Provision', () => {
    it('provides agent context to children', () => {
      render(
        <SessionProvider sessionId="test-session" selectedAgentId="lace_20240101_agent1">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('session-name')).toHaveTextContent('Test Session');
      expect(screen.getByTestId('agent-count')).toHaveTextContent('3');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('selected-agent')).toHaveTextContent('lace_20240101_agent1');
      expect(screen.getByTestId('found-agent')).toHaveTextContent('Agent One');
    });

    it('throws error when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ContextConsumer />);
      }).toThrow('useSessionContext must be used within a SessionProvider');

      // Verify that React logged the error (error boundary behavior)
      expect(consoleSpy).toHaveBeenCalled();
      // Check that at least one call contains our error message
      const calls = consoleSpy.mock.calls.flat();
      expect(
        calls.some(
          (call) =>
            typeof call === 'string' &&
            call.includes('useSessionContext must be used within a SessionProvider')
        )
      ).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('Agent Data Management', () => {
    it('provides found agent data when agent is selected', () => {
      render(
        <SessionProvider sessionId="test-session" selectedAgentId="lace_20240101_agent1">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('found-agent')).toHaveTextContent('Agent One');
    });

    it('provides null found agent when no agent is selected', () => {
      render(
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('found-agent')).toHaveTextContent('none');
    });

    it('provides null found agent when selected agent not found', () => {
      render(
        <SessionProvider sessionId="test-session" selectedAgentId="lace_20240101_notfnd">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('found-agent')).toHaveTextContent('none');
    });

    it('provides null found agent when no session details', () => {
      mockUseAgentManagement.mockReturnValue({
        ...defaultAgentManagement,
        sessionDetails: null,
      });

      render(
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('found-agent')).toHaveTextContent('none');
      expect(screen.getByTestId('session-name')).toHaveTextContent('none');
    });

    it('displays session details when available', () => {
      render(
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('session-name')).toHaveTextContent('Test Session');
      expect(screen.getByTestId('agent-count')).toHaveTextContent('3');
    });
  });

  describe('Agent Selection', () => {
    it('calls onAgentChange when selectAgent is called', () => {
      render(
        <SessionProvider
          sessionId="test-session"
          selectedAgentId={null}
          onAgentChange={mockOnAgentChangeCallback}
        >
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('select-agent-2'));

      expect(mockOnAgentChangeCallback).toHaveBeenCalledWith('lace_20240101_agent2');
    });

    it('calls selectAgent when onAgentSelect is called', () => {
      render(
        <SessionProvider
          sessionId="test-session"
          selectedAgentId={null}
          onAgentChange={mockOnAgentChangeCallback}
        >
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('select-agent-3'));

      expect(mockOnAgentChangeCallback).toHaveBeenCalledWith('lace_20240101_agent3');
    });

    it('calls onAgentChange callback when agent selection changes', () => {
      render(
        <SessionProvider sessionId="test-session" onAgentChange={mockOnAgentChangeCallback}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('select-agent-2'));

      expect(mockOnAgentChangeCallback).toHaveBeenCalledWith('lace_20240101_agent2');
    });

    it('handles empty string agent selection as null', () => {
      // Create a component that calls onAgentSelect with empty string
      function TestComponent() {
        const { onAgentSelect } = useSessionContext();
        return (
          <button onClick={() => onAgentSelect({ id: '' })} data-testid="clear-selection">
            Clear Selection
          </button>
        );
      }

      render(
        <SessionProvider sessionId="test-session" onAgentChange={mockOnAgentChangeCallback}>
          <TestComponent />
        </SessionProvider>
      );

      // Click the button that calls onAgentSelect with empty string
      fireEvent.click(screen.getByTestId('clear-selection'));

      // Verify that onAgentChange was called with null (empty string converted)
      expect(mockOnAgentChangeCallback).toHaveBeenCalledWith(null);
    });
  });

  describe('Agent CRUD Operations', () => {
    it('calls createAgent with correct parameters', async () => {
      mockCreateAgent.mockResolvedValue(undefined);

      render(
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('create-agent'));

      expect(mockCreateAgent).toHaveBeenCalledWith(TEST_SESSION_ID, {
        name: 'New Agent',
        providerInstanceId: 'anthropic',
        modelId: 'claude-3-haiku',
      });
    });

    it('calls updateAgentState with correct parameters', () => {
      render(
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('update-agent-state'));

      expect(mockUpdateAgentState).toHaveBeenCalledWith('lace_20240101_agent1', 'thinking');
    });

    it('calls reloadSessionDetails when requested', async () => {
      mockReloadSessionDetails.mockResolvedValue(undefined);

      render(
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('reload-session'));

      expect(mockReloadSessionDetails).toHaveBeenCalled();
    });

    it('passes through createAgent errors from hook', async () => {
      const testError = new Error('Create failed');
      mockCreateAgent.mockRejectedValue(testError);

      render(
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('create-agent'));

      // Verify that the hook was called and the error was passed through
      await waitFor(() => {
        expect(mockCreateAgent).toHaveBeenCalled();
      });

      // SessionProvider doesn't handle errors - it passes them through to the hook
      // The error handling is the responsibility of useAgentManagement
      expect(mockCreateAgent).toHaveBeenCalledWith(TEST_SESSION_ID, {
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
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('true');
    });

    it('handles empty agents list', () => {
      mockUseAgentManagement.mockReturnValue({
        ...defaultAgentManagement,
        sessionDetails: createMockSession({ agents: [] }),
      });

      render(
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('agent-count')).toHaveTextContent('0');
    });
  });

  describe('Session Dependency', () => {
    it('passes sessionId to useAgentManagement', () => {
      render(
        <SessionProvider sessionId="test-session-123">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(mockUseAgentManagement).toHaveBeenCalledWith('test-session-123');
    });

    it('handles null sessionId', () => {
      render(
        <SessionProvider sessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(mockUseAgentManagement).toHaveBeenCalledWith(null);
    });
  });

  describe('Data Transformation Edge Cases', () => {
    it('handles agents with missing optional fields', () => {
      const incompleteAgents = [
        createMockAgent({
          threadId: 'lace_20240101_incomp' as ThreadId,
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

      render(
        <SessionProvider sessionId="test-session" selectedAgentId="lace_20240101_incomp">
          <ContextConsumer />
        </SessionProvider>
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
        <SessionProvider sessionId="test-session" selectedAgentId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('agent-count')).toHaveTextContent('0');
      expect(screen.getByTestId('found-agent')).toHaveTextContent('none');
    });
  });
});
