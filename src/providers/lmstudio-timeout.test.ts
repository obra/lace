// ABOUTME: Test for LMStudio connection timeout handling
// ABOUTME: Ensures LMStudio provider doesn't hang indefinitely when server is unavailable

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LMStudioProvider } from '~/providers/lmstudio-provider';

// Console capture for verifying error output
let consoleLogs: string[] = [];
let originalConsoleError: typeof console.error;

describe('LMStudio Provider Timeout Handling', () => {
  beforeEach(() => {
    consoleLogs = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      consoleLogs.push(args.map((arg) => String(arg)).join(' '));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('should timeout quickly when LMStudio server is unavailable', async () => {
    // Use a non-existent port to simulate unavailable server
    const provider = new LMStudioProvider({
      baseUrl: 'ws://localhost:9999', // Non-existent port
    });

    const startTime = Date.now();

    // This should fail quickly, not hang for 30+ seconds
    const result = await provider.diagnose();

    const elapsedMs = Date.now() - startTime;

    // Should fail within 5 seconds, not hang indefinitely
    expect(elapsedMs).toBeLessThan(5000);
    expect(result.connected).toBe(false);
    expect(result.error).toBeDefined();

    // Verify that error was logged to console (if any - some providers may not log)
    if (consoleLogs.length > 0) {
      const errorLog = consoleLogs.join(' ').toLowerCase();
      expect(errorLog).toMatch(/error|timeout|connection|failed|econnrefused/);
    }
    // The main test is that it fails quickly, console logging is secondary
  }, 10000); // 10 second test timeout
});
