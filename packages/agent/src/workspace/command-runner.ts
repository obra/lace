// ABOUTME: Shared command execution for workspace managers
// ABOUTME: Handles both array commands (no shell) and string commands (with shell)

import { exec, execFile, ExecFileOptions } from 'child_process';
import { promisify } from 'util';
import { ExecResult } from '@lace/agent/containers/types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Options for command execution
 */
export interface CommandOptions {
  /** Command to execute - array for execFile (safe), string for shell execution */
  command: string[] | string;
  /** Working directory for command execution */
  cwd: string;
  /** Environment variables to pass to the command */
  environment?: Record<string, string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum buffer size in bytes (default: 10MB) */
  maxBuffer?: number;
}

/**
 * Execute a command locally.
 *
 * Array commands use execFile (no shell interpretation) for security.
 * String commands use exec with shell (needed for pipes, redirects, etc).
 */
export async function executeCommand(options: CommandOptions): Promise<ExecResult> {
  const commonOptions = {
    cwd: options.cwd,
    timeout: options.timeout ?? 30000,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024, // 10MB
    env: {
      ...process.env,
      ...options.environment,
    },
  };

  try {
    let stdout: Buffer | string;
    let stderr: Buffer | string;

    if (Array.isArray(options.command)) {
      // Use execFile for array commands - no shell interpretation
      // This prevents injection attacks by passing args directly to the executable
      const [command, ...args] = options.command;
      const execFileOptions: ExecFileOptions = {
        ...commonOptions,
        encoding: 'buffer',
      };
      const result = await execFileAsync(command, args, execFileOptions);
      stdout = result.stdout;
      stderr = result.stderr;
    } else {
      // String commands use exec with shell (needed for pipes, redirects, etc.)
      const execOptions = {
        ...commonOptions,
        encoding: 'buffer' as const,
      };
      const result = await execAsync(options.command, execOptions);
      stdout = result.stdout;
      stderr = result.stderr;
    }

    return {
      stdout: stdout?.toString() ?? '',
      stderr: stderr?.toString() ?? '',
      exitCode: 0,
    };
  } catch (error: unknown) {
    // Command executed but returned non-zero exit code
    if (error && typeof error === 'object' && 'code' in error) {
      const execError = error as {
        code?: number;
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };
      return {
        stdout: execError.stdout?.toString() ?? '',
        stderr: execError.stderr?.toString() ?? '',
        exitCode: typeof execError.code === 'number' ? execError.code : 1,
      };
    }
    throw error;
  }
}
