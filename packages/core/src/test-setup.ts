// ABOUTME: Global test setup configuration
// ABOUTME: Provides aggressive cleanup to prevent vitest hanging issues

import { afterAll, afterEach, vi } from 'vitest';

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

  // Force exit after a delay if process hasn't exited naturally
  // Only trigger this in CI or when explicitly enabled via environment variable
  if (process.env.CI || process.env.LACE_FORCE_TEST_EXIT) {
    setTimeout(() => {
      console.warn('Tests completed but process hanging - forcing exit');
      process.exit(0);
    }, 3000).unref(); // unref so it doesn't keep process alive
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
  } catch (error) {
    // Ignore errors from removeAllListeners - some listeners might be essential
  }
});
