// ABOUTME: createQueueJobNotification composes <notification kind="job-*"> bodies
// ABOUTME: and writes them via injectNotification. Also exports the progress
// ABOUTME: timer + finalize-job helpers that drive the lifecycle.

import { existsSync, statSync } from 'node:fs';
import { getLastLines } from './job-file-utils';
import {
  DEFAULT_PROGRESS_INTERVAL_MS,
  DEFAULT_STALL_THRESHOLD_MS,
  STALL_CHECK_INTERVAL_MS,
} from '../server-types';
import { appendDurableEvent } from '../storage/event-log';
import { readSessionState, writeSessionState, loadSession } from '../storage/session-store';
import {
  type JobState,
  type JobNotificationType,
  type AgentServerState,
  type SessionUpdate,
} from '../server-types';
import { injectNotification } from '../notifications/inject-notification';
import {
  composeJobCompletedBody,
  composeJobFailedBody,
  composeJobCancelledBody,
  composeJobProgressBody,
  composeJobStalledBody,
} from '../notifications/composers';
import type { NotificationKind } from '../notifications/notification-wrapper';

function jobTypeToKind(type: JobNotificationType): NotificationKind {
  switch (type) {
    case 'completed':
      return 'job-completed';
    case 'failed':
      return 'job-failed';
    case 'cancelled':
      return 'job-cancelled';
    case 'progress':
      return 'job-progress';
    case 'stalled':
      return 'job-stalled';
  }
}

/**
 * Create a queue job notification function for a given server state.
 *
 * Builds a `<notification kind="job-*" job-id="...">` block via the unified
 * composers + injectNotification path. Subscription gating runs through
 * JobManager.fanoutToInject; the inject callback is invoked once per matching
 * subscription, or once via the fallback path when no subscription exists.
 *
 * If the agent is idle (no active turn) injectNotification's idleWake hook
 * triggers an internal turn so the just-written event is picked up
 * immediately.
 */
export function createQueueJobNotification(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null }
) {
  return (
    job: JobState,
    type: JobNotificationType,
    options?: { reason?: string; deltaBytes?: number; stalledForMs?: number }
  ) => {
    if (!state.activeSession) return;

    const outputBytes = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
    const durationMs = Date.now() - new Date(job.startedAt).getTime();
    // For delegate jobs show more context (last 8 lines) so parent can see questions.
    // For bash jobs: completed shows 1 line, others show 3.
    const lastLineCount = job.type === 'delegate' ? 8 : type === 'completed' ? 1 : 3;
    const lastLines = getLastLines(job.outputPath, lastLineCount);

    let body: string;
    switch (type) {
      case 'completed':
        body = composeJobCompletedBody({
          jobId: job.jobId,
          jobType: job.type,
          exitCode: job.exitCode ?? 0,
          durationMs,
          outputBytes,
          lastLines,
        });
        break;
      case 'failed':
        body = composeJobFailedBody({
          jobId: job.jobId,
          jobType: job.type,
          exitCode: job.exitCode ?? -1,
          durationMs,
          outputBytes,
          lastLines,
        });
        break;
      case 'cancelled':
        body = composeJobCancelledBody({
          jobId: job.jobId,
          jobType: job.type,
          durationMs,
          outputBytes,
          lastLines,
          ...(options?.reason ? { reason: options.reason } : {}),
        });
        break;
      case 'progress':
        body = composeJobProgressBody({
          jobId: job.jobId,
          durationMs,
          outputBytes,
          deltaBytes: options?.deltaBytes ?? 0,
          lastLines,
        });
        break;
      case 'stalled':
        body = composeJobStalledBody({
          jobId: job.jobId,
          durationMs,
          stalledForMs: options?.stalledForMs ?? 0,
          outputBytes,
          lastLines,
        });
        break;
    }

    const sessionDir = state.activeSession.dir;
    const kind = jobTypeToKind(type);
    // Filter regexes match against the raw tail preview,
    // not the surrounding wrapper. Only populated for 'progress' — terminal
    // kinds ignore filter by design.
    const preview = type === 'progress' ? lastLines.join('\n') : undefined;

    const doInject = () =>
      injectNotification({
        sessionDir,
        kind,
        identifiers: { 'job-id': job.jobId },
        body,
        idleWake: {
          isActive: (d) => d === state.activeSession?.dir,
          hasActiveTurn: () => !!state.activeTurn,
          triggerInternalTurn: () => {
            if (runPromptInternalRef.current) {
              setImmediate(() => {
                if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
                  void runPromptInternalRef.current([]);
                }
              });
            }
          },
        },
      });

    state.jobManager.fanoutToInject(job.jobId, type, { preview }, doInject);
  };
}

