// ABOUTME: Shared test helper for running CLI commands using spawn with timing fixes
// ABOUTME: Provides consistent CLI execution with essential stream processing to prevent model hangs

import { spawn } from 'child_process';

export interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CLIOptions {
  timeout?: number;
  input?: string;
  env?: Record<string, string>;
}

/**
 * Run the lace CLI with given arguments and options
 * Uses spawn with essential timing fixes to prevent model generation hangs
 */
export async function runCLI(args: string[], options: CLIOptions = {}): Promise<CLIResult> {
  const { timeout = 10000, input, env = {} } = options;

  return new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/cli.js', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ANTHROPIC_KEY: 'fake-key-for-testing',
        ...env,
      },
      // Ensure child process can exit cleanly
      detached: false,
    });

    let stdout = '';
    let stderr = '';

    // Properly handle stream ending
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (data) => {
      stdout += data;
    });

    child.stderr?.on('data', (data) => {
      stderr += data;
    });

    // Send input if provided, otherwise close stdin
    if (input) {
      child.stdin?.write(input, 'utf8');
    }
    child.stdin?.end();

    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL'); // Force kill if hanging
      reject(new Error(`CLI command timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      // Small delay to ensure process fully exits and releases any locks
      setTimeout(() => {
        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
        });
      }, 100);
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

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

/**
 * Skip test if LMStudio is not available
 */
export async function skipIfLMStudioUnavailable(): Promise<void> {
  const available = await isLMStudioAvailable();
  if (!available) {
    console.log('LMStudio not available, skipping test');
    return;
  }
}
