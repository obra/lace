// ABOUTME: Schema-based bash command execution tool
// ABOUTME: Executes shell commands with Zod validation and structured output

import { createWriteStream } from 'fs';
import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '../types';

export interface BashOutput {
  command: string;
  exitCode: number | null;
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

export const bashSchema = z.object({
  command: NonEmptyString,
  background: z.boolean().default(false),
  description: z.string().optional(),
  progressIntervalMs: z.number().int().min(5000).max(600000).optional(),
});

export class BashTool extends Tool {
  name = 'bash';
  description = `Execute shell commands in isolated bash processes.

Parameters:
- command: The shell command to run
- background: Set to true for background execution (returns jobId immediately)
- description: Label shown in job listings when background=true (optional)
- progressIntervalMs: For background jobs, interval in ms for periodic progress notifications (5000-600000). **Off by default** — set this only if you want a fixed cadence regardless of subscribers. Subscribing to a job via job_notify(on=['progress'], ...) arms the timer on its own at the default cadence.

When background=true, returns { jobId, status: "started" }. Use job_output(jobId) to check status/output.
Background jobs send completion notifications automatically. Progress notifications are opt-in (see progressIntervalMs / job_notify).

Default (sync): Blocks until complete. Output truncated to 100+50 lines. Chain with && or ;.`;
  schema = bashSchema;
  annotations: ToolAnnotations = {
    title: 'Run commands with bash',
    destructiveHint: true,
    openWorldHint: true,
    readOnlySafe: false,
  };

  // Output truncation limits
  private static readonly PREVIEW_HEAD_LINES = 100;
  private static readonly PREVIEW_TAIL_LINES = 50;
  private static readonly MAX_PREVIEW_CHARS = 10000; // Safety limit

  protected async executeValidated(
    args: z.infer<typeof bashSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    return await this.executeCommand(args.command, context);
  }

