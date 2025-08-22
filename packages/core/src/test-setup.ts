// ABOUTME: Global test setup configuration
// ABOUTME: Provides aggressive cleanup to prevent vitest hanging issues

import { afterAll, afterEach, vi } from 'vitest';

// Global cleanup after each test file
afterAll(() => {
  // Clear all timers (both real and fake)
  // Strategy: Get the next timer ID by creating a temporary timer, then clear all
  // timers from 1 to that ID. This handles cases where tests create timers but
  // don't properly clean them up, which can prevent the Node.js process from exiting.
  // This approach works because Node.js timer IDs are incrementing integers.
  if (typeof globalThis.clearTimeout === 'function') {
    const maxId = Number(setTimeout(() => {}, 0));
    for (let i = 1; i <= maxId; i++) {
      clearTimeout(i);
      clearInterval(i);
    }
  }

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
