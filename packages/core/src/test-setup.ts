// ABOUTME: Global test setup configuration
// ABOUTME: Provides aggressive cleanup to prevent vitest hanging issues

import { afterAll, afterEach, beforeAll, vi } from 'vitest';

// Set process title to include relative test file path for easier identification
beforeAll(() => {
  if (typeof process !== 'undefined' && process.title) {
    try {
      // Get the current test file from Vitest's internal state
      // Use bracket notation to avoid TypeScript index signature errors
      const vitestWorker = (globalThis as unknown as Record<string, unknown>)[
        '__vitest_worker__'
      ] as { filepath?: string } | undefined;
      const expectState = (globalThis as unknown as Record<string, unknown>)['expect'] as
        | { getState?: () => { testPath?: string } }
        | undefined;

      const testFile: string =
        vitestWorker?.filepath ||
        (expectState?.getState && expectState.getState().testPath) ||
        process.env.VITEST_TEST_NAME ||
        '';

      if (testFile && typeof testFile === 'string') {
        // Get project root (where package.json is)
        const projectRoot = process.cwd();
        let relativePath: string = testFile;

        // Handle file:// URLs from import.meta.url
        if (testFile.startsWith('file://')) {
          relativePath = testFile.replace('file://', '');
        }

        // Make path relative to project root
        if (relativePath.startsWith(projectRoot)) {
          relativePath = relativePath.substring(projectRoot.length + 1);
        }

        // Clean up monorepo paths - remove packages/core/ prefix
        relativePath = relativePath.replace(/.*packages\/core\//, '');

        process.title = `vitest:core:${relativePath}`;
      } else {
        process.title = 'vitest:core:unknown';
      }
    } catch (_error) {
      process.title = 'vitest:core:error';
    }
  }
});

// Global cleanup after each test file
afterAll(() => {
  // Use Vitest fake timers instead of numeric sweeping:
  // - Ensure `vi.useFakeTimers()` is enabled in tests that create timers.
  // - Keep `vi.clearAllTimers()` in afterEach to reset all fake timers.
  // - For any real handles you create here (e.g., SSE/mock streams), clear them explicitly.
  vi.clearAllTimers();

  // Force garbage collection to clean up any remaining references
  // This helps ensure EventEmitters and other objects are properly collected
  if (global.gc) {
    global.gc();
  }
});

// Cleanup after each individual test
afterEach(() => {
  // Reset all vitest mocks and timers
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();

  // Force cleanup of any remaining EventEmitter instances
  // This helps prevent hanging when tests don't clean up properly
  try {
    process.removeAllListeners();
  } catch (_error) {
    // Ignore errors from removeAllListeners - some listeners might be essential
  }
});