  private async executeCommand(command: string, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check if already aborted
      if (context.signal.aborted) {
        return this.createCancellationResult();
      }

      if (!context.runtime) {
        return this.createError('Tool context missing runtime. This is a system error.');
      }

      // Get temp file paths from ToolExecutor
      const outputPaths = this.getOutputFilePaths(context);

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

      // Circular buffer indices for efficient tail rotation
      let stdoutTailIndex = 0;
      let stderrTailIndex = 0;

      const childProcess = await context.runtime.process.start(['/bin/bash', '-c', command], {
        cwd: context.runtime.cwd,
        env: context.processEnv,
        signal: context.signal,
      });

      // Set up output streams after the runtime process is started so a start failure
      // cannot leave output file handles open.
      const stdoutStream = createWriteStream(outputPaths.stdout);
      const stderrStream = createWriteStream(outputPaths.stderr);
      const combinedStream = createWriteStream(outputPaths.combined);

      return new Promise<ToolResult>((resolve) => {
        let cancelled = false;
        let processKilled = false;
        let settled = false;
        let completionDone = false;
        let stdoutEnded = !childProcess.stdout;
        let stderrEnded = !childProcess.stderr;
        let exitCode: number | null = null;

        const closeStreamsAndComplete = () => {
          if (settled || !completionDone || !stdoutEnded || !stderrEnded) {
            return;
          }

          settled = true;
          const runtime = Date.now() - startTime;

          // Clean up abort handler
          context.signal.removeEventListener('abort', abortHandler);

          // Process any remaining partial lines with circular buffer
          stdoutLineCount = this.processRemainingLines(
            stdoutLineBuffer,
            stdoutLineCount,
            stdoutHeadLines,
            stdoutTailLines,
            stdoutTailIndex
          );
          stderrLineCount = this.processRemainingLines(
            stderrLineBuffer,
            stderrLineCount,
            stderrHeadLines,
            stderrTailLines,
            stderrTailIndex
          );

          // Close file streams and wait for completion to avoid race conditions
          let streamsCompleted = 0;
          const totalStreams = 3;

          const onStreamComplete = () => {
            streamsCompleted++;
            if (streamsCompleted === totalStreams) {
              // All streams are closed, safe to proceed with file paths
              if (cancelled) {
                // Generate partial output preview for cancellation
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

                const partialOutput = [
                  stdoutPreview && `stdout:\n${stdoutPreview}`,
                  stderrPreview && `stderr:\n${stderrPreview}`,
                ]
                  .filter(Boolean)
                  .join('\n\n');

                // Ensure abort listener is cleaned up (though it should already be cleaned up)
                context.signal.removeEventListener('abort', abortHandler);
                resolve(this.createCancellationResult(partialOutput));
              } else {
                this.completeExecution(
                  command,
                  exitCode,
                  runtime,
                  stdoutHeadLines,
                  stderrHeadLines,
                  stdoutTailLines,
                  stderrTailLines,
                  stdoutLineCount,
                  stderrLineCount,
                  outputPaths,
                  resolve
                );
              }
            }
          };

          // Close streams with completion callbacks
          stdoutStream.end(onStreamComplete);
          stderrStream.end(onStreamComplete);
          combinedStream.end(onStreamComplete);
        };

        const handleProcessError = (error: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          const runtime = Date.now() - startTime;

          // Clean up abort handler
          context.signal.removeEventListener('abort', abortHandler);

          // Close file streams
          stdoutStream.end();
          stderrStream.end();
          combinedStream.end();

          if (cancelled || context.signal.aborted) {
            resolve(this.createCancellationResult());
            return;
          }

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
        };

        // Handle abort signal
        const abortHandler = () => {
          cancelled = true;
          if (!processKilled) {
            processKilled = true;
            // First try SIGTERM
            childProcess.kill('SIGTERM');

            // Give it 2 seconds to exit gracefully
            setTimeout(() => {
              childProcess.kill('SIGKILL');
            }, 2000);
          }
        };

        context.signal.addEventListener('abort', abortHandler);
        if (context.signal.aborted) {
          abortHandler();
        }

        // Handle stdout
        childProcess.stdout?.on('data', (data: Buffer) => {
          const result = this.processStreamData(
            data,
            stdoutStream,
            combinedStream,
            stdoutLineBuffer,
            stdoutHeadLines,
            stdoutTailLines,
            stdoutLineCount,
            stdoutTailIndex
          );
          stdoutLineBuffer = result.lineBuffer;
          stdoutLineCount = result.lineCount;
          stdoutTailIndex = result.tailIndex;
        });
        childProcess.stdout?.on('end', () => {
          stdoutEnded = true;
          closeStreamsAndComplete();
        });
        childProcess.stdout?.on('error', handleProcessError);

        // Handle stderr
        childProcess.stderr?.on('data', (data: Buffer) => {
          const result = this.processStreamData(
            data,
            stderrStream,
            combinedStream,
            stderrLineBuffer,
            stderrHeadLines,
            stderrTailLines,
            stderrLineCount,
            stderrTailIndex
          );
          stderrLineBuffer = result.lineBuffer;
          stderrLineCount = result.lineCount;
          stderrTailIndex = result.tailIndex;
        });
        childProcess.stderr?.on('end', () => {
          stderrEnded = true;
          closeStreamsAndComplete();
        });
        childProcess.stderr?.on('error', handleProcessError);

        // Handle completion
        childProcess.completion
          .then((result) => {
            exitCode = result.exitCode;
            completionDone = true;
            closeStreamsAndComplete();
          })
          .catch(handleProcessError);
      });
    } catch (error: unknown) {
      if (context.signal.aborted) {
        return this.createCancellationResult();
      }

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

  /**
   * Process stream data with line buffering and circular tail buffer for efficiency
   */
  private processStreamData(
    data: Buffer,
    stream: NodeJS.WritableStream,
    combinedStream: NodeJS.WritableStream,
    lineBuffer: string,
    headLines: string[],
    tailLines: string[],
    lineCount: number,
    tailIndex: number
  ): { lineBuffer: string; lineCount: number; tailIndex: number } {
    const text = data.toString();

    // Write to files
    stream.write(data);
    combinedStream.write(data);

    // Process complete lines only
    lineBuffer += text;
    const lines = lineBuffer.split('\n');

    // Keep the last element as it may be a partial line
    lineBuffer = lines.pop() || '';

    // Process complete lines (count all lines, including empty ones from \n\n)
    for (const line of lines) {
      lineCount++;

      // Always collect head lines
      if (headLines.length < BashTool.PREVIEW_HEAD_LINES) {
        headLines.push(line);
      }

      // Collect tail lines using circular buffer (O(1) instead of O(n) shift)
      if (tailLines.length < BashTool.PREVIEW_TAIL_LINES) {
        tailLines.push(line);
      } else {
        // Use circular buffer - overwrite oldest entry
        tailLines[tailIndex] = line;
        tailIndex = (tailIndex + 1) % BashTool.PREVIEW_TAIL_LINES;
      }
    }

    return { lineBuffer, lineCount, tailIndex };
  }

  /**
   * Process any remaining partial lines at command completion
   */
  private processRemainingLines(
    lineBuffer: string,
    lineCount: number,
    headLines: string[],
    tailLines: string[],
    tailIndex: number
  ): number {
    // Only increment count if buffer has content
    if (lineBuffer.length > 0) {
      lineCount++;
    }

    // Only add to arrays if we processed any lines (maintains newline structure)
    if (lineCount > 0) {
      if (headLines.length < BashTool.PREVIEW_HEAD_LINES) {
        headLines.push(lineBuffer);
      }

      if (tailLines.length < BashTool.PREVIEW_TAIL_LINES) {
        tailLines.push(lineBuffer);
      } else {
        tailLines[tailIndex] = lineBuffer;
      }
    }

    return lineCount;
  }

  /**
   * Complete command execution and generate final result
   */
  private completeExecution(
    command: string,
    exitCode: number | null,
    runtime: number,
    stdoutHeadLines: string[],
    stderrHeadLines: string[],
    stdoutTailLines: string[],
    stderrTailLines: string[],
    stdoutLineCount: number,
    stderrLineCount: number,
    outputPaths: { stdout: string; stderr: string; combined: string },
    resolve: (result: ToolResult) => void
  ): void {
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
      exitCode,
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
    // - Process terminated by signal: Tool success=false, exit code=null

    if (exitCode === null) {
      resolve(this.createError(result as unknown as Record<string, unknown>));
      return;
    }

    // Special case: Command not found with exit code 127 and no stdout = tool failure
    // This handles single nonexistent commands like "nonexistentcommand12345"
    if (exitCode === 127 && stdoutLineCount === 0) {
      resolve(this.createError(result as unknown as Record<string, unknown>));
    } else {
      resolve(this.createResult(result as unknown as Record<string, unknown>));
    }
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
