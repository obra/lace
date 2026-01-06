// ABOUTME: Test for LMStudio connection timeout handling
// ABOUTME: Ensures LMStudio provider doesn't hang indefinitely when server is unavailable

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { LMStudioProvider } from './lmstudio-provider';

// Spies for capturing expected error output from the LMStudio SDK's LoggerInterface
// The SDK uses console.{info,warn,error} by default for logging WebSocket errors
let consoleInfoSpy: MockInstance<typeof console.info>;
let consoleWarnSpy: MockInstance<typeof console.warn>;
let consoleErrorSpy: MockInstance<typeof console.error>;

describe('LMStudio Provider Timeout Handling', () => {
  beforeEach(() => {
    // Mock all console methods used by LMStudio SDK's LoggerInterface
    // The SDK logs WebSocket connection errors when server is unavailable
    // Since this test expects connection failure, we capture/suppress this expected output
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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

    // Verify the expected error output was captured by our console spies
    // The LMStudio SDK logs WebSocket errors when connection is refused
    const allConsoleCalls = [
      ...consoleInfoSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ];

    const hasExpectedError = allConsoleCalls.some((call) => {
      const output = call.map(String).join(' ');
      return (
        output.includes('WebSocket') ||
        output.includes('ECONNREFUSED') ||
        output.includes('LMStudioClient')
      );
    });

    // It's expected that the LMStudio SDK will log connection errors
    // This validates our spies captured them (preventing console noise)
    expect(hasExpectedError).toBe(true);
  }, 10000); // 10 second test timeout
});
