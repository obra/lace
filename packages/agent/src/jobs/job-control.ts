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
      // Group kill fails with ESRCH when the child is not a process-group
      // leader (subagents are not spawned detached). Fall back to signaling
      // the process directly rather than silently not killing anything.
      try {
        proc.kill('SIGTERM');
      } catch (fallbackError) {
        logger.debug('job.kill.sigterm.fallback.failed', {
          jobId: job.jobId,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    // Wait for graceful shutdown (race between completion and timeout)
    if (proc.exitCode === null) {
      await Promise.race([
        job.completion,
        new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
      ]);
    }

    // Force kill if still running and forceKill is enabled
    if (forceKill && proc.exitCode === null && proc.signalCode === null) {
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
        try {
          proc.kill('SIGKILL');
        } catch (fallbackError) {
          logger.debug('job.kill.sigkill.fallback.failed', {
            jobId: job.jobId,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }
    }
  }
}

export interface TerminateJobOptions {
  /** Grace period between SIGTERM and SIGKILL (ms). Default: 2000 */
  termWaitMs?: number;
  /** Max time to wait for the process to actually exit (ms). Default: 3000 */
  exitWaitMs?: number;
}

/**
 * Terminate a running job's work for real, and report whether it stopped.
 *
 * killJob alone signals the host-side process; for a delegate that leaves two
 * gaps: (1) an in-flight tool call running INSIDE a container survives the
 * host-side exec client dying, and (2) nothing confirms the process is gone
 * before the caller is told the job is cancelled. This function closes both:
 *
 * 1. Notifies the child agent (`session/cancel`) so it aborts its active turn —
 *    the abort signal propagates into running tools (bash SIGTERM, container
 *    exec kill), which is the only path that stops in-container work.
 * 2. killJob: SIGTERM (group, with direct fallback) → grace → SIGKILL.
 * 3. Waits for the process to actually exit, bounded by exitWaitMs.
 * 4. Closes the child peer + transport so the parent-side job driver's pending
 *    RPC rejects and the job finalizes even on a clean child exit.
 *
 * Returns true when the process is confirmed dead (or there was none), false
 * when it survived the wait — callers must NOT report the job as cancelled in
 * that case.
 */
export async function terminateJob(job: JobState, options?: TerminateJobOptions): Promise<boolean> {
  const { termWaitMs = 2000, exitWaitMs = 3000 } = options ?? {};

  if (job.status !== 'running') return true;

  if (job.childPeer && job.subagentSessionId) {
    try {
      job.childPeer.notify('session/cancel', { sessionId: job.subagentSessionId });
    } catch (error) {
      logger.debug('job.terminate.cancel_notify.failed', {
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await killJob(job, { waitMs: termWaitMs, forceKill: true });

  const stopped = await waitForProcessExit(job.proc, exitWaitMs);

  try {
    job.childPeer?.close();
  } catch (error) {
    logger.debug('job.terminate.close_peer.failed', {
      jobId: job.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    job.childTransportClose?.();
  } catch (error) {
    logger.debug('job.terminate.close_transport.failed', {
      jobId: job.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return stopped;
}

function waitForProcessExit(proc: JobState['proc'], waitMs: number): Promise<boolean> {
  if (!proc) return Promise.resolve(true);
  // A signal-killed process has exitCode null but signalCode set.
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      proc.removeListener('exit', onExit);
      resolve(proc.exitCode !== null || proc.signalCode !== null);
    }, waitMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    proc.once('exit', onExit);
  });
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
