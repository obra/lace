// ABOUTME: Shared mock Agent utilities for web tests
// ABOUTME: Provides complete Agent mocks with getFullSession() method for SessionService tests

import { vi } from 'vitest';
import type { Session } from '@/lib/server/lace-imports';

/**
 * Creates a mock Agent with proper getFullSession() method for testing SessionService
 * @param overrides - Optional overrides for specific Agent methods/properties
 * @returns A mock Agent object compatible with SessionService.setupAgentEventHandlers()
 */
type MockAgent = {
  threadId: string;
  handlers: Record<string, (data?: unknown) => void>;
  on: (event: string, handler: (data?: unknown) => void) => MockAgent;
  emit: (event: string, data?: unknown) => boolean;
  getFullSession: () => Promise<Session | undefined>;
  [key: string]: unknown;
};

export function createMockAgent(
  overrides: {
    threadId?: string;
    getFullSession?: () => Promise<Session | undefined>;
    on?: (event: string, handler: (data?: unknown) => void) => unknown;
    emit?: (event: string, data?: unknown) => boolean;
    [key: string]: unknown;
  } = {}
): MockAgent {
  // Create event handler storage for manual triggering in tests
  const handlers: Record<string, (data?: unknown) => void> = {};

  // Create base agent object first
  const mockAgent = {
    threadId: overrides.threadId || 'lace_20250101_test01.1',
    handlers,
    ...overrides,
  } as MockAgent;

  // Add methods that reference the agent itself
  mockAgent.on = (event: string, handler: (data?: unknown) => void): MockAgent => {
    handlers[event] = handler;
    return mockAgent;
  };

  mockAgent.emit = (event: string, data?: unknown): boolean => {
    const handler = handlers[event];
    if (handler) {
      handler(data);
      return true;
    }
    return false;
  };

  mockAgent.getFullSession = overrides.getFullSession
    ? overrides.getFullSession
    : () =>
        Promise.resolve({
          getId: () => 'lace_20250101_sess01',
          getProjectId: () => 'test-project-123',
        } as Session);

  return mockAgent;
}

/**
 * Creates a mock Agent that returns undefined from getFullSession (for testing edge cases)
 */
export function createMockAgentWithoutSession(
  overrides: Parameters<typeof createMockAgent>[0] = {}
): ReturnType<typeof createMockAgent> {
  return createMockAgent({
    ...overrides,
    getFullSession: vi.fn().mockResolvedValue(undefined),
  });
}

/**
 * Creates a mock Session for use with mock agents
 * @param overrides - Optional overrides for specific Session methods
 * @returns A mock Session object
 */
export function createMockSession(
  overrides: {
    getId?: () => string;
    getProjectId?: () => string;
    [key: string]: unknown;
  } = {}
): Session {
  return {
    getId: overrides.getId || (() => 'lace_20250101_sess01'),
    getProjectId: overrides.getProjectId || (() => 'test-project-123'),
    ...overrides,
  } as Session;
}
