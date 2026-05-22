// ABOUTME: Subagent child-exit persistence — PRI-1774
// ABOUTME: When a spawned subagent process exits non-zero (or by signal) before
// ABOUTME: the parent's in-flight RPC completes, the buffered stderr never
// ABOUTME: lands on disk. This helper writes a [SUBAGENT CHILD EXITED] block
// ABOUTME: with the captured stderr to the per-job .log file synchronously so
// ABOUTME: the diagnostic survives even if the surrounding async path hangs.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '@lace/agent/utils/logger';

export interface PersistSubagentChildExitOptions {
  jobId: string;
  outputPath: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

/**
 * Persist a child-exit diagnostic to the per-job log file when the subagent
 * process exits abnormally (non-zero exit code OR killed by signal). A normal
 * shutdown (exitCode === 0) is treated as a no-op so successful subagent runs
 * don't accrete spurious "[SUBAGENT CHILD EXITED]" blocks.
 *
 * Returns true if anything was written, false otherwise.
 */
export function persistSubagentChildExit(opts: PersistSubagentChildExitOptions): boolean {
  const { jobId, outputPath, exitCode, signal, stderr } = opts;

  // exitCode === 0 is a clean shutdown — nothing to persist. exitCode === null
  // means the child died from a signal (kill/SIGSEGV/etc.), which we do want
  // to capture.
  if (exitCode === 0) return false;

  try {
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const lines: string[] = ['', '[SUBAGENT CHILD EXITED]'];
    if (exitCode !== null) lines.push(`exitCode: ${exitCode}`);
    if (signal !== null) lines.push(`signal: ${signal}`);
    const trimmedStderr = stderr.trim();
    if (trimmedStderr) {
      lines.push('stderr:');
      lines.push(trimmedStderr);
    }
    lines.push('');

    appendFileSync(outputPath, lines.join('\n'), { encoding: 'utf8' });
    return true;
  } catch (err) {
    logger.error('job.subagent.persist_child_exit_failed', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
