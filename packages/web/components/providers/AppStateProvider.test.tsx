// ABOUTME: Tests for AppStateProvider context that manages hash router selections
// ABOUTME: Validates state management, hash router integration, and prop drilling elimination

import React from 'react';
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AppStateProvider, useAppState, useAppSelections, useAppActions } from './AppStateProvider';
import type { ReactNode } from 'react';
import type { ThreadId } from '@/types/core';

// Mock all dependencies
vi.mock('@/hooks/useHashRouter');

// Import and type the mocked hooks
import { useHashRouter } from '@/hooks/useHashRouter';

const mockUseHashRouter = useHashRouter as MockedFunction<typeof useHashRouter>;

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
  });

  it('provides app state context to children', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.selections).toBeDefined();
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
    expect(result.current.actions.clearAll).toBe(mockHashRouter.clearAll);
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

      mockUseHashRouter.mockReturnValue(mockHashRouter);

      const { result } = renderHook(() => useAppActions(), { wrapper });

      // Selection actions
      expect(result.current.setSelectedProject).toBe(mockHashRouter.setProject);
      expect(result.current.setSelectedSession).toBe(mockHashRouter.setSession);
      expect(result.current.setSelectedAgent).toBe(mockHashRouter.setAgent);
      expect(result.current.updateHashState).toBe(mockHashRouter.updateState);
      expect(result.current.clearAll).toBe(mockHashRouter.clearAll);
    });
  });
});
