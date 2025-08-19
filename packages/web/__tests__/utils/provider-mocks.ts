// ABOUTME: Reusable mock utilities for provider contexts in tests
// ABOUTME: Provides factory functions to create properly typed mock provider contexts

import { vi } from 'vitest';
import type { SessionContextType } from '@/components/providers/SessionProvider';
import type { AgentContextType } from '@/components/providers/AgentProvider';
import type { ProjectContextType } from '@/components/providers/ProjectProvider';
import type { UseUIStateResult } from '@/hooks/useUIState';
import type { ThreadId } from '@/types/core';

/**
 * Creates a mock SessionContextType with all required methods
 * @param overrides - Partial object to override default mock values
 */
export function createMockSessionContext(
  overrides?: Partial<SessionContextType>
): SessionContextType {
  return {
    // Session data
    sessions: [],
    loading: false,
    projectConfig: null,

    // Selection state
    selectedSession: null,
    foundSession: null,

    // Selection actions
    selectSession: vi.fn(),
    onSessionSelect: vi.fn(),

    // Data operations
    createSession: vi.fn(),
    loadProjectConfig: vi.fn(),
    reloadSessions: vi.fn(),
    loadSessionConfiguration: vi.fn(),
    updateSessionConfiguration: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    loadSessionsForProject: vi.fn(),

    // Agent auto-selection control
    enableAgentAutoSelection: vi.fn(),

    // Apply any overrides
    ...overrides,
  };
}

/**
 * Creates a mock AgentContextType with all required methods
 * @param overrides - Partial object to override default mock values
 */
export function createMockAgentContext(overrides?: Partial<AgentContextType>): AgentContextType {
  return {
    // Agent data
    sessionDetails: null,
    loading: false,

    // Selection state
    selectedAgent: null,
    foundAgent: null,

    // Computed agent state
    currentAgent: null,
    agentBusy: false,

    // Selection actions
    selectAgent: vi.fn(),
    onAgentSelect: vi.fn(),

    // Data operations
    createAgent: vi.fn(),
    updateAgentState: vi.fn(),
    reloadSessionDetails: vi.fn(),
    loadAgentConfiguration: vi.fn(),
    updateAgent: vi.fn(),

    // Apply any overrides
    ...overrides,
  };
}

/**
 * Creates a mock ProjectContextType with all required methods
 * @param overrides - Partial object to override default mock values
 */
export function createMockProjectContext(
  overrides?: Partial<ProjectContextType>
): ProjectContextType {
  return {
    // Project data
    projects: [],
    projectsForSidebar: [],
    currentProject: {
      id: '',
      name: 'No project selected',
      description: '',
      workingDirectory: '/',
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      sessionCount: 0,
    },
    loading: false,
    error: null,

    // Selection state
    selectedProject: null,
    foundProject: null,

    // Selection actions
    selectProject: vi.fn(),
    onProjectSelect: vi.fn(),

    // Data operations
    updateProject: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    loadProjectConfiguration: vi.fn(),
    reloadProjects: vi.fn(),

    // Apply any overrides
    ...overrides,
  };
}

/**
 * Creates a mock UseUIStateResult with all required methods
 * @param overrides - Partial object to override default mock values
 */
export function createMockUIContext(overrides?: Partial<UseUIStateResult>): UseUIStateResult {
  return {
    // Navigation state
    showMobileNav: false,
    showDesktopSidebar: true,
    setShowMobileNav: vi.fn(),
    setShowDesktopSidebar: vi.fn(),
    toggleDesktopSidebar: vi.fn(),

    // Modal state
    autoOpenCreateProject: false,
    setAutoOpenCreateProject: vi.fn(),

    // Loading state
    loading: false,
    setLoading: vi.fn(),

    // Apply any overrides
    ...overrides,
  };
}

/**
 * Convenience function to create common test scenario mocks
 */
export function createTestScenarios() {
  return {
    // Session with agents
    sessionWithAgents: createMockSessionContext({
      sessions: [
        {
          id: 'lace_20250801_test01' as ThreadId,
          name: 'Test Session',
          createdAt: new Date(),
          agents: [
            {
              threadId: 'lace_20250801_test01.1' as ThreadId,
              name: 'Test Agent',
              providerInstanceId: 'test-provider',
              modelId: 'test-model',
              status: 'idle',
            },
          ],
        },
      ],
      selectedSession: 'lace_20250801_test01',
      foundSession: {
        id: 'lace_20250801_test01' as ThreadId,
        name: 'Test Session',
        createdAt: new Date(),
        agents: [
          {
            threadId: 'lace_20250801_test01.1' as ThreadId,
            name: 'Test Agent',
            providerInstanceId: 'test-provider',
            modelId: 'test-model',
            status: 'idle',
          },
        ],
      },
    }),

    // Agent with session details
    agentWithSession: createMockAgentContext({
      sessionDetails: {
        id: 'lace_20250801_test01' as ThreadId,
        name: 'Test Session',
        createdAt: new Date(),
        agents: [
          {
            threadId: 'lace_20250801_test01.1' as ThreadId,
            name: 'Test Agent',
            providerInstanceId: 'test-provider',
            modelId: 'test-model',
            status: 'idle',
          },
        ],
      },
      selectedAgent: 'lace_20250801_test01.1' as ThreadId,
      currentAgent: {
        threadId: 'lace_20250801_test01.1' as ThreadId,
        name: 'Test Agent',
        providerInstanceId: 'test-provider',
        modelId: 'test-model',
        status: 'idle',
      },
    }),

    // Project with configuration
    projectWithConfig: createMockProjectContext({
      projects: [
        {
          id: 'project-1',
          name: 'Test Project',
          description: 'Test Description',
          workingDirectory: '/test/path',
          isArchived: false,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          sessionCount: 2,
        },
      ],
      currentProject: {
        id: 'project-1',
        name: 'Test Project',
        description: 'Test Description',
        workingDirectory: '/test/path',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 2,
      },
      selectedProject: 'project-1',
    }),
  };
}
