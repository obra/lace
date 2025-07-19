// ABOUTME: Global test setup that automatically initializes persistence for tests that need it
// ABOUTME: Detects when tests use ThreadManager and auto-applies persistence helper pattern

import { beforeEach, afterEach } from 'vitest';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';
import type { ThreadManager } from '~/threads/thread-manager';

// Track whether persistence is needed for current test
let persistenceNeeded = false;
let originalThreadManager: typeof ThreadManager | undefined;

interface ThreadManagerModule {
  ThreadManager: typeof ThreadManager;
}

// Auto-detect tests that need persistence by hooking into ThreadManager imports
beforeEach(() => {
  // Reset persistence state
  persistenceNeeded = false;

  // Hook into ThreadManager constructor to detect usage
  if (typeof global !== 'undefined') {
    try {
      // Try to get ThreadManager module if it's been imported
      const threadManagerModule = (globalThis as Record<string, unknown>)
        .__THREAD_MANAGER_MODULE__ as ThreadManagerModule | undefined;
      if (threadManagerModule?.ThreadManager) {
        originalThreadManager = threadManagerModule.ThreadManager;

        // Wrap ThreadManager constructor to auto-setup persistence
        threadManagerModule.ThreadManager = class extends originalThreadManager {
          constructor() {
            if (!persistenceNeeded) {
              persistenceNeeded = true;
              setupTestPersistence();
            }
            super();
          }
        };
      }
    } catch {
      // Module not imported yet, ignore
    }
  }
});

afterEach(() => {
  // Clean up persistence if it was used
  if (persistenceNeeded) {
    teardownTestPersistence();
  }

  // Restore original ThreadManager
  if (originalThreadManager) {
    try {
      const threadManagerModule = (globalThis as Record<string, unknown>)
        .__THREAD_MANAGER_MODULE__ as ThreadManagerModule | undefined;
      if (threadManagerModule) {
        threadManagerModule.ThreadManager = originalThreadManager;
      }
    } catch {
      // Ignore
    }
  }
});
