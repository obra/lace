// ABOUTME: Shared utilities for API E2E tests
// ABOUTME: Provides standardized setup/teardown and common test operations

import { vi } from 'vitest';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { getSessionService, type SessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';

/**
 * Standard environment setup for API E2E tests
 * Creates disk-based SQLite database and sets required environment variables
 */
export function setupAPITestEnvironment(): SessionService {
  setupTestPersistence();

  // Set up environment for session service
  process.env = {
    ...process.env,
    ANTHROPIC_KEY: 'test-key',
    LACE_DB_PATH: ':memory:',
  };

  return getSessionService();
}

/**
 * Standard cleanup for API E2E tests
 * Stops agents before database teardown to prevent race conditions
 */
export async function cleanupAPITestEnvironment(sessionService: SessionService): Promise<void> {
  try {
    // CRITICAL: Stop agents BEFORE closing database in teardownTestPersistence
    if (sessionService) {
      // Clear sessions without trying to load from database
      sessionService.clearActiveSessions();
    }
  } catch (error) {
    // Ignore cleanup errors to prevent test pollution
    console.warn('Warning: Error during session cleanup:', error);
  }

  // Clear persistence to reset database state
  teardownTestPersistence();

  // Clean up global singleton
  global.sessionService = undefined;
}

/**
 * Standard mock setup for external dependencies
 * Mocks only external services, not internal components
 */
export function setupStandardMocks(): void {
  // Mock server-only module
  vi.mock('server-only', () => ({}));

  // Mock only external dependencies, not core functionality
  vi.mock('@/lib/server/approval-manager', () => ({
    getApprovalManager: () => ({
      requestApproval: vi.fn().mockResolvedValue('allow_once'),
    }),
  }));
}

/**
 * Create a test project for E2E tests
 */
export function createTestProject(name: string = 'E2E Test Project'): Project {
  return Project.create(name, '/test/path', 'Test project for E2E testing', {});
}
