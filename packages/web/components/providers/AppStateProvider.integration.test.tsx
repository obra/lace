// ABOUTME: Integration tests for AppStateProvider with LaceApp component
// ABOUTME: Tests actual integration behavior and prop drilling elimination

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppStateProvider, useAppState } from './AppStateProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import type { ThreadId } from '@/types/core';

// Mock all the hooks that AppStateProvider depends on
vi.mock('@/hooks/useHashRouter');
vi.mock('@/hooks/useSessionManagement');
vi.mock('@/hooks/useAgentManagement');

import { useHashRouter } from '@/hooks/useHashRouter';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import { useAgentManagement } from '@/hooks/useAgentManagement';

// Test component that consumes app state without receiving it through props
function TestConsumerComponent() {
  const { selections, sessions, agents, actions } = useAppState();

  return (
    <div>
      <div data-testid="selected-project">{selections.selectedProject || 'none'}</div>
      <div data-testid="selected-session">{selections.selectedSession || 'none'}</div>
      <div data-testid="selected-agent">{selections.selectedAgent || 'none'}</div>
      <div data-testid="sessions-count">{sessions.sessions.length}</div>
      <div data-testid="sessions-loading">{sessions.loading.toString()}</div>
      <div data-testid="agents-loading">{agents.loading.toString()}</div>
      <button
        data-testid="set-project-button"
        onClick={() => actions.setSelectedProject('new-project')}
      >
        Set Project
      </button>
    </div>
  );
}

// Test component that should fail without provider
function TestComponentWithoutProvider() {
  const { selections } = useAppState();
  return <div data-testid="selections">{selections.selectedProject}</div>;
}

describe('AppStateProvider Integration', () => {
  const mockSetProject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    vi.mocked(useHashRouter).mockReturnValue({
      project: null,
      session: null,
      agent: null,
      setProject: mockSetProject,
      setSession: vi.fn(),
      setAgent: vi.fn(),
      updateState: vi.fn(),
      clearAll: vi.fn(),
      state: {},
      isHydrated: true,
    });

    vi.mocked(useSessionManagement).mockReturnValue({
      sessions: [],
      loading: false,
      projectConfig: null,
      createSession: vi.fn(),
      loadProjectConfig: vi.fn(),
      reloadSessions: vi.fn(),
    });

    vi.mocked(useAgentManagement).mockReturnValue({
      sessionDetails: null,
      loading: false,
      createAgent: vi.fn(),
      updateAgentState: vi.fn(),
      reloadSessionDetails: vi.fn(),
    });
  });

  it('provides app state to deeply nested components without prop drilling', () => {
    // Setup test data
    vi.mocked(useHashRouter).mockReturnValue({
      project: 'test-project',
      session: 'test-session' as ThreadId,
      agent: 'test-agent' as ThreadId,
      setProject: mockSetProject,
      setSession: vi.fn(),
      setAgent: vi.fn(),
      updateState: vi.fn(),
      clearAll: vi.fn(),
      state: { project: 'test-project', session: 'test-session', agent: 'test-agent' },
      isHydrated: true,
    });

    vi.mocked(useSessionManagement).mockReturnValue({
      sessions: [
        {
          id: 's1' as ThreadId,
          name: 'Session 1',
          createdAt: new Date(),
          agents: [],
        },
      ],
      loading: false,
      projectConfig: null,
      createSession: vi.fn(),
      loadProjectConfig: vi.fn(),
      reloadSessions: vi.fn(),
    });

    vi.mocked(useAgentManagement).mockReturnValue({
      sessionDetails: null,
      loading: true,
      createAgent: vi.fn(),
      updateAgentState: vi.fn(),
      reloadSessionDetails: vi.fn(),
    });

    render(
      <ThemeProvider>
        <AppStateProvider>
          <div>
            <div>
              <div>
                <TestConsumerComponent />
              </div>
            </div>
          </div>
        </AppStateProvider>
      </ThemeProvider>
    );

    // Verify state is accessible without prop drilling
    expect(screen.getByTestId('selected-project')).toHaveTextContent('test-project');
    expect(screen.getByTestId('selected-session')).toHaveTextContent('test-session');
    expect(screen.getByTestId('selected-agent')).toHaveTextContent('test-agent');
    expect(screen.getByTestId('sessions-count')).toHaveTextContent('1');
    expect(screen.getByTestId('sessions-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('agents-loading')).toHaveTextContent('true');
  });

  it('allows actions to be called from deeply nested components', async () => {
    const userEvent = await import('@testing-library/user-event');
    const user = userEvent.default.setup();

    render(
      <ThemeProvider>
        <AppStateProvider>
          <div>
            <div>
              <div>
                <TestConsumerComponent />
              </div>
            </div>
          </div>
        </AppStateProvider>
      </ThemeProvider>
    );

    // Test action calls work without prop drilling
    await user.click(screen.getByTestId('set-project-button'));
    expect(mockSetProject).toHaveBeenCalledWith('new-project');
  });

  it('throws error when useAppState is used outside provider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(
        <ThemeProvider>
          <TestComponentWithoutProvider />
        </ThemeProvider>
      );
    }).toThrow('useAppState must be used within AppStateProvider');

    consoleSpy.mockRestore();
  });

  it('updates state when underlying hooks change', () => {
    const { rerender } = render(
      <ThemeProvider>
        <AppStateProvider>
          <TestConsumerComponent />
        </AppStateProvider>
      </ThemeProvider>
    );

    // Initially shows no project
    expect(screen.getByTestId('selected-project')).toHaveTextContent('none');

    // Mock hook returns different value
    vi.mocked(useHashRouter).mockReturnValue({
      project: 'updated-project',
      session: null,
      agent: null,
      setProject: mockSetProject,
      setSession: vi.fn(),
      setAgent: vi.fn(),
      updateState: vi.fn(),
      clearAll: vi.fn(),
      state: { project: 'updated-project' },
      isHydrated: true,
    });

    // Force re-render with new mock data
    rerender(
      <ThemeProvider>
        <AppStateProvider>
          <TestConsumerComponent />
        </AppStateProvider>
      </ThemeProvider>
    );

    // Should reflect updated state
    expect(screen.getByTestId('selected-project')).toHaveTextContent('updated-project');
  });

  it('passes correct parameters to underlying hooks based on selections', () => {
    vi.mocked(useHashRouter).mockReturnValue({
      project: 'test-project',
      session: 'test-session' as ThreadId,
      agent: null,
      setProject: vi.fn(),
      setSession: vi.fn(),
      setAgent: vi.fn(),
      updateState: vi.fn(),
      clearAll: vi.fn(),
      state: { project: 'test-project', session: 'test-session' },
      isHydrated: true,
    });

    render(
      <ThemeProvider>
        <AppStateProvider>
          <TestConsumerComponent />
        </AppStateProvider>
      </ThemeProvider>
    );

    // Verify hooks are called with correct parameters
    expect(useSessionManagement).toHaveBeenCalledWith('test-project');
    expect(useAgentManagement).toHaveBeenCalledWith('test-session');
  });
});
