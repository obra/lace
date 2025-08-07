// ABOUTME: Mock session and context utilities for testing
// ABOUTME: Provides standardized mock objects for session-based tests

import { ToolContext } from '~/tools/types';
import { asThreadId } from '~/threads/types';
import { Session } from '~/sessions/session';

interface MockSession {
  getToolPolicy: (toolName: string) => 'allow' | 'require-approval' | 'deny';
  getEffectiveConfiguration: () => Record<string, unknown>;
  getId: () => string;
  [key: string]: unknown;
}

/**
 * Creates a mock Session for tool testing
 * @param overrides - Optional overrides for specific methods
 * @returns A mock Session object with default test behavior
 */
export function createMockSession(
  overrides: {
    getToolPolicy?: (toolName: string) => 'allow' | 'require-approval' | 'deny';
    getEffectiveConfiguration?: () => Record<string, unknown>;
    getId?: () => string;
    [key: string]: unknown;
  } = {}
): MockSession {
  return {
    getToolPolicy: overrides.getToolPolicy || (() => 'require-approval'),
    getEffectiveConfiguration: overrides.getEffectiveConfiguration || (() => ({})),
    getId: overrides.getId || (() => 'lace_20250101_sess01'),
    ...overrides,
  };
}

/**
 * Creates a complete ToolContext for testing with mock session
 * @param overrides - Optional overrides for context properties
 * @returns A ToolContext with all required properties including mock session
 */
export function createMockToolContext(
  overrides: {
    threadId?: string;
    workingDirectory?: string;
    projectId?: string;
    parentThreadId?: string;
    session?: Session;
  } = {}
): ToolContext {
  return {
    threadId: asThreadId(overrides.threadId || 'lace_20250101_test01'),
    workingDirectory: overrides.workingDirectory, // Allow explicitly undefined
    projectId: overrides.projectId,
    parentThreadId: overrides.parentThreadId ? asThreadId(overrides.parentThreadId) : undefined,
    session: overrides.session || (createMockSession() as unknown as Session),
  };
}