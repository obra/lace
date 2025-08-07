// ABOUTME: Global test setup configuration
// ABOUTME: Provides aggressive cleanup to prevent vitest hanging issues

import { afterAll, afterEach, vi } from 'vitest';

// Global cleanup after each test file
afterAll(() => {
  // Clear all timers (both real and fake)
  if (typeof globalThis.clearTimeout === 'function') {
    // Clear any remaining timeouts/intervals
    const maxId = setTimeout(() => {}, 0);
    for (let i = 1; i <= maxId; i++) {
      clearTimeout(i);
      clearInterval(i);
    }
  }

  // Force garbage collection if available
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
