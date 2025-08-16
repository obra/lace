// ABOUTME: Test for LMStudio connection timeout handling
// ABOUTME: Ensures LMStudio provider doesn't hang indefinitely when server is unavailable

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LMStudioProvider } from '~/providers/lmstudio-provider';

// Console capture for verifying error output
let consoleLogs: string[] = [];
let originalConsoleError: typeof console.error;
let originalStderrWrite: typeof process.stderr.write;
let originalStdoutWrite: typeof process.stdout.write;

describe('LMStudio Provider Timeout Handling', () => {
  beforeEach(() => {
    consoleLogs = [];
    originalConsoleError = console.error;
    originalStderrWrite = process.stderr.write;
    originalStdoutWrite = process.stdout.write;

    // Mock console.error to capture logs for test verification
    console.error = (...args: unknown[]) => {
      consoleLogs.push(args.map((arg) => String(arg)).join(' '));
    };

    // Mock both stderr and stdout to suppress underlying library error output during tests
    const suppressWebSocketOutput = (chunk: unknown) => {
      const str = String(chunk);
      return !(
        str.includes('WebSocket') ||
        str.includes('LMStudioClient') ||
        str.includes('ECONNREFUSED') ||
        str.includes('connect ECONNREFUSED')
      );
    };

    process.stderr.write = vi.fn((chunk: unknown) => {
      if (suppressWebSocketOutput(chunk)) {
        return originalStderrWrite.call(process.stderr, chunk as string);
      }
      return true; // Swallow WebSocket-related output
    });

    process.stdout.write = vi.fn((chunk: unknown) => {
      if (suppressWebSocketOutput(chunk)) {
        return originalStdoutWrite.call(process.stdout, chunk as string);
      }
      return true; // Swallow WebSocket-related output
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
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
