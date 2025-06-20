// ABOUTME: Bash command execution tool implementation
// ABOUTME: Executes shell commands with proper error handling and structured output

import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolResult, ToolContext, createSuccessResult, createErrorResult } from '../types.js';

const execAsync = promisify(exec);

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class BashTool implements Tool {
  name = 'bash';
  description =
    "Use bash to execute unix commands to achieve the user's goals. Be smart and careful.";
  annotations = {
    title: 'Run commands with bash',
    destructiveHint: true,
    openWorldHint: true,
  };
  input_schema = {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
    },
    required: ['command'],
  };

  async executeTool(input: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const { command } = input as { command: string };

    if (!command || typeof command !== 'string') {
      return createErrorResult(
        JSON.stringify({
          stdout: '',
          stderr: 'Command must be a non-empty string',
          exitCode: 1,
        })
      );
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

      return createSuccessResult([
        {
          type: 'text',
          text: JSON.stringify(result),
        },
      ]);
    } catch (error: unknown) {
      const err = error as { message: string; stdout?: string; stderr?: string; code?: number };

      // Important distinction: Tool success vs Command exit code
      // - Tool success = "Did the bash tool successfully execute the command?"
      // - Command exit code = "What was the result of the command itself?"
      //
      // Examples:
      // - ESLint finds issues: Tool success=true, exit code=1, stdout=linting errors
      // - Git status with changes: Tool success=true, exit code=1, stdout=file list
      // - Single invalid command: Tool success=false, exit code=127, stderr=command not found
      // - Command sequence with invalid command: Tool success=true, exit code=0, stderr=command not found

      // Special case: Command not found with exit code 127 and no stdout = tool failure
      // This handles single nonexistent commands like "nonexistentcommand12345"
      if (err.code === 127 && (!err.stdout || err.stdout.trim() === '')) {
        const result: BashOutput = {
          stdout: err.stdout || '',
          stderr: err.stderr || err.message,
          exitCode: 127,
        };

        return createErrorResult(JSON.stringify(result));
      }

      // If we have stdout or command executed in a sequence, treat as tool success
      // This handles cases like: echo "test"; nonexistentcmd; echo "after"
      if (err.stdout !== undefined || err.stderr !== undefined) {
        const result: BashOutput = {
          stdout: err.stdout || '',
          stderr: err.stderr || '',
          exitCode: err.code || 1, // Preserve actual exit code (non-zero)
        };

        return createSuccessResult([
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ]);
      }

      // True failure - command couldn't execute at all (rare cases)
      const result: BashOutput = {
        stdout: '',
        stderr: err.message,
        exitCode: err.code || 1,
      };

      return createErrorResult(JSON.stringify(result));
    }
  }
}
