// ABOUTME: Schema-based bash command execution tool
// ABOUTME: Executes shell commands with Zod validation and structured output

import { createWriteStream } from 'fs';
import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '../types';
import { logger } from '@lace/agent/utils/logger';

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

  // True when the sync-call timeout ended the call (PRI-3251).
  timedOut: boolean;
  // Explains what the timeout did; present only when timedOut is true.
  timeoutMessage?: string;
}

// Sync-call timeout bounds (PRI-3251). A per-call timeoutMs must fall in
// [MIN, MAX]; calls that omit it get the per-instance default.
const MIN_FOREGROUND_TIMEOUT_MS = 1_000;
const MAX_FOREGROUND_TIMEOUT_MS = 600_000;
// Time between SIGTERM and SIGKILL, for both timeout and abort.
const KILL_GRACE_MS = 2_000;

/**
 * The timeout for a sync call that omits timeoutMs. Operators can set it per
 * instance with LACE_BASH_FOREGROUND_TIMEOUT_MS, but only to lower it: the
 * default is already the 600000ms per-call ceiling, and the value is clamped
 * to [MIN, MAX]. A clamped value, or one that isn't a positive integer (e.g.
 * "10s"), is logged as a warning; the latter falls back to the default.
 */
function defaultForegroundTimeoutMs(): number {
  const raw = process.env.LACE_BASH_FOREGROUND_TIMEOUT_MS;
  if (raw === undefined) return MAX_FOREGROUND_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn('LACE_BASH_FOREGROUND_TIMEOUT_MS is not a positive integer; using the default', {
      value: raw,
      effectiveMs: MAX_FOREGROUND_TIMEOUT_MS,
    });
    return MAX_FOREGROUND_TIMEOUT_MS;
  }

  const clamped = Math.min(Math.max(parsed, MIN_FOREGROUND_TIMEOUT_MS), MAX_FOREGROUND_TIMEOUT_MS);
  if (clamped !== parsed) {
    logger.warn('LACE_BASH_FOREGROUND_TIMEOUT_MS is out of range; clamped', {
      value: raw,
      effectiveMs: clamped,
      minMs: MIN_FOREGROUND_TIMEOUT_MS,
      maxMs: MAX_FOREGROUND_TIMEOUT_MS,
    });
  }
  return clamped;
}

export const bashSchema = z.object({
  command: NonEmptyString,
  background: z.boolean().default(false),
  description: z.string().optional(),
  progressIntervalMs: z.number().int().min(5000).max(600000).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(MIN_FOREGROUND_TIMEOUT_MS)
    .max(MAX_FOREGROUND_TIMEOUT_MS)
    .optional(),
});

