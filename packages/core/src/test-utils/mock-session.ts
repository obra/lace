// ABOUTME: Mock session and context utilities for testing
// ABOUTME: Provides standardized mock objects for session-based tests

import { ToolContext } from '@lace/core/tools/types';

/**
 * Creates a complete ToolContext for testing
 * @param overrides - Optional overrides for context properties
 * @returns A ToolContext for direct tool execution
 */
export function createMockToolContext(
  overrides: {
    workingDirectory?: string;
    toolTempRoot?: string;
    toolTempDir?: string;
    threadId?: string;
    projectId?: string;
  } = {}
): ToolContext {
  return {
    workingDirectory: overrides.workingDirectory,
    toolTempRoot: overrides.toolTempRoot,
    toolTempDir: overrides.toolTempDir,
    threadId: overrides.threadId,
    projectId: overrides.projectId,
    signal: new AbortController().signal,
  };
}
