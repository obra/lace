// ABOUTME: Test helpers for generating valid session and workspace IDs
// ABOUTME: Provides deterministic UUIDs for test scenarios that need valid ID formats

/**
 * Generates a valid test session ID in the sess_<uuid> format.
 * Uses deterministic UUIDs based on the provided seed for reproducible tests.
 *
 * @param seed - A number to generate a deterministic UUID (0-9999)
 * @returns A valid session ID like 'sess_00000000-0000-0000-0000-000000000001'
 */
export function testSessionId(seed: number = 1): string {
  const hex = seed.toString(16).padStart(12, '0');
  return `sess_00000000-0000-0000-0000-${hex}`;
}

/**
 * Generates a valid test workspace session ID in the ws_<uuid> format.
 *
 * @param seed - A number to generate a deterministic UUID (0-9999)
 * @returns A valid workspace session ID like 'ws_00000000-0000-0000-0000-000000000001'
 */
export function testWorkspaceSessionId(seed: number = 1): string {
  const hex = seed.toString(16).padStart(12, '0');
  return `ws_00000000-0000-0000-0000-${hex}`;
}

/**
 * Pre-defined test session IDs for common test scenarios.
 * These are valid sess_<uuid> format IDs.
 */
export const TEST_IDS = {
  AGENT_1: testSessionId(1),
  AGENT_2: testSessionId(2),
  AGENT_3: testSessionId(3),
  WORKSPACE_1: testWorkspaceSessionId(1),
  WORKSPACE_2: testWorkspaceSessionId(2),
  WORKSPACE_3: testWorkspaceSessionId(3),
} as const;
