// ABOUTME: Tests for global traffic logging system
// ABOUTME: Verifies traffic logger abstraction and integration

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enableTrafficLogging,
  isTrafficLoggingEnabled,
  resetTrafficLogging,
} from '~/utils/traffic-logger';

// Mock all the underlying modules
vi.mock('./har-recorder.js', () => ({
  initializeHARRecording: vi.fn(),
}));

vi.mock('./fetch-interceptor.js', () => ({
  enableFetchInterception: vi.fn(),
}));

vi.mock('./node-fetch-interceptor.js', () => ({
  enableNodeFetchInterception: vi.fn(),
}));

vi.mock('./websocket-interceptor.js', () => ({
  enableWebSocketInterception: vi.fn(),
}));

describe('TrafficLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrafficLogging();
  });

  describe('enableTrafficLogging', () => {
    it('should change state to enabled after successful initialization', async () => {
      // Test initial state
      expect(isTrafficLoggingEnabled()).toBe(false);

      // Test state change after enabling
      await enableTrafficLogging('/tmp/test.har');
      expect(isTrafficLoggingEnabled()).toBe(true);
    });

    it('should remain enabled and not reinitialize if called multiple times', async () => {
      const { initializeHARRecording } = await import('./har-recorder');

      // Enable first time
      await enableTrafficLogging('/tmp/test1.har');
      expect(isTrafficLoggingEnabled()).toBe(true);

      // Try to enable again with different file
      await enableTrafficLogging('/tmp/test2.har');
      expect(isTrafficLoggingEnabled()).toBe(true);

      // Verify only first initialization was called
      expect(initializeHARRecording).toHaveBeenCalledTimes(1);
      expect(initializeHARRecording).toHaveBeenCalledWith('/tmp/test1.har');
    });

    it('should handle initialization errors by propagating them', async () => {
      const { initializeHARRecording } = await import('./har-recorder');
      const testError = new Error('HAR initialization failed');

      // Mock the implementation to throw only for this test
      const originalImplementation = vi.mocked(initializeHARRecording).getMockImplementation();
      vi.mocked(initializeHARRecording).mockImplementationOnce(() => {
        throw testError;
      });

      // Test error handling
      await expect(enableTrafficLogging('/tmp/test.har')).rejects.toThrow(
        'HAR initialization failed'
      );

      // Verify state remains unchanged after error
      expect(isTrafficLoggingEnabled()).toBe(false);

      // Restore original mock implementation
      if (originalImplementation) {
        vi.mocked(initializeHARRecording).mockImplementation(originalImplementation);
      } else {
        vi.mocked(initializeHARRecording).mockRestore();
      }
    });
  });

  describe('isTrafficLoggingEnabled', () => {
    it('should return false initially', () => {
      expect(isTrafficLoggingEnabled()).toBe(false);
    });

    it('should accurately reflect current logging state', async () => {
      // Test state tracking through enable/reset cycle
      expect(isTrafficLoggingEnabled()).toBe(false);

      await enableTrafficLogging('/tmp/test.har');
      expect(isTrafficLoggingEnabled()).toBe(true);

      resetTrafficLogging();
      expect(isTrafficLoggingEnabled()).toBe(false);
    });
  });

  describe('resetTrafficLogging', () => {
    it('should reset state to disabled', async () => {
      // Enable logging first
      await enableTrafficLogging('/tmp/test.har');
      expect(isTrafficLoggingEnabled()).toBe(true);

      // Test reset functionality
      resetTrafficLogging();
      expect(isTrafficLoggingEnabled()).toBe(false);
    });
  });
});
