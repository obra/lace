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
    it('should enable all traffic interception mechanisms', async () => {
      const { initializeHARRecording } = await import('./har-recorder');
      const { enableFetchInterception } = await import('./fetch-interceptor');
      const { enableNodeFetchInterception } = await import('./node-fetch-interceptor');
      const { enableWebSocketInterception } = await import('./websocket-interceptor');

      await enableTrafficLogging('/tmp/test.har');

      expect(initializeHARRecording).toHaveBeenCalledWith('/tmp/test.har');
      expect(enableFetchInterception).toHaveBeenCalled();
      expect(enableNodeFetchInterception).toHaveBeenCalled();
      expect(enableWebSocketInterception).toHaveBeenCalled();
      expect(isTrafficLoggingEnabled()).toBe(true);
    });

    it('should not enable twice if already enabled', async () => {
      const { initializeHARRecording } = await import('./har-recorder');

      await enableTrafficLogging('/tmp/test1.har');
      await enableTrafficLogging('/tmp/test2.har');

      expect(initializeHARRecording).toHaveBeenCalledTimes(1);
      expect(initializeHARRecording).toHaveBeenCalledWith('/tmp/test1.har');
    });
  });

  describe('isTrafficLoggingEnabled', () => {
    it('should return false initially', () => {
      expect(isTrafficLoggingEnabled()).toBe(false);
    });
  });
});
