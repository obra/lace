// ABOUTME: Background job management RPC handlers for listing, monitoring, and controlling jobs

import { AcpErrorCodes, EntErrorCodes, type JsonRpcPeer } from '@lace/ent-protocol';
import type { AgentServerState } from '../../server-types';
import { assertInitialized, throwInvalidParams, toNonEmptyString } from '../utils';
import { getJobOutputPath, readJobOutput, killJob } from '../../jobs';

/**
 * Register job management handlers with the peer.
 * - list: Returns all jobs for the active session
 * - output: Retrieves job output with optional blocking and tail support
 * - kill: Terminates a running job
 * - inject: Injects content into a delegate job
 */
export function registerJobHandlers(peer: JsonRpcPeer, state: AgentServerState): void {
  peer.onRequest('ent/job/list', async (_params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const jobs = state.jobManager.listJobs().map((j) => ({
      jobId: j.jobId,
      parentJobId: j.parentJobId,
      type: j.type,
      status: j.status,
      description: j.description,
      command: j.command,
      startTime: j.startTime,
      ...(j.subagentSessionId ? { subagentSessionId: j.subagentSessionId } : {}),
    }));

    return { jobs };
  });

  peer.onRequest('ent/job/output', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as {
      jobId: string;
      block?: boolean;
      timeout?: number;
      tailBytes?: number;
      afterOffset?: number;
    };

    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) throwInvalidParams('jobId is required');

    const block = !!parsed.block;
    const timeout = typeof parsed.timeout === 'number' && parsed.timeout > 0 ? parsed.timeout : 0;

    const runningJob = state.jobManager.getJob(jobId);
    if (block && runningJob?.status === 'running') {
      await Promise.race([
        runningJob.completion,
        timeout > 0
          ? new Promise<void>((resolve) => setTimeout(resolve, timeout))
          : new Promise<void>(() => {}),
      ]);
    }

    const jobs = state.jobManager.listJobs();
    const record = jobs.find((j) => j.jobId === jobId);
    if (!record)
      throw {
        code: EntErrorCodes.JobNotFound,
        message: 'JobNotFound',
        data: { category: 'session' },
      };

    const sessionDir = state.activeSession.dir;
    const outputPath = getJobOutputPath(sessionDir, jobId);

    const afterOffset =
      typeof parsed.afterOffset === 'number' && parsed.afterOffset >= 0 ? parsed.afterOffset : 0;
    const tailBytes =
      typeof parsed.tailBytes === 'number' && parsed.tailBytes > 0 ? parsed.tailBytes : 0;

    const result = readJobOutput(outputPath, {
      afterOffset,
      tailBytes: tailBytes > 0 ? tailBytes : undefined,
    });

    return {
      status: record.status,
      output: result.output,
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      outputMeta: {
        totalBytes: result.totalBytes,
        returnedOffset: result.returnedOffset,
        returnedBytes: result.returnedBytes,
        // RPC API defines truncated as "didn't return from start" for backward compatibility
        truncated: result.returnedOffset > 0,
      },
      report: {
        summary:
          record.status === 'completed'
            ? 'Job completed'
            : record.status === 'cancelled'
              ? 'Job cancelled'
              : record.status === 'running'
                ? 'Job running'
                : 'Job failed',
        ...(record.status === 'failed' ? { error: 'Job failed' } : {}),
      },
    };
  });

  peer.onRequest('ent/job/kill', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as { jobId: string };
    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) throwInvalidParams('jobId is required');

    const job = state.jobManager.getJob(jobId);
    if (!job || job.status !== 'running') return { success: false };

    if (job.proc) {
      // Kill the process with SIGTERM, then SIGKILL if still running
      await killJob(job, { waitMs: 500, forceKill: true });

      // Wait extra time after SIGKILL for stubborn processes.
      if (!job.finished) {
        await Promise.race([
          job.completion,
          new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
        ]);
      }

      return { success: true };
    }

    // Job is awaiting permission or otherwise not yet started; finalize immediately.
    await killJob(job); // Sets status to cancelled and aborts permission controller
    await state.jobManager.finalizeJob(job);

    return { success: true };
  });

  peer.onRequest('ent/job/inject', async (params: unknown) => {
    const parsed = params as { jobId: string; content: unknown[]; priority: string };
    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) return undefined;

    const job = state.jobManager.getJob(jobId);
    if (!job || job.type !== 'delegate' || job.finished) return undefined;
    if (!job.childPeer) return undefined;

    const priority =
      parsed?.priority === 'immediate' ||
      parsed?.priority === 'normal' ||
      parsed?.priority === 'deferred'
        ? parsed.priority
        : 'normal';

    job.childPeer.notify('ent/session/inject', {
      content: Array.isArray(parsed?.content) ? parsed.content : [],
      priority,
    });

    return undefined;
  });
}