/**
 * Create a setup progress timer function for a given server state.
 * Set up a progress timer for a background job.
 * If progressIntervalMs is specified on the job, or if using the default for background jobs,
 * create a timer that queues progress notifications at the specified interval.
 */
export function createSetupProgressTimer(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null },
  queueJobNotification: (
    job: JobState,
    type: JobNotificationType,
    options?: { reason?: string; deltaBytes?: number; stalledForMs?: number }
  ) => void
) {
  return (job: JobState) => {
    // Use provided interval or default for background jobs
    const progressInterval = job.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;

    job.lastProgressAt = Date.now();
    job.lastProgressBytes = 0;

    job.progressTimer = setInterval(() => {
      // Stop timer if job is no longer running
      if (job.status !== 'running') {
        if (job.progressTimer) {
          clearInterval(job.progressTimer);
          job.progressTimer = undefined;
        }
        return;
      }

      const currentBytes = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
      const deltaBytes = currentBytes - (job.lastProgressBytes ?? 0);

      queueJobNotification(job, 'progress', { deltaBytes });

      job.lastProgressAt = Date.now();
      job.lastProgressBytes = currentBytes;
    }, progressInterval);
  };
}

/**
 * Create the stall-timer arming function. Unlike the progress timer this is
 * ALWAYS-ON: it is armed for every job at creation with no subscriber opt-in,
 * because the point is noticing the job nobody is watching. Each tick stats
 * the output file; when the size has not changed for DEFAULT_STALL_THRESHOLD_MS
 * while the job is still running, it queues ONE 'stalled' notification and
 * re-arms only after output resumes (so a resumed-then-wedged job fires again).
 * A byte-count proxy is valid because appends are monotonic up to the output
 * cap; a job pinned at MAX_JOB_OUTPUT_BYTES reads as stalled, which is the
 * honest signal for a caller to inspect either way.
 */
export function createSetupStallTimer(
  queueJobNotification: (
    job: JobState,
    type: JobNotificationType,
    options?: { reason?: string; deltaBytes?: number; stalledForMs?: number }
  ) => void
) {
  return (job: JobState) => {
    job.lastOutputChangeAt = Date.now();
    job.lastStallBytes = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
    job.stalledNotified = false;

    job.stallTimer = setInterval(() => {
      if (job.status !== 'running') {
        if (job.stallTimer) {
          clearInterval(job.stallTimer);
          job.stallTimer = undefined;
        }
        return;
      }

      const currentBytes = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
      if (currentBytes !== (job.lastStallBytes ?? 0)) {
        job.lastStallBytes = currentBytes;
        job.lastOutputChangeAt = Date.now();
        job.stalledNotified = false;
        return;
      }

      const stalledForMs = Date.now() - (job.lastOutputChangeAt ?? Date.now());
      if (!job.stalledNotified && stalledForMs >= DEFAULT_STALL_THRESHOLD_MS) {
        job.stalledNotified = true;
        queueJobNotification(job, 'stalled', { stalledForMs });
      }
    }, STALL_CHECK_INTERVAL_MS);
  };
}

/**
 * Create a finalize job function for a given server state.
 * Finalizes a job by marking it as finished, emitting updates, and queueing notifications.
 */
export function createFinalizeJob(
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  emitSessionUpdate: (update: SessionUpdate) => Promise<void>,
  queueJobNotification: (job: JobState, type: JobNotificationType) => void
) {
  return async (job: JobState, options: { exitCode?: number } = {}) => {
    if (!state.activeSession) return;
    if (job.finished) {
      job.resolveCompletion();
      return;
    }

    // 'interrupted' is a derived status (log-running with no live process
    // after a restart) and never appears on a JobState we own; the branch
    // exists to narrow the type alongside 'running'.
    if (job.status === 'running' || job.status === 'interrupted') {
      job.status = 'failed';
    }

    if (typeof options.exitCode === 'number') {
      job.exitCode = options.exitCode;
    }

    job.proc = undefined;
    job.childPeer = undefined;
    job.subagentSessionId = undefined;
    job.childTransportClose = undefined;
    job.finished = true;

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_finished',
        data: {
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          outcome: job.status,
          ...(typeof options.exitCode === 'number' ? { exitCode: options.exitCode } : {}),
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    await emitSessionUpdate({
      type: 'job_finished',
      jobId: job.jobId,
      parentJobId: job.parentJobId,
      ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
      outcome: job.status,
    });

    // Clear progress timer if running
    if (job.progressTimer) {
      clearInterval(job.progressTimer);
      job.progressTimer = undefined;
    }
    if (job.stallTimer) {
      clearInterval(job.stallTimer);
      job.stallTimer = undefined;
    }

    // Queue completion notification for the agent
    const notificationType: JobNotificationType =
      job.status === 'completed'
        ? 'completed'
        : job.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    queueJobNotification(job, notificationType);

    job.resolveCompletion();
  };
}
