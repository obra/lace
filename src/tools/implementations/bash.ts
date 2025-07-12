// ABOUTME: Schema-based bash command execution tool
// ABOUTME: Executes shell commands with Zod validation and structured output

import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { NonEmptyString } from '~/tools/schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';

const execAsync = promisify(exec);

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const bashSchema = z.object({
  command: NonEmptyString,
});

export class BashTool extends Tool {
  name = 'bash';
  description =
    "Use bash to execute unix commands to achieve the user's goals. Be smart and careful.";
  schema = bashSchema;
  annotations: ToolAnnotations = {
    title: 'Run commands with bash',
    destructiveHint: true,
    openWorldHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof bashSchema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    return await this.executeCommand(args.command);
  }

  private async executeCommand(command: string): Promise<ToolResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        maxBuffer: 10485760,
        shell: '/bin/bash',
      });

      const result: BashOutput = {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      };

      return this.createResult(result as unknown as Record<string, unknown>);
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

        return this.createError(result as unknown as Record<string, unknown>);
      }

      // If we have stdout or command executed in a sequence, treat as tool success
      // This handles cases like: echo "test"; nonexistentcmd; echo "after"
      if (err.stdout !== undefined || err.stderr !== undefined) {
        const result: BashOutput = {
          stdout: err.stdout || '',
          stderr: err.stderr || '',
          exitCode: err.code || 1, // Preserve actual exit code (non-zero)
        };

        return this.createResult(result as unknown as Record<string, unknown>);
      }

      // True failure - command couldn't execute at all (rare cases)
      const result: BashOutput = {
        stdout: '',
        stderr: err.message,
        exitCode: err.code || 1,
      };

      return this.createError(result as unknown as Record<string, unknown>);
    }
  }
}
