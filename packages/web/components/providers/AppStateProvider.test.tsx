// ABOUTME: Tests for AppStateProvider context that manages project/session/agent selections
// ABOUTME: Validates state management, hook integration, and prop drilling elimination

import React from 'react';
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  AppStateProvider,
  useAppState,
  useAppSelections,
  useAppAgents,
  useAppActions,
} from './AppStateProvider';
import type { ReactNode } from 'react';
import type { ThreadId } from '@/types/core';

// Mock all dependencies
vi.mock('@/hooks/useHashRouter');
vi.mock('@/hooks/useAgentManagement');

// Import and type the mocked hooks
import { useHashRouter } from '@/hooks/useHashRouter';
import { useAgentManagement } from '@/hooks/useAgentManagement';

const mockUseHashRouter = useHashRouter as MockedFunction<typeof useHashRouter>;
const mockUseAgentManagement = useAgentManagement as MockedFunction<typeof useAgentManagement>;

describe('AppStateProvider', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppStateProvider>{children}</AppStateProvider>
  );

  beforeEach(() => {
    // Set up default mock return values
    mockUseHashRouter.mockReturnValue({
      project: null,
      session: null,
      agent: null,
      setProject: vi.fn(),
      setSession: vi.fn(),
      setAgent: vi.fn(),
      updateState: vi.fn(),
      clearAll: vi.fn(),
      state: {},
      isHydrated: true,
    });

    mockUseAgentManagement.mockReturnValue({
      sessionDetails: null,
      loading: false,
      createAgent: vi.fn(),
      updateAgentState: vi.fn(),
      reloadSessionDetails: vi.fn(),
    });
  });

  it('provides app state context to children', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.selections).toBeDefined();
    expect(result.current.agents).toBeDefined();
    expect(result.current.actions).toBeDefined();
  });

  it('exposes selection state from hash router', () => {
    const mockHashRouter = {
      project: 'project-1',
      session: 'session-1' as ThreadId,
      agent: 'agent-1' as ThreadId,
      setProject: vi.fn(),
      setSession: vi.fn(),
      setAgent: vi.fn(),
      updateState: vi.fn(),
      clearAll: vi.fn(),
      state: { project: 'project-1', session: 'session-1', agent: 'agent-1' },
      isHydrated: true,
    };

    mockUseHashRouter.mockReturnValue(mockHashRouter);

    const { result } = renderHook(() => useAppState(), { wrapper });

    expect(result.current.selections.selectedProject).toBe('project-1');
    expect(result.current.selections.selectedSession).toBe('session-1');
    expect(result.current.selections.selectedAgent).toBe('agent-1');
    expect(result.current.selections.urlStateHydrated).toBe(true);
  });

  it('exposes agent management state and actions', () => {
    const mockAgentManagement = {
      sessionDetails: {
        id: 'a1' as ThreadId,
        name: 'Agent 1',
        createdAt: new Date(),
        agents: [],
      },
      loading: true,
      createAgent: vi.fn(),
      updateAgentState: vi.fn(),
      reloadSessionDetails: vi.fn(),
    };

    mockUseAgentManagement.mockReturnValue(mockAgentManagement);

    const { result } = renderHook(() => useAppState(), { wrapper });

    expect(result.current.agents.sessionDetails).toEqual({
      id: 'a1',
      name: 'Agent 1',
      createdAt: expect.any(Date),
      agents: [],
    });
    expect(result.current.agents.loading).toBe(true);
    expect(result.current.actions.createAgent).toBe(mockAgentManagement.createAgent);
    expect(result.current.actions.updateAgentState).toBe(mockAgentManagement.updateAgentState);
    expect(result.current.actions.reloadSessionDetails).toBe(
      mockAgentManagement.reloadSessionDetails
    );
  });

  it('provides selection actions from hash router', () => {
    const mockHashRouter = {
      project: null,
      session: null,
      agent: null,
      setProject: vi.fn(),
      setSession: vi.fn(),
      setAgent: vi.fn(),
      updateState: vi.fn(),
      clearAll: vi.fn(),
      state: {},
      isHydrated: true,
    };

    mockUseHashRouter.mockReturnValue(mockHashRouter);

    const { result } = renderHook(() => useAppState(), { wrapper });

    expect(result.current.actions.setSelectedProject).toBe(mockHashRouter.setProject);
    expect(result.current.actions.setSelectedSession).toBe(mockHashRouter.setSession);
    expect(result.current.actions.setSelectedAgent).toBe(mockHashRouter.setAgent);
    expect(result.current.actions.updateHashState).toBe(mockHashRouter.updateState);
  });

  it('throws error when useAppState is used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useAppState());
    }).toThrow('useAppState must be used within AppStateProvider');

    // Verify that React logged the error (error boundary behavior)
    expect(consoleSpy).toHaveBeenCalled();
    // Check that at least one call contains our error message
    const calls = consoleSpy.mock.calls.flat();
    expect(
      calls.some(
        (call) =>
          typeof call === 'string' &&
          call.includes('useAppState must be used within AppStateProvider')
      )
    ).toBe(true);

    consoleSpy.mockRestore();
  });

  it('passes selected session to agent management hook', () => {
    const mockHashRouter = {
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
    };

    mockUseHashRouter.mockReturnValue(mockHashRouter);

    renderHook(() => useAppState(), { wrapper });

    expect(mockUseAgentManagement).toHaveBeenCalledWith('test-session');
  });

  describe('convenience hooks', () => {
    it('useAppSelections returns only selections', () => {
      const mockHashRouter = {
        project: 'project-1',
        session: 'session-1' as ThreadId,
        agent: 'agent-1' as ThreadId,
        setProject: vi.fn(),
        setSession: vi.fn(),
        setAgent: vi.fn(),
        updateState: vi.fn(),
        clearAll: vi.fn(),
        state: { project: 'project-1', session: 'session-1', agent: 'agent-1' },
        isHydrated: true,
      };

      mockUseHashRouter.mockReturnValue(mockHashRouter);

      const { result } = renderHook(() => useAppSelections(), { wrapper });

      expect(result.current.selectedProject).toBe('project-1');
      expect(result.current.selectedSession).toBe('session-1');
      expect(result.current.selectedAgent).toBe('agent-1');
      expect(result.current.urlStateHydrated).toBe(true);
    });

    it('useAppAgents returns only agents', () => {
      const mockSessionDetails = {
        id: 'a1' as ThreadId,
        name: 'Agent 1',
        createdAt: new Date(),
        agents: [],
      };
      mockUseAgentManagement.mockReturnValue({
        sessionDetails: mockSessionDetails,
        loading: true,
        createAgent: vi.fn(),
        updateAgentState: vi.fn(),
        reloadSessionDetails: vi.fn(),
      });

      const { result } = renderHook(() => useAppAgents(), { wrapper });

      expect(result.current.sessionDetails).toEqual(mockSessionDetails);
      expect(result.current.loading).toBe(true);
    });

    it('useAppActions returns only actions', () => {
      const mockHashRouter = {
        project: null,
        session: null,
        agent: null,
        setProject: vi.fn(),
        setSession: vi.fn(),
        setAgent: vi.fn(),
        updateState: vi.fn(),
        clearAll: vi.fn(),
        state: {},
        isHydrated: true,
      };

      const mockAgentActions = {
        createAgent: vi.fn(),
        updateAgentState: vi.fn(),
        reloadSessionDetails: vi.fn(),
      };

      mockUseHashRouter.mockReturnValue(mockHashRouter);
      mockUseAgentManagement.mockReturnValue({
        sessionDetails: null,
        loading: false,
        ...mockAgentActions,
      });

      const { result } = renderHook(() => useAppActions(), { wrapper });

      // Selection actions
      expect(result.current.setSelectedProject).toBe(mockHashRouter.setProject);
      expect(result.current.setSelectedSession).toBe(mockHashRouter.setSession);
      expect(result.current.setSelectedAgent).toBe(mockHashRouter.setAgent);
      expect(result.current.updateHashState).toBe(mockHashRouter.updateState);

      // Agent actions
      expect(result.current.createAgent).toBe(mockAgentActions.createAgent);
      expect(result.current.updateAgentState).toBe(mockAgentActions.updateAgentState);
      expect(result.current.reloadSessionDetails).toBe(mockAgentActions.reloadSessionDetails);
    });
  });
});
