// ABOUTME: Mock session and context utilities for testing
// ABOUTME: Provides standardized mock objects for session-based tests

import { ToolContext } from '~/tools/types';
import { Session } from '~/sessions/session';
import type { Agent } from '~/agents/agent';
import type { ToolPolicy } from '~/tools/types';

interface MockSession {
  getToolPolicy: (toolName: string) => ToolPolicy;
  getEffectiveConfiguration: () => Record<string, unknown>;
  getId: () => string;
  getProjectId: () => string | undefined;
  getSessionTempDir: () => string;
  [key: string]: unknown;
}

/**
 * Creates a mock Session for tool testing
 * @param overrides - Optional overrides for specific methods
 * @returns A mock Session object with default test behavior
 */
function createMockSession(
  overrides: {
    getToolPolicy?: (toolName: string) => ToolPolicy;
    getEffectiveConfiguration?: () => Record<string, unknown>;
    getId?: () => string;
    getProjectId?: () => string | undefined;
    getSessionTempDir?: () => string;
    [key: string]: unknown;
  } = {}
): MockSession {
  return {
    getToolPolicy: overrides.getToolPolicy || (() => 'require-approval'),
    getEffectiveConfiguration: overrides.getEffectiveConfiguration || (() => ({})),
    getId: overrides.getId || (() => 'lace_20250101_sess01'),
    getProjectId: overrides.getProjectId || (() => 'mock-project-id'),
    getSessionTempDir: overrides.getSessionTempDir || (() => '/tmp/mock-session-temp-dir'),
    ...overrides,
  };
}

/**
 * Creates a complete ToolContext for testing
 * @param overrides - Optional overrides for context properties
 * @returns A ToolContext with mock agent containing session access
 */
export function createMockToolContext(
  overrides: {
    workingDirectory?: string;
    toolTempDir?: string;
    session?: Session;
    agent?: Agent;
  } = {}
): ToolContext {
  const mockSession = overrides.session || (createMockSession() as unknown as Session);

  // Create minimal mock agent if not provided
  const mockAgent =
    overrides.agent ||
    ({
      threadId: 'lace_20250101_test01',
      getFullSession: () => mockSession,
    } as unknown as Agent);

  return {
    workingDirectory: overrides.workingDirectory,
    toolTempDir: overrides.toolTempDir,
    agent: mockAgent,
    signal: new AbortController().signal,
  };
}
