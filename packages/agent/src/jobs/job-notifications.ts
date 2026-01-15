// ABOUTME: Job notification system for progress updates and completion events
// This module handles job notifications including progress updates, completion notifications,
// and progress timer management for background jobs.

import { existsSync, statSync } from 'node:fs';
import { formatJobNotification } from './format-notification';
import { getLastLines } from './job-file-utils';
import { DEFAULT_PROGRESS_INTERVAL_MS } from '../server-types';
import { appendDurableEvent } from '../storage/event-log';
import { readSessionState, writeSessionState, loadSession } from '../storage/session-store';
import {
  type JobState,
  type JobNotificationType,
  type AgentServerState,
  type SessionUpdate,
} from '../server-types';

/**
 * Create a queue job notification function for a given server state.
 * Queue a job notification for delivery to the agent.
 * If the agent is idle (no active turn) and runPromptInternal is available,
 * triggers an internal turn to process the notification immediately.
 *
 * The runPromptInternal reference is accessed from the provided context object,
 * which allows it to be updated after creation.
 */
export function createQueueJobNotification(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null }
) {
  return (
    job: JobState,
    type: JobNotificationType,
    options?: { reason?: string; deltaBytes?: number }
  ) => {
    const outputBytes = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
    const durationMs = Date.now() - new Date(job.startedAt).getTime();
    // For delegate jobs show more context (last 8 lines) so parent can see questions
    // For bash jobs: completed shows 1 line, others show 3
    const lastLineCount = job.type === 'delegate' ? 8 : type === 'completed' ? 1 : 3;
    const lastLines = getLastLines(job.outputPath, lastLineCount);

    const content = formatJobNotification({
      jobId: job.jobId,
      type,
      jobType: job.type,
      exitCode: job.exitCode,
      durationMs,
      outputBytes,
      deltaBytes: options?.deltaBytes,
      lastLines,
      reason: options?.reason,
    });

    state.jobManager.queueNotification({
      jobId: job.jobId,
      type,
      content,
      createdAt: Date.now(),
    });

    // If agent is idle (no active turn), trigger an internal turn to process notifications
    if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
      // Use setImmediate to avoid blocking the current execution and allow any
      // in-flight state updates to complete before starting the turn
      setImmediate(() => {
        // Re-check conditions since state may have changed
        if (
          !state.activeTurn &&
          state.activeSession &&
          state.jobManager.getNotificationQueue().length > 0 &&
          runPromptInternalRef.current
        ) {
          void runPromptInternalRef.current([]);
        }
      });
    }
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
    options?: { reason?: string; deltaBytes?: number }
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

    if (job.status === 'running') {
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
