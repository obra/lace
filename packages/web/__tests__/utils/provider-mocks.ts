// ABOUTME: Reusable mock utilities for provider contexts in tests
// ABOUTME: Provides factory functions to create properly typed mock provider contexts

import { vi } from 'vitest';
import type { SessionContextType } from '@/components/providers/SessionProvider';
import type { AgentContextType } from '@/components/providers/AgentProvider';
import type { ProjectContextType } from '@/components/providers/ProjectProvider';

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
    loadProjectConfiguration: vi.fn(),
    reloadProjects: vi.fn(),

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
          id: 'session-1',
          name: 'Test Session',
          createdAt: new Date(),
          agents: [
            {
              threadId: 'agent-1',
              name: 'Test Agent',
              status: 'idle',
              createdAt: new Date(),
            },
          ],
        },
      ],
      selectedSession: 'session-1',
      foundSession: {
        id: 'session-1',
        name: 'Test Session',
        createdAt: new Date(),
        agents: [
          {
            threadId: 'agent-1',
            name: 'Test Agent',
            status: 'idle',
            createdAt: new Date(),
          },
        ],
      },
    }),

    // Agent with session details
    agentWithSession: createMockAgentContext({
      sessionDetails: {
        id: 'session-1',
        name: 'Test Session',
        createdAt: new Date(),
        agents: [
          {
            threadId: 'agent-1',
            name: 'Test Agent',
            status: 'idle',
            createdAt: new Date(),
          },
        ],
      },
      selectedAgent: 'agent-1',
      currentAgent: {
        threadId: 'agent-1',
        name: 'Test Agent',
        status: 'idle',
        createdAt: new Date(),
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
