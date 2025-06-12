// ABOUTME: Shell command execution tool for system operations  
// ABOUTME: Provides safe command execution with output capture, error handling, and cancellation support

import { BaseTool, ToolSchema, ToolContext } from './base-tool.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ShellExecuteParams {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface ShellInteractiveParams {
  command: string;
  args?: string[];
  cwd?: string;
}

export interface ShellExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellInteractiveResult {
  exitCode: number;
}

export class ShellTool extends BaseTool {
  getSchema(): ToolSchema {
    return {
      name: 'shell',
      description: 'Execute shell commands with output capture and cancellation support',
      methods: {
        shell_exec: {
          description: 'Execute a shell command and capture output',
          parameters: {
            command: {
              type: 'string',
              required: true,
              description: 'Shell command to execute'
            },
            cwd: {
              type: 'string',
              required: false,
              default: process.cwd(),
              description: 'Working directory for command execution'
            },
            timeout: {
              type: 'number',
              required: false,
              default: 30000,
              description: 'Timeout in milliseconds (default: 30000)',
              min: 1000,
              max: 300000
            }
          }
        },
        shell_interactive: {
          description: 'Run command interactively (inherit stdio)',
          parameters: {
            command: {
              type: 'string',
              required: true,
              description: 'Command to run'
            },
            args: {
              type: 'array',
              required: false,
              description: 'Command arguments array'
            },
            cwd: {
              type: 'string',
              required: false,
              default: process.cwd(),
              description: 'Working directory for command execution'
            }
          }
        }
      }
    };
  }

  async shell_exec(params: ShellExecuteParams, context?: ToolContext): Promise<ShellExecuteResult> {
    const { command, cwd = process.cwd(), timeout = 30000 } = params;

    try {
      // Set up cancellation
      const abortController = new AbortController();
      
      // Cancel if context signal is aborted
      context?.signal?.addEventListener('abort', () => {
        abortController.abort();
      });

      // Report progress for long-running commands
      if (context?.progress) {
        context.progress.update(0, 100, 'executing', `Running: ${command}`);
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB buffer
        signal: abortController.signal
      });

      if (context?.progress) {
        context.progress.complete(`Command completed: ${command}`);
      }

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0
      };

    } catch (error: any) {
      if (context?.progress) {
        context.progress.fail(error, `Command failed: ${command}`);
      }

      // Handle cancellation
      if (error.name === 'AbortError' || context?.signal?.aborted) {
        throw new Error('Command execution was cancelled');
      }

      // Handle timeout
      if (error.code === 'ETIMEDOUT' || error.killed) {
        throw new Error(`Command timed out after ${timeout}ms: ${command}`);
      }

      // Return execution result with error info
      return {
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || error.message,
        exitCode: error.code || 1
      };
    }
  }

  async shell_interactive(params: ShellInteractiveParams, context?: ToolContext): Promise<ShellInteractiveResult> {
    const { command, args = [], cwd = process.cwd() } = params;

    return new Promise((resolve, reject) => {
      // Check for cancellation before starting
      if (context?.signal?.aborted) {
        return reject(new Error('Interactive command was cancelled before starting'));
      }

      if (context?.progress) {
        context.progress.update(0, 100, 'interactive', `Starting interactive: ${command}`);
      }

      const child = spawn(command, args, {
        cwd,
        stdio: 'inherit'
      });

      // Handle cancellation during execution
      const abortHandler = () => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000); // Force kill after 5 seconds
        reject(new Error('Interactive command was cancelled'));
      };

      context?.signal?.addEventListener('abort', abortHandler);

      child.on('close', (code) => {
        context?.signal?.removeEventListener('abort', abortHandler);
        
        if (context?.progress) {
          if (code === 0) {
            context.progress.complete(`Interactive command completed: ${command}`);
          } else {
            context.progress.fail(new Error(`Exit code: ${code}`), `Interactive command failed: ${command}`);
          }
        }

        resolve({
          exitCode: code || 0
        });
      });

      child.on('error', (error) => {
        context?.signal?.removeEventListener('abort', abortHandler);
        
        if (context?.progress) {
          context.progress.fail(error, `Interactive command error: ${command}`);
        }

        reject(new Error(`Failed to start interactive command: ${error.message}`));
      });
    });
  }
}