// ABOUTME: Background job management RPC handlers for listing, monitoring, and controlling jobs

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AcpErrorCodes, EntErrorCodes, type JsonRpcPeer } from '@lace/ent-protocol';
import type { AgentServerState, JobStatus, JobType } from '../../server-types';
import { assertInitialized, throwInvalidParams, toNonEmptyString } from '../utils';
import { getJobOutputPath } from '../../jobs/job-manager';
import { logger } from '../../utils/logger';

/**
 * Register job management handlers with the peer.
 * - list: Returns all jobs for the active session
 * - output: Retrieves job output with optional blocking and tail support
 * - kill: Terminates a running job
 * - inject: Injects content into a delegate job
 */
export function registerJobHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  deriveJobsForActiveSession: () => Array<{
    jobId: string;
    parentJobId?: string;
    type: JobType;
    status: JobStatus;
    description?: string;
    command?: string;
    startTime: string;
    exitCode?: number;
    subagentSessionId?: string;
  }>,
  finalizeJob: (job: any) => Promise<void>
): void {
  peer.onRequest('ent/job/list', async (_params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const jobs = deriveJobsForActiveSession().map((j) => ({
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

    const runningJob = state.jobs.get(jobId);
    if (block && runningJob?.status === 'running') {
      await Promise.race([
        runningJob.completion,
        timeout > 0
          ? new Promise<void>((resolve) => setTimeout(resolve, timeout))
          : new Promise<void>(() => {}),
      ]);
    }

    const jobs = deriveJobsForActiveSession();
    const record = jobs.find((j) => j.jobId === jobId);
    if (!record)
      throw {
        code: EntErrorCodes.JobNotFound,
        message: 'JobNotFound',
        data: { category: 'session' },
      };

    const sessionDir = state.activeSession.dir;
    const outputPath = getJobOutputPath(sessionDir, jobId);

    let totalBytes = 0;
    try {
      totalBytes = statSync(outputPath).size;
    } catch {
      totalBytes = 0;
    }

    const afterOffset =
      typeof parsed.afterOffset === 'number' && parsed.afterOffset >= 0 ? parsed.afterOffset : 0;
    const tailBytes =
      typeof parsed.tailBytes === 'number' && parsed.tailBytes > 0 ? parsed.tailBytes : 0;

    const clampedAfter = Math.min(afterOffset, totalBytes);
    const startOffset =
      tailBytes > 0 ? Math.max(clampedAfter, totalBytes - tailBytes) : clampedAfter;
    const bytesToRead = Math.max(0, totalBytes - startOffset);

    let output = '';
    if (bytesToRead > 0) {
      const fd = openSync(outputPath, 'r');
      try {
        const buf = Buffer.allocUnsafe(bytesToRead);
        const read = readSync(fd, buf, 0, bytesToRead, startOffset);
        output = buf.subarray(0, read).toString('utf8');
      } finally {
        closeSync(fd);
      }
    }

    return {
      status: record.status,
      output,
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      outputMeta: {
        totalBytes,
        returnedOffset: startOffset,
        returnedBytes: Buffer.byteLength(output, 'utf8'),
        truncated: startOffset > 0,
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

    const job = state.jobs.get(jobId);
    if (!job || job.status !== 'running') return { success: false };

    job.status = 'cancelled';

    if (job.proc) {
      const proc = job.proc;
      try {
        // Kill the entire process group on POSIX so we don't leak child processes (e.g. `sleep`)
        // that can keep the shell alive and prevent job completion/finalization.
        if (process.platform !== 'win32' && typeof proc.pid === 'number') {
          process.kill(-proc.pid, 'SIGTERM');
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        return { success: false };
      }

      // Best-effort: wait briefly for graceful shutdown; if still running, escalate.
      await Promise.race([
        job.completion,
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
      if (!job.finished) {
        try {
          if (process.platform !== 'win32' && typeof proc.pid === 'number') {
            process.kill(-proc.pid, 'SIGKILL');
          } else {
            proc.kill('SIGKILL');
          }
        } catch (error) {
          // SIGTERM was already sent; process may have exited
          logger.debug('job.kill.sigkill.failed', {
            jobId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        await Promise.race([
          job.completion,
          new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
        ]);
      }

      return { success: true };
    }

    // Job is awaiting permission or otherwise not yet started; finalize immediately.
    if (job.permissionAbortController) {
      job.permissionAbortController.abort();
      job.permissionAbortController = undefined;
    }
    await finalizeJob(job);

    return { success: true };
  });

  peer.onRequest('ent/job/inject', async (params: unknown) => {
    const parsed = params as { jobId: string; content: unknown[]; priority: string };
    const jobId = toNonEmptyString(parsed?.jobId);
    if (!jobId) return undefined;

    const job = state.jobs.get(jobId);
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
