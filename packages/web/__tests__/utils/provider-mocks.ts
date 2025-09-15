// ABOUTME: Reusable mock utilities for provider contexts in tests
// ABOUTME: Provides factory functions to create properly typed mock provider contexts

import { vi } from 'vitest';
import type { SessionContextType } from '@/components/providers/SessionProvider';
import type { AgentContextType } from '@/components/providers/AgentProvider';
import type { ProjectContextType } from '@/components/providers/ProjectProvider';
import type { UseUIStateResult } from '@/hooks/useUIState';

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
    deleteSession: vi.fn<(sessionId: string) => Promise<void>>(),
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
    deleteProject: vi.fn<(projectId: string) => Promise<void>>(),
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
    // Unified sidebar state
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    toggleSidebar: vi.fn(),

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
