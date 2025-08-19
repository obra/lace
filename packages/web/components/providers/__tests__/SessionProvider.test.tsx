// ABOUTME: Integration tests for SessionProvider focusing on real provider responsibilities
// ABOUTME: Tests session data management, selection handling, and CRUD operations

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SessionProvider, useSessionContext } from '@/components/providers/SessionProvider';
import type { SessionInfo, ThreadId } from '@/types/core';

// Mock the hooks
vi.mock('@/hooks/useSessionManagement', () => ({
  useSessionManagement: vi.fn(),
}));

// SessionProvider now uses selectedSessionId prop instead of hash router

import { useSessionManagement } from '@/hooks/useSessionManagement';

const mockUseSessionManagement = vi.mocked(useSessionManagement);

// Test data factories
const createMockSession = (overrides?: Partial<SessionInfo>): SessionInfo => ({
  id: 'lace_20240101_sess01' as ThreadId,
  name: 'Test Session',
  createdAt: new Date('2024-01-01'),
  agents: [],
  ...overrides,
});

const mockSessions: SessionInfo[] = [
  createMockSession({ id: 'lace_20240101_sess01' as ThreadId, name: 'Session One' }),
  createMockSession({ id: 'lace_20240101_sess02' as ThreadId, name: 'Session Two' }),
  createMockSession({ id: 'lace_20240101_sess03' as ThreadId, name: 'Session Three' }),
];

// Component to test context provision
function ContextConsumer() {
  const {
    sessions,
    loading,
    projectConfig,
    selectedSession,
    foundSession,
    selectSession,
    onSessionSelect,
    createSession,
    loadProjectConfig,
    reloadSessions,
    enableAgentAutoSelection,
  } = useSessionContext();

  return (
    <div>
      <div data-testid="session-count">{sessions.length}</div>
      <div data-testid="loading">{loading.toString()}</div>
      <div data-testid="project-config">{projectConfig ? 'exists' : 'none'}</div>
      <div data-testid="selected-session">{selectedSession || 'none'}</div>
      <div data-testid="found-session">{foundSession?.name || 'none'}</div>

      <button onClick={() => selectSession('lace_20240101_sess02')} data-testid="select-session-2">
        Select Session 2
      </button>
      <button
        onClick={() => onSessionSelect({ id: 'lace_20240101_sess03' })}
        data-testid="select-session-3"
      >
        Select Session 3
      </button>
      <button onClick={() => createSession({ name: 'New Session' })} data-testid="create-session">
        Create Session
      </button>
      <button onClick={() => void loadProjectConfig()} data-testid="load-project-config">
        Load Config
      </button>
      <button onClick={() => void reloadSessions()} data-testid="reload-sessions">
        Reload Sessions
      </button>
      <button onClick={() => enableAgentAutoSelection()} data-testid="enable-auto-selection">
        Enable Auto Selection
      </button>
    </div>
  );
}

