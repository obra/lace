// ABOUTME: Tests for AppStateProvider context that manages project/session/agent selections
// ABOUTME: Validates state management, hook integration, and prop drilling elimination

import React from 'react';
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  AppStateProvider,
  useAppState,
  useAppSelections,
  useAppProjects,
  useAppSessions,
  useAppAgents,
  useAppActions,
} from './AppStateProvider';
import type { ReactNode } from 'react';
import type { ThreadId } from '@/types/core';

// Mock all dependencies
vi.mock('@/hooks/useHashRouter');
vi.mock('@/hooks/useProjectManagement');
vi.mock('@/hooks/useSessionManagement');
vi.mock('@/hooks/useAgentManagement');

// Import and type the mocked hooks
import { useHashRouter } from '@/hooks/useHashRouter';
import { useProjectManagement } from '@/hooks/useProjectManagement';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import { useAgentManagement } from '@/hooks/useAgentManagement';

const mockUseHashRouter = useHashRouter as MockedFunction<typeof useHashRouter>;
const mockUseProjectManagement = useProjectManagement as MockedFunction<
  typeof useProjectManagement
>;
const mockUseSessionManagement = useSessionManagement as MockedFunction<
  typeof useSessionManagement
>;
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

    mockUseProjectManagement.mockReturnValue({
      projects: [],
      loading: false,
      updateProject: vi.fn(),
      reloadProjects: vi.fn(),
    });

    mockUseSessionManagement.mockReturnValue({
      sessions: [],
      loading: false,
      projectConfig: null,
      createSession: vi.fn(),
      loadProjectConfig: vi.fn(),
      reloadSessions: vi.fn(),
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
    expect(result.current.projects).toBeDefined();
    expect(result.current.sessions).toBeDefined();
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

  it('exposes project management state and actions', () => {
    const mockProjectManagement = {
      projects: [
        {
          id: 'p1',
          name: 'Project 1',
          description: 'Test project',
          workingDirectory: '/test',
          isArchived: false,
          createdAt: new Date(),
          lastUsedAt: new Date(),
        },
      ],
      loading: true,
      updateProject: vi.fn(),
      reloadProjects: vi.fn(),
    };

    mockUseProjectManagement.mockReturnValue(mockProjectManagement);

    const { result } = renderHook(() => useAppState(), { wrapper });

    expect(result.current.projects.projects).toEqual([
      {
        id: 'p1',
        name: 'Project 1',
        description: 'Test project',
        workingDirectory: '/test',
        isArchived: false,
        createdAt: expect.any(Date),
        lastUsedAt: expect.any(Date),
      },
    ]);
    expect(result.current.projects.loading).toBe(true);
    expect(result.current.actions.updateProject).toBe(mockProjectManagement.updateProject);
    expect(result.current.actions.reloadProjects).toBe(mockProjectManagement.reloadProjects);
  });

  it('exposes session management state and actions', () => {
    const mockSessionManagement = {
      sessions: [
        {
          id: 's1' as ThreadId,
          name: 'Session 1',
          createdAt: new Date(),
          agents: [],
        },
      ],
      loading: false,
      projectConfig: { theme: 'dark' },
      createSession: vi.fn(),
      loadProjectConfig: vi.fn(),
      reloadSessions: vi.fn(),
    };

    mockUseSessionManagement.mockReturnValue(mockSessionManagement);

    const { result } = renderHook(() => useAppState(), { wrapper });

    expect(result.current.sessions.sessions).toEqual([
      {
        id: 's1',
        name: 'Session 1',
        createdAt: expect.any(Date),
        agents: [],
      },
    ]);
    expect(result.current.sessions.loading).toBe(false);
    expect(result.current.sessions.projectConfig).toEqual({ theme: 'dark' });
    expect(result.current.actions.createSession).toBe(mockSessionManagement.createSession);
    expect(result.current.actions.reloadSessions).toBe(mockSessionManagement.reloadSessions);
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
    expect(() => {
      renderHook(() => useAppState());
    }).toThrow('useAppState must be used within AppStateProvider');
  });

  it('passes selected project to session management hook', () => {
    const mockHashRouter = {
      project: 'test-project',
      session: null,
      agent: null,
      setProject: vi.fn(),
      setSession: vi.fn(),
      setAgent: vi.fn(),
      updateState: vi.fn(),
      clearAll: vi.fn(),
      state: { project: 'test-project' },
      isHydrated: true,
    };

    mockUseHashRouter.mockReturnValue(mockHashRouter);

    renderHook(() => useAppState(), { wrapper });

    expect(mockUseSessionManagement).toHaveBeenCalledWith('test-project');
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

    it('useAppProjects returns only projects', () => {
      const mockProjects = [
        {
          id: 'p1',
          name: 'Project 1',
          description: 'Test project',
          workingDirectory: '/test',
          isArchived: false,
          createdAt: new Date(),
          lastUsedAt: new Date(),
        },
      ];
      mockUseProjectManagement.mockReturnValue({
        projects: mockProjects,
        loading: true,
        updateProject: vi.fn(),
        reloadProjects: vi.fn(),
      });

      const { result } = renderHook(() => useAppProjects(), { wrapper });

      expect(result.current.projects).toEqual(mockProjects);
      expect(result.current.loading).toBe(true);
    });

    it('useAppSessions returns only sessions', () => {
      const mockSessions = [
        {
          id: 's1' as ThreadId,
          name: 'Session 1',
          createdAt: new Date(),
          agents: [],
        },
      ];
      const mockConfig = { theme: 'dark' };
      mockUseSessionManagement.mockReturnValue({
        sessions: mockSessions,
        loading: false,
        projectConfig: mockConfig,
        createSession: vi.fn(),
        loadProjectConfig: vi.fn(),
        reloadSessions: vi.fn(),
      });

      const { result } = renderHook(() => useAppSessions(), { wrapper });

      expect(result.current.sessions).toEqual(mockSessions);
      expect(result.current.loading).toBe(false);
      expect(result.current.projectConfig).toEqual(mockConfig);
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

      const mockProjectActions = {
        updateProject: vi.fn(),
        reloadProjects: vi.fn(),
      };

      const mockSessionActions = {
        createSession: vi.fn(),
        reloadSessions: vi.fn(),
      };

      const mockAgentActions = {
        createAgent: vi.fn(),
        updateAgentState: vi.fn(),
        reloadSessionDetails: vi.fn(),
      };

      mockUseHashRouter.mockReturnValue(mockHashRouter);
      mockUseProjectManagement.mockReturnValue({
        projects: [],
        loading: false,
        ...mockProjectActions,
      });
      mockUseSessionManagement.mockReturnValue({
        sessions: [],
        loading: false,
        projectConfig: null,
        loadProjectConfig: vi.fn(),
        ...mockSessionActions,
      });
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

      // Project actions
      expect(result.current.updateProject).toBe(mockProjectActions.updateProject);
      expect(result.current.reloadProjects).toBe(mockProjectActions.reloadProjects);

      // Session actions
      expect(result.current.createSession).toBe(mockSessionActions.createSession);
      expect(result.current.reloadSessions).toBe(mockSessionActions.reloadSessions);

      // Agent actions
      expect(result.current.createAgent).toBe(mockAgentActions.createAgent);
      expect(result.current.updateAgentState).toBe(mockAgentActions.updateAgentState);
      expect(result.current.reloadSessionDetails).toBe(mockAgentActions.reloadSessionDetails);
    });
  });
});
