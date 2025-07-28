// ABOUTME: Test utilities for tool testing
// ABOUTME: Provides helper functions to create ToolCall objects for tests

import { ToolCall, ToolContext } from '~/tools/types';
import { asThreadId } from '~/threads/types';

/**
 * Creates a ToolCall object for testing
 * @param name - The tool name
 * @param args - The arguments to pass to the tool
 * @param id - Optional tool call ID (defaults to 'test-id')
 * @returns A ToolCall object
 */
export function createTestToolCall(
  name: string,
  args: Record<string, unknown>,
  id: string = 'test-id'
): ToolCall {
  return {
    id,
    name,
    arguments: args,
  };
}

/**
 * Helper to create a ToolCall with a specific tool name
 * Useful for creating tool-specific test helpers
 */
export function createToolCallFactory(toolName: string) {
  return (args: Record<string, unknown>, id?: string) => createTestToolCall(toolName, args, id);
}

// Re-export temp directory utilities for convenience
export { createTempDir, createTestTempDir, withTempDir } from './temp-utils';

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
): any {
  return {
    getToolPolicy: overrides.getToolPolicy || (() => 'require-approval'),
    getEffectiveConfiguration: overrides.getEffectiveConfiguration || (() => ({})),
    getId: overrides.getId || (() => 'test-session-id'),
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
    session?: any;
  } = {}
): ToolContext {
  return {
    threadId: asThreadId(overrides.threadId || 'test-thread-id'),
    workingDirectory: overrides.workingDirectory, // Allow explicitly undefined
    projectId: overrides.projectId,
    parentThreadId: overrides.parentThreadId ? asThreadId(overrides.parentThreadId) : undefined,
    session: overrides.session || createMockSession(),
  };
}