export class BashTool extends Tool {
  name = 'bash';
  // Read once per instance so the description and the enforced default agree.
  private readonly defaultTimeoutMs = defaultForegroundTimeoutMs();
  description = `Execute shell commands in isolated bash processes.

Parameters:
- command: The shell command to run
- background: Set to true for background execution (returns jobId immediately)
- description: Label shown in job listings when background=true (optional)
- progressIntervalMs: For background jobs, interval in ms for periodic progress notifications (5000-600000). **Off by default** — set this only if you want a fixed cadence regardless of subscribers. Subscribing to a job via job_notify(on=['progress'], ...) arms the timer on its own at the default cadence.
- timeoutMs: Sync calls only. Kill the command if it runs longer than this many ms (${MIN_FOREGROUND_TIMEOUT_MS}-${MAX_FOREGROUND_TIMEOUT_MS}). Defaults to ${this.defaultTimeoutMs}.

When background=true, returns { jobId, status: "started" }. Use job_output(jobId) to check status/output.
Background jobs send completion notifications automatically. Progress notifications are opt-in (see progressIntervalMs / job_notify).

Default (sync): Blocks until complete. Output truncated to 100+50 lines. Chain with && or ;.
A sync command that runs past its timeout (${this.defaultTimeoutMs / 1000}s unless timeoutMs is set) is killed (SIGTERM, then SIGKILL ${KILL_GRACE_MS / 1000}s later) — for anything long-running (installs, builds, long fetches) use background=true and poll job_output(jobId).`;
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
    return await this.executeCommand(
      args.command,
      context,
      args.timeoutMs ?? this.defaultTimeoutMs
    );
  }

  private async executeCommand(
    command: string,
    context: ToolContext,
    timeoutMs: number
  ): Promise<ToolResult> {
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
        // /dev/null rather than an open, unwritten pipe, so a command that
        // falls back to reading stdin gets EOF instead of hanging. See
        // RuntimeProcessOptions.stdin and PRI-3243.
        stdin: 'ignore',
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
        // The shell's own exit, seen before its stdout/stderr close (when the
        // runtime reports it). Set means the shell is gone and anything still
        // holding the pipes is a process it started.
        let shellExit: { exitCode: number | null; signal?: NodeJS.Signals } | undefined;
        let timeoutMessage: string | undefined;

        void childProcess.exited?.then((result) => {
          shellExit = result;
        });

        const closeStreamsAndComplete = () => {
          if (settled || !completionDone || !stdoutEnded || !stderrEnded) {
            return;
          }

          settled = true;
          clearTimeout(foregroundTimeoutTimer);
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
                  resolve,
                  timeoutMessage
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
          clearTimeout(foregroundTimeoutTimer);
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
            timedOut: timeoutMessage !== undefined,
          };

          resolve(this.createError(result as unknown as Record<string, unknown>));
        };

        // Settle with whatever output has been captured, without waiting for
        // stdout/stderr to end. Used when something the tool can't signal (a
        // process the shell started) is still holding the pipes open.
        const settleWithoutWaitingForPipes = () => {
          if (settled) return;
          if (!completionDone) {
            exitCode = shellExit?.exitCode ?? null;
            completionDone = true;
          }
          stdoutEnded = true;
          stderrEnded = true;
          childProcess.stdout?.destroy();
          childProcess.stderr?.destroy();
          closeStreamsAndComplete();
        };

        // SIGTERM the shell, then SIGKILL it after the grace period. The
        // SIGKILL timer is deliberately never cleared when the call settles:
        // on abort the call settles at once (the runtime's own abort handling
        // rejects `completion`), while a TERM-ignoring shell is still alive.
        // Once the SIGKILLed shell has exited, stop waiting on the pipes too,
        // so a timeout is bounded by timeoutMs + KILL_GRACE_MS. unref() so
        // this cleanup can't keep the agent process alive by itself.
        const terminateShell = () => {
          childProcess.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            childProcess.kill('SIGKILL');
            // Without an exit signal from the runtime, don't wait at all.
            void (childProcess.exited ?? Promise.resolve()).then(() => {
              // Let an already-queued stdout/stderr 'end' settle normally first.
              setImmediate(settleWithoutWaitingForPipes);
            });
          }, KILL_GRACE_MS);
          killTimer.unref();
        };

        // Handle abort signal
        const abortHandler = () => {
          cancelled = true;
          if (!processKilled) {
            processKilled = true;
            terminateShell();
          }
        };

        const timeoutHandler = () => {
          if (settled || processKilled) return;
          processKilled = true;
          const seconds = timeoutMs / 1000;

          if (shellExit) {
            // The shell already exited and there is nothing of ours left to
            // signal; the pipes are held by a process it started.
            const howItExited =
              shellExit.exitCode === null
                ? `was terminated by ${shellExit.signal ?? 'a signal'}`
                : `exited with code ${shellExit.exitCode}`;
            timeoutMessage =
              `Command ${howItExited}, but its stdout/stderr stayed open until the ${seconds}s timeout, ` +
              'probably held by a background process it started (that process may still be running). ' +
              "For long-running work use background=true, or redirect the background process's output (e.g. `cmd > out.log 2>&1 &`).";
            settleWithoutWaitingForPipes();
            return;
          }

          // Only the shell is signaled, so processes it started can outlive it.
          timeoutMessage =
            `Command timed out after ${seconds}s and its shell was killed ` +
            `(SIGTERM, then SIGKILL ${KILL_GRACE_MS / 1000}s later if still running). ` +
            'Processes it started may still be running.';
          terminateShell();
        };
        const foregroundTimeoutTimer = setTimeout(timeoutHandler, timeoutMs);

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
        timedOut: false,
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
    resolve: (result: ToolResult) => void,
    timeoutMessage: string | undefined
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
      timedOut: timeoutMessage !== undefined,
      ...(timeoutMessage !== undefined && { timeoutMessage }),
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
    // - Sync-call timeout (PRI-3251): Tool success=false, whatever the exit code

    if (timeoutMessage !== undefined || exitCode === null) {
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