describe('SessionProvider', () => {
  const mockCreateSession = vi.fn();
  const mockLoadProjectConfig = vi.fn();
  const mockReloadSessions = vi.fn();
  // Mock for onSessionChange callback
  const mockOnSessionChangeCallback = vi.fn();

  const defaultSessionManagement = {
    sessions: mockSessions,
    loading: false,
    projectConfig: null,
    createSession: mockCreateSession,
    loadProjectConfig: mockLoadProjectConfig,
    reloadSessions: mockReloadSessions,
    loadSessionConfiguration: vi.fn(),
    updateSessionConfiguration: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    loadSessionsForProject: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionManagement.mockReturnValue(defaultSessionManagement);
  });

  describe('Context Provision', () => {
    it('provides session context to children', () => {
      render(
        <SessionProvider projectId="test-project" selectedSessionId="lace_20240101_sess01">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('session-count')).toHaveTextContent('3');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('project-config')).toHaveTextContent('none');
      expect(screen.getByTestId('selected-session')).toHaveTextContent('lace_20240101_sess01');
      expect(screen.getByTestId('found-session')).toHaveTextContent('Session One');
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

  describe('Session Data Management', () => {
    it('provides found session data when session is selected', () => {
      render(
        <SessionProvider projectId="test-project" selectedSessionId="lace_20240101_sess01">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('found-session')).toHaveTextContent('Session One');
    });

    it('provides null found session when no session is selected', () => {
      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('found-session')).toHaveTextContent('none');
    });

    it('provides null found session when selected session not found', () => {
      render(
        <SessionProvider projectId="test-project" selectedSessionId="lace_20240101_notfnd">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('found-session')).toHaveTextContent('none');
    });

    it('displays project configuration when available', () => {
      mockUseSessionManagement.mockReturnValue({
        ...defaultSessionManagement,
        projectConfig: { theme: 'dark' },
      });

      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('project-config')).toHaveTextContent('exists');
    });
  });

  describe('Session Selection', () => {
    it('calls onSessionChange when selectSession is called', () => {
      render(
        <SessionProvider
          projectId="test-project"
          selectedSessionId={null}
          onSessionChange={mockOnSessionChangeCallback}
        >
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('select-session-2'));

      expect(mockOnSessionChangeCallback).toHaveBeenCalledWith('lace_20240101_sess02');
    });

    it('calls selectSession when onSessionSelect is called', () => {
      render(
        <SessionProvider
          projectId="test-project"
          selectedSessionId={null}
          onSessionChange={mockOnSessionChangeCallback}
        >
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('select-session-3'));

      expect(mockOnSessionChangeCallback).toHaveBeenCalledWith('lace_20240101_sess03');
    });

    it('calls onSessionChange callback when session selection changes', () => {
      render(
        <SessionProvider
          projectId="test-project"
          selectedSessionId={null}
          onSessionChange={mockOnSessionChangeCallback}
        >
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('select-session-2'));

      expect(mockOnSessionChangeCallback).toHaveBeenCalledWith('lace_20240101_sess02');
    });

    it('handles empty string session selection as null', () => {
      // Create a component that calls onSessionSelect with empty string
      function TestComponent() {
        const { onSessionSelect } = useSessionContext();
        return (
          <button onClick={() => onSessionSelect({ id: '' })} data-testid="clear-selection">
            Clear Selection
          </button>
        );
      }

      render(
        <SessionProvider
          projectId="test-project"
          selectedSessionId={null}
          onSessionChange={mockOnSessionChangeCallback}
        >
          <TestComponent />
        </SessionProvider>
      );

      // Click the button that calls onSessionSelect with empty string
      fireEvent.click(screen.getByTestId('clear-selection'));

      // Verify that onSessionChange was called with null (empty string converted)
      expect(mockOnSessionChangeCallback).toHaveBeenCalledWith(null);
    });
  });

  describe('Session CRUD Operations', () => {
    it('calls createSession with correct parameters', async () => {
      mockCreateSession.mockResolvedValue(undefined);

      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('create-session'));

      expect(mockCreateSession).toHaveBeenCalledWith({ name: 'New Session' });
    });

    it('calls loadProjectConfig when requested', async () => {
      mockLoadProjectConfig.mockResolvedValue(undefined);

      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('load-project-config'));

      expect(mockLoadProjectConfig).toHaveBeenCalled();
    });

    it('calls reloadSessions when requested', async () => {
      mockReloadSessions.mockResolvedValue(undefined);

      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('reload-sessions'));

      expect(mockReloadSessions).toHaveBeenCalled();
    });

    it('passes through createSession errors from hook', async () => {
      const testError = new Error('Create failed');
      mockCreateSession.mockRejectedValue(testError);

      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      fireEvent.click(screen.getByTestId('create-session'));

      // Verify that the hook was called and the error was passed through
      await waitFor(() => {
        expect(mockCreateSession).toHaveBeenCalled();
      });

      // SessionProvider doesn't handle errors - it passes them through to the hook
      // The error handling is the responsibility of useSessionManagement
      expect(mockCreateSession).toHaveBeenCalledWith({ name: 'New Session' });
    });
  });

  describe('Loading States', () => {
    it('reflects loading state from useSessionManagement', () => {
      mockUseSessionManagement.mockReturnValue({
        ...defaultSessionManagement,
        loading: true,
      });

      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('true');
    });

    it('handles empty sessions list', () => {
      mockUseSessionManagement.mockReturnValue({
        ...defaultSessionManagement,
        sessions: [],
      });

      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('session-count')).toHaveTextContent('0');
    });
  });

  describe('Project Dependency', () => {
    it('passes projectId to useSessionManagement', () => {
      render(
        <SessionProvider projectId="test-project-123">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(mockUseSessionManagement).toHaveBeenCalledWith('test-project-123');
    });

    it('handles null projectId', () => {
      render(
        <SessionProvider projectId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(mockUseSessionManagement).toHaveBeenCalledWith(null);
    });
  });

  describe('Data Transformation Edge Cases', () => {
    it('handles sessions with missing optional fields', () => {
      const incompleteSessions = [
        createMockSession({
          id: 'lace_20240101_incomp' as ThreadId,
          name: 'Incomplete Session',
          agents: undefined,
        }),
      ];

      mockUseSessionManagement.mockReturnValue({
        ...defaultSessionManagement,
        sessions: incompleteSessions,
      });

      render(
        <SessionProvider projectId="test-project" selectedSessionId="lace_20240101_incomp">
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('session-count')).toHaveTextContent('1');
      expect(screen.getByTestId('found-session')).toHaveTextContent('Incomplete Session');
    });
  });

  describe('Agent Auto-Selection', () => {
    it('provides enableAgentAutoSelection function', () => {
      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(screen.getByTestId('enable-auto-selection')).toBeInTheDocument();
    });

    it('calls enableAgentAutoSelection without errors', () => {
      render(
        <SessionProvider projectId="test-project" selectedSessionId={null}>
          <ContextConsumer />
        </SessionProvider>
      );

      expect(() => {
        fireEvent.click(screen.getByTestId('enable-auto-selection'));
      }).not.toThrow();
    });

    // Note: Full auto-selection behavior testing would require integration with
    // hash router and session details with agents, which is better tested at the
    // integration level since it involves multiple providers working together
  });
});
