// ABOUTME: Shared utilities for E2E testing of terminal interface using node-pty
// ABOUTME: Provides clean, reusable helpers for pseudo-terminal sessions and keyboard simulation

import { describe, beforeEach, afterEach } from 'vitest';
import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Constants
export const POLLING_INTERVAL = 50;
export const DEFAULT_TIMEOUT = 10000;
export const COMMAND_DELAY = 100;
export const PTY_SESSION_TIMEOUT = 30000;
export const HELP_COMMAND_TIMEOUT = 15000;
export const AGENT_RESPONSE_TIMEOUT = 15000;

/**
 * Check if LMStudio is available for testing
 */
export async function isLMStudioAvailable(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:1234/v1/models', {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Types
export interface PTYSession {
  terminal: pty.IPty;
  output: string;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface E2ETestEnvironment {
  tempDbPath: string;
  originalEnv: string | undefined;
}

/**
 * Set up isolated test environment for E2E tests
 */
export function setupE2EEnvironment(): E2ETestEnvironment {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const tempDbPath = path.join(os.tmpdir(), `lace-e2e-test-${uniqueId}.db`);
  const originalEnv = process.env.LACE_DIR;

  process.env.LACE_DIR = path.dirname(tempDbPath);

  return { tempDbPath, originalEnv };
}

/**
 * Clean up test environment
 */
export function cleanupE2EEnvironment(env: E2ETestEnvironment): void {
  if (env.originalEnv !== undefined) {
    process.env.LACE_DIR = env.originalEnv;
  } else {
    delete process.env.LACE_DIR;
  }

  try {
    if (fs.existsSync(env.tempDbPath)) {
      fs.unlinkSync(env.tempDbPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a PTY session for testing
 */
export async function createPTYSession(
  provider = 'lmstudio',
  timeout = PTY_SESSION_TIMEOUT
): Promise<PTYSession> {
  return new Promise((resolve, reject) => {
    const terminal = pty.spawn('node', ['dist/cli.js', '--provider', provider], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: {
        ...process.env,
        LACE_DIR: process.env.LACE_DIR,
        LACE_TEST_MODE: 'true',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
        ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
      },
    });

    let output = '';

    terminal.onData((data) => {
      output += data;
    });

    terminal.onExit((event) => {
      if (event.exitCode !== 0) {
        reject(
          new Error(
            `PTY session exited with code ${event.exitCode}, signal ${event.signal}. Output: ${stripAnsi(output)}`
          )
        );
      }
    });

    const timeoutId = setTimeout(() => {
      terminal.kill();
      reject(new Error(`PTY session timed out after ${timeout}ms. Output: ${stripAnsi(output)}`));
    }, timeout);

    const session: PTYSession = {
      terminal,
      get output() {
        return output;
      },
      timeoutId,
    };

    resolve(session);
  });
}

/**
 * Wait for specific text to appear in PTY output
 */
export async function waitForText(
  session: PTYSession,
  expectedText: string,
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkOutput = () => {
      if (session.output.includes(expectedText)) {
        resolve();
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(
          new Error(
            `Timeout waiting for text: "${expectedText}". Full output: "${stripAnsi(session.output)}"`
          )
        );
        return;
      }

      setTimeout(checkOutput, POLLING_INTERVAL);
    };

    checkOutput();
  });
}

/**
 * Strip ANSI escape sequences from text
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Send command with enter key to PTY session
 */
export async function sendCommand(session: PTYSession, command: string): Promise<void> {
  session.terminal.write(command);
  // Small delay then send enter
  await new Promise((resolve) => setTimeout(resolve, COMMAND_DELAY));
  session.terminal.write('\x0d'); // Control+M (ASCII 13)
}

/**
 * Get current output from PTY session
 */
export function getOutput(session: PTYSession): string {
  return session.output;
}

/**
 * Get clean output from PTY session (ANSI stripped)
 */
export function getCleanOutput(session: PTYSession): string {
  return stripAnsi(session.output);
}

/**
 * Close PTY session
 */
export function closePTY(session: PTYSession): void {
  clearTimeout(session.timeoutId);
  session.terminal.kill();
}

/**
 * Wait for application to be ready for commands
 */
export async function waitForReady(session: PTYSession, timeout = DEFAULT_TIMEOUT): Promise<void> {
  // Wait for either the "Ready" status indicator or the prompt
  await waitForText(session, '> ', timeout);
  // Give command processor time to initialize
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

/**
 * Create a describe block with automatic environment setup/teardown
 */
export function describeE2E(name: string, fn: () => void): void {
  describe(name, () => {
    let env: E2ETestEnvironment;

    beforeEach(() => {
      env = setupE2EEnvironment();
    });

    afterEach(() => {
      cleanupE2EEnvironment(env);
    });

    fn();
  });
}
