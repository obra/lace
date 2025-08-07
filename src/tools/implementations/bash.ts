// ABOUTME: Schema-based bash command execution tool
// ABOUTME: Executes shell commands with Zod validation and structured output

import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { NonEmptyString } from '~/tools/schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';

export interface BashOutput {
  command: string;
  exitCode: number;
  runtime: number;

  // Truncated output for model consumption
  stdoutPreview: string;
  stderrPreview: string;

  // Truncation info
  truncated: {
    stdout: { skipped: number; total: number };
    stderr: { skipped: number; total: number };
  };

  // Full output file references
  outputFiles: {
    stdout: string;
    stderr: string;
    combined: string;
  };
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

  // Output truncation limits
  private static readonly PREVIEW_HEAD_LINES = 100;
  private static readonly PREVIEW_TAIL_LINES = 50;
  private static readonly MAX_PREVIEW_CHARS = 10000; // Safety limit

  protected async executeValidated(
    args: z.infer<typeof bashSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    return await this.executeCommand(args.command, context);
  }

  private async executeCommand(command: string, context?: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Get temp file paths from ToolExecutor
      const outputPaths = this.getOutputFilePaths(context);

      // Set up output streams
      const stdoutStream = createWriteStream(outputPaths.stdout);
      const stderrStream = createWriteStream(outputPaths.stderr);
      const combinedStream = createWriteStream(outputPaths.combined);

      // Buffers for head+tail preview
      const stdoutHeadLines: string[] = [];
      const stdoutTailLines: string[] = [];
      const stderrHeadLines: string[] = [];
      const stderrTailLines: string[] = [];
      let stdoutLineCount = 0;
      let stderrLineCount = 0;

      // Line buffers for handling partial lines at chunk boundaries
      let stdoutLineBuffer = '';
      let stderrLineBuffer = '';

      // Execute command with spawn for streaming
      const childProcess = spawn('/bin/bash', ['-c', command], {
        cwd: context?.workingDirectory || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return new Promise<ToolResult>((resolve) => {
        // Handle stdout
        childProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();

          // Write to files
          stdoutStream.write(data);
          combinedStream.write(data);

          // Process complete lines only
          stdoutLineBuffer += text;
          const lines = stdoutLineBuffer.split('\n');

          // Keep the last element as it may be a partial line
          stdoutLineBuffer = lines.pop() || '';

          // Process complete lines (count all lines, including empty ones from \n\n)
          for (const line of lines) {
            stdoutLineCount++;

            // Always collect head lines
            if (stdoutHeadLines.length < BashTool.PREVIEW_HEAD_LINES) {
              stdoutHeadLines.push(line);
            }

            // Collect tail lines (using rotating buffer)
            if (stdoutTailLines.length < BashTool.PREVIEW_TAIL_LINES) {
              stdoutTailLines.push(line);
            } else {
              // Rotate tail buffer
              stdoutTailLines.shift();
              stdoutTailLines.push(line);
            }
          }
        });

        // Handle stderr
        childProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();

          // Write to files
          stderrStream.write(data);
          combinedStream.write(data);

          // Process complete lines only
          stderrLineBuffer += text;
          const lines = stderrLineBuffer.split('\n');

          // Keep the last element as it may be a partial line
          stderrLineBuffer = lines.pop() || '';

          // Process complete lines (count all lines, including empty ones from \n\n)
          for (const line of lines) {
            stderrLineCount++;

            // Always collect head lines
            if (stderrHeadLines.length < BashTool.PREVIEW_HEAD_LINES) {
              stderrHeadLines.push(line);
            }

            // Collect tail lines (using rotating buffer)
            if (stderrTailLines.length < BashTool.PREVIEW_TAIL_LINES) {
              stderrTailLines.push(line);
            } else {
              // Rotate tail buffer
              stderrTailLines.shift();
              stderrTailLines.push(line);
            }
          }
        });

        // Handle completion
        childProcess.on('close', (exitCode) => {
          const runtime = Date.now() - startTime;

          // Process any remaining partial lines (including empty buffer which represents final newline)
          if (stdoutLineBuffer.length > 0 || stdoutLineCount > 0) {
            if (stdoutLineBuffer.length > 0) {
              stdoutLineCount++;
            }
            if (stdoutHeadLines.length < BashTool.PREVIEW_HEAD_LINES) {
              stdoutHeadLines.push(stdoutLineBuffer);
            }
            if (stdoutTailLines.length < BashTool.PREVIEW_TAIL_LINES) {
              stdoutTailLines.push(stdoutLineBuffer);
            } else {
              stdoutTailLines.shift();
              stdoutTailLines.push(stdoutLineBuffer);
            }
          }

          if (stderrLineBuffer.length > 0 || stderrLineCount > 0) {
            if (stderrLineBuffer.length > 0) {
              stderrLineCount++;
            }
            if (stderrHeadLines.length < BashTool.PREVIEW_HEAD_LINES) {
              stderrHeadLines.push(stderrLineBuffer);
            }
            if (stderrTailLines.length < BashTool.PREVIEW_TAIL_LINES) {
              stderrTailLines.push(stderrLineBuffer);
            } else {
              stderrTailLines.shift();
              stderrTailLines.push(stderrLineBuffer);
            }
          }

          // Close file streams
          stdoutStream.end();
          stderrStream.end();
          combinedStream.end();

          // Generate head+tail previews
          const stdoutPreview = this.generateHeadTailPreview(
            stdoutHeadLines,
            stdoutTailLines,
            stdoutLineCount
          );
          const stderrPreview = this.generateHeadTailPreview(
            stderrHeadLines,
            stderrTailLines,
            stderrLineCount
          );

          const result: BashOutput = {
            command,
            exitCode: exitCode || 0,
            runtime,
            stdoutPreview,
            stderrPreview,
            truncated: {
              stdout: {
                skipped: Math.max(
                  0,
                  stdoutLineCount -
                    stdoutHeadLines.length -
                    this.getUniqueTailLines(stdoutHeadLines, stdoutTailLines)
                ),
                total: stdoutLineCount,
              },
              stderr: {
                skipped: Math.max(
                  0,
                  stderrLineCount -
                    stderrHeadLines.length -
                    this.getUniqueTailLines(stderrHeadLines, stderrTailLines)
                ),
                total: stderrLineCount,
              },
            },
            outputFiles: outputPaths,
          };

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
          if (exitCode === 127 && stdoutLineCount === 0) {
            resolve(this.createError(result as unknown as Record<string, unknown>));
          } else {
            resolve(this.createResult(result as unknown as Record<string, unknown>));
          }
        });

        // Handle process errors (e.g., spawn failures)
        childProcess.on('error', (error) => {
          const runtime = Date.now() - startTime;

          // Close file streams
          stdoutStream.end();
          stderrStream.end();
          combinedStream.end();

          const result: BashOutput = {
            command,
            exitCode: 1,
            runtime,
            stdoutPreview: '',
            stderrPreview: error.message,
            truncated: {
              stdout: { skipped: 0, total: 0 },
              stderr: { skipped: 0, total: 1 },
            },
            outputFiles: outputPaths,
          };

          resolve(this.createError(result as unknown as Record<string, unknown>));
        });
      });
    } catch (error: unknown) {
      const runtime = Date.now() - startTime;
      const err = error as { message: string };

      // Fallback for cases where we can't even start the process
      const result: BashOutput = {
        command,
        exitCode: 1,
        runtime,
        stdoutPreview: '',
        stderrPreview: err.message,
        truncated: {
          stdout: { skipped: 0, total: 0 },
          stderr: { skipped: 0, total: 1 },
        },
        outputFiles: {
          stdout: '',
          stderr: '',
          combined: '',
        },
      };

      return this.createError(result as unknown as Record<string, unknown>);
    }
  }

  private generateHeadTailPreview(
    headLines: string[],
    tailLines: string[],
    totalLineCount: number
  ): string {
    if (totalLineCount === 0) return '';

    // If we have few enough lines, no truncation needed
    if (totalLineCount <= BashTool.PREVIEW_HEAD_LINES + BashTool.PREVIEW_TAIL_LINES) {
      // Just use head lines if no truncation needed
      let preview = headLines.join('\n');

      // Apply character limit safety check
      if (preview.length > BashTool.MAX_PREVIEW_CHARS) {
        preview = preview.substring(0, BashTool.MAX_PREVIEW_CHARS) + '...[truncated]';
      }

      return preview;
    }

    // We have truncation - combine head + tail with separator
    const uniqueTailLines = this.getUniqueTailLinesArray(headLines, tailLines);
    const skippedCount = totalLineCount - headLines.length - uniqueTailLines.length;

    const headPreview = headLines.join('\n');
    const tailPreview = uniqueTailLines.join('\n');
    const separator = `\n...[${skippedCount} lines omitted]...\n`;

    let preview = headPreview + separator + tailPreview;

    // Apply character limit safety check
    if (preview.length > BashTool.MAX_PREVIEW_CHARS) {
      preview = preview.substring(0, BashTool.MAX_PREVIEW_CHARS) + '...[truncated]';
    }

    return preview;
  }

  /**
   * Count unique tail lines that aren't already in head lines
   */
  private getUniqueTailLines(headLines: string[], tailLines: string[]): number {
    return this.getUniqueTailLinesArray(headLines, tailLines).length;
  }

  /**
   * Get tail lines that aren't already in head lines
   */
  private getUniqueTailLinesArray(headLines: string[], tailLines: string[]): string[] {
    const headLinesSet = new Set(headLines);
    return tailLines.filter((line) => !headLinesSet.has(line));
  }

  private getOutputFilePaths(context?: ToolContext): {
    stdout: string;
    stderr: string;
    combined: string;
  } {
    // Get temp directory from ToolExecutor - fail hard if not provided
    const toolTempDir = this.getToolTempDir(context);
    return {
      stdout: `${toolTempDir}/stdout.txt`,
      stderr: `${toolTempDir}/stderr.txt`,
      combined: `${toolTempDir}/combined.txt`,
    };
  }
}
