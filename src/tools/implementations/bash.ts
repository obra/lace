// ABOUTME: Bash command execution tool implementation
// ABOUTME: Executes shell commands with proper error handling and structured output

import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolResult } from '../types.js';

const execAsync = promisify(exec);

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class BashTool implements Tool {
  name = 'bash';
  description = 'Execute bash commands';
  input_schema = {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
    },
    required: ['command'],
  };

  async executeTool(input: Record<string, unknown>): Promise<ToolResult> {
    const { command } = input as { command: string };

    if (!command || typeof command !== 'string') {
      return {
        success: false,
        output: JSON.stringify({
          stdout: '',
          stderr: 'Command must be a non-empty string',
          exitCode: 1,
        }),
        error: 'Command must be a non-empty string',
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        maxBuffer: 10485760,
      });

      const result: BashOutput = {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      };

      return {
        success: true,
        output: JSON.stringify(result),
      };
    } catch (error: unknown) {
      const err = error as { message: string; stdout?: string; stderr?: string; code?: number };

      const result: BashOutput = {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code || 1,
      };

      return {
        success: false,
        output: JSON.stringify(result),
        error: err.message,
      };
    }
  }
}
