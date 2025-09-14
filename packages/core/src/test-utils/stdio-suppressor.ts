// ABOUTME: Utility for suppressing stdio output during tests
// ABOUTME: Helps eliminate noise from native libraries and integration tests

import { vi } from 'vitest';

interface OriginalStdio {
  stderr: typeof process.stderr.write;
  stdout: typeof process.stdout.write;
  consoleError: typeof console.error;
  consoleWarn: typeof console.warn;
  consoleLog: typeof console.log;
  consoleInfo: typeof console.info;
}

function suppressStdio(): OriginalStdio {
  const original: OriginalStdio = {
    stderr: process.stderr.write.bind(process.stderr),
    stdout: process.stdout.write.bind(process.stdout),
    consoleError: console.error,
    consoleWarn: console.warn,
    /* eslint-disable no-console */
    consoleLog: console.log,
    consoleInfo: console.info,
    /* eslint-enable no-console */
  };

  // Suppress all output
  process.stderr.write = vi.fn(() => true);
  process.stdout.write = vi.fn(() => true);
  console.error = vi.fn();
  console.warn = vi.fn();
  /* eslint-disable no-console */
  console.log = vi.fn();
  console.info = vi.fn();
  /* eslint-enable no-console */

  return original;
}

function restoreStdio(original: OriginalStdio): void {
  process.stderr.write = original.stderr;
  process.stdout.write = original.stdout;
  console.error = original.consoleError;
  console.warn = original.consoleWarn;
  /* eslint-disable no-console */
  console.log = original.consoleLog;
  console.info = original.consoleInfo;
  /* eslint-enable no-console */
}

/**
 * Temporarily suppresses all stdio output during execution of an async operation.
 * Useful for silencing native library errors, WebSocket connection attempts, etc.
 *
 * @param operation - Async function to execute with suppressed output
 * @returns Promise with the result of the operation
 */
export async function withSuppressedStdio<T>(operation: () => Promise<T>): Promise<T> {
  const original = suppressStdio();
  try {
    return await operation();
  } finally {
    restoreStdio(original);
  }
}

// Removed unused withSuppressedStdioSync function
