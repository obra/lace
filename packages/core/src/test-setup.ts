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
});

// Cleanup after each individual test
afterEach(() => {
  // Reset all vitest mocks and timers
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});
