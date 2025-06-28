// ABOUTME: Test utilities for tool testing
// ABOUTME: Provides helper functions to create ToolCall objects for tests

import { ToolCall } from '../types.js';

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
