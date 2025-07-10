// ABOUTME: Global test setup to capture console output and keep tests quiet
// ABOUTME: Provides utilities for tests that need to verify console output

import { beforeEach, afterEach, vi } from 'vitest';

// Global console mocks - automatically suppress console output in all tests
let consoleMocks: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  // Suppress console output by default in all tests
  consoleMocks = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  // Restore console after each test
  consoleMocks.forEach((mock) => mock.mockRestore());
  consoleMocks = [];
});

// Utility for tests that need to verify console output
export const withConsoleCapture = () => {
  // Restore the original console methods for this test
  consoleMocks.forEach((mock) => mock.mockRestore());

  // Create capturing spies instead of silent mocks
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  return {
    log: logSpy,
    warn: warnSpy,
    error: errorSpy,
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
};

// Utility for tests that need to see console output (for debugging)
export const withConsoleOutput = () => {
  consoleMocks.forEach((mock) => mock.mockRestore());
  consoleMocks = [];
};
