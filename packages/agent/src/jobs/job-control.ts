// ABOUTME: Job lifecycle control - killing, cancelling, waiting for jobs.
// This module consolidates job termination logic that was duplicated across
// session.ts, jobs.ts, and job-tools.ts.

import type { JobState } from '../server-types';
import { logger } from '../utils/logger';

export interface KillJobOptions {
  /** Max time to wait for graceful shutdown before returning (ms). Default: 500 */
  waitMs?: number;
  /** Whether to send SIGKILL after waitMs if process still running. Default: false */
  forceKill?: boolean;
}

/**
 * Kill a single job, handling process termination and cleanup.
 *
 * This function:
 * 1. Sets job status to 'cancelled' if currently 'running'
 * 2. Aborts any pending permission requests
 * 3. Sends SIGTERM to the process (or process group on POSIX)
 * 4. Waits up to `waitMs` for graceful shutdown
 * 5. Optionally sends SIGKILL if `forceKill` is true and process still running
 */
export async function killJob(job: JobState, options?: KillJobOptions): Promise<void> {
  const { waitMs = 500, forceKill = false } = options ?? {};

  if (job.status !== 'running') {
    return;
  }

  job.status = 'cancelled';

  // Abort any pending permission requests
  job.permissionAbortController?.abort();

  // Kill the process if it exists
  if (job.proc) {
    const proc = job.proc;
    try {
      // On POSIX, kill the entire process group (negative PID) so we don't leak
      // child processes (e.g. `sleep`) that can keep the shell alive
      if (process.platform !== 'win32' && typeof proc.pid === 'number') {
        process.kill(-proc.pid, 'SIGTERM');
      } else {
        proc.kill('SIGTERM');
      }
    } catch (error) {
      logger.debug('job.kill.sigterm.failed', {
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Wait for graceful shutdown (race between completion and timeout)
    if (proc.exitCode === null) {
      await Promise.race([
        job.completion,
        new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
      ]);
    }

    // Force kill if still running and forceKill is enabled
    if (forceKill && proc.exitCode === null) {
      try {
        if (process.platform !== 'win32' && typeof proc.pid === 'number') {
          process.kill(-proc.pid, 'SIGKILL');
        } else {
          proc.kill('SIGKILL');
        }
      } catch (error) {
        // Process may have already exited
        logger.debug('job.kill.sigkill.failed', {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else if (job.containerExec) {
    // Persona-container subagent: kill the in-container exec process. The
    // container itself persists (across delegates, across Ada restart).
    const exec = job.containerExec;
    try {
      exec.kill('SIGTERM');
    } catch (error) {
      logger.debug('job.kill.sigterm.failed', {
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await Promise.race([
      job.completion,
      new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
    ]);

    if (forceKill && !job.finished) {
      try {
        exec.kill('SIGKILL');
      } catch (error) {
        logger.debug('job.kill.sigkill.failed', {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * Kill all running jobs in a job map.
 * Processes all kills in parallel for faster cleanup.
 */
export async function killAllRunningJobs(
  jobs: Map<string, JobState>,
  options?: KillJobOptions
): Promise<void> {
  const runningJobs = [...jobs.values()].filter((job) => job.status === 'running');

  await Promise.all(runningJobs.map((job) => killJob(job, options)));
}
