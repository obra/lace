// ABOUTME: Handlers for job management tools (job_output, jobs_list, job_kill)
// These tools query and control background jobs (shell and delegate)

import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { getJobOutputPath } from '@lace/agent/jobs/job-manager';
import type { SpecialToolContext, SpecialToolResult } from './types';

/**
 * Execute job_output tool - read output from a background job
 */
export async function executeJobOutput(
  input: {
    jobId?: string;
    block?: boolean;
    timeoutMs?: number;
    byteOffset?: number;
  },
  context: SpecialToolContext
): Promise<SpecialToolResult> {
  const { jobId, block = true, timeoutMs = 30_000, byteOffset = 0 } = input;

  if (!jobId) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: 'job_output.jobId is required' }],
    };
  }

  // Block until job completion if requested
  const jobs = context.getJobs();
  const runningJob = jobs.get(jobId);
  if (block && runningJob?.status === 'running') {
    await Promise.race([
      runningJob.completion,
      timeoutMs > 0
        ? new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
        : new Promise<void>(() => {}),
    ]);
  }

  // Look up job from derived list (includes persisted jobs)
  const allJobs = context.deriveJobs();
  const record = allJobs.find((j) => j.jobId === jobId);

  if (!record) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: `Job not found: ${jobId}` }],
    };
  }

  const outputPath = getJobOutputPath(context.sessionDir, jobId);

  let totalBytes = 0;
  try {
    totalBytes = statSync(outputPath).size;
  } catch {
    totalBytes = 0;
  }

  const clampedOffset = Math.min(byteOffset, totalBytes);
  const bytesToRead = Math.max(0, totalBytes - clampedOffset);

  let output = '';
  if (bytesToRead > 0) {
    const fd = openSync(outputPath, 'r');
    try {
      const buf = Buffer.allocUnsafe(bytesToRead);
      const read = readSync(fd, buf, 0, bytesToRead, clampedOffset);
      output = buf.subarray(0, read).toString('utf8');
    } finally {
      closeSync(fd);
    }
  }

  const result = {
    jobId,
    status: record.status,
    output,
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    byteOffset: totalBytes,
  };

  return {
    status: 'completed',
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

/**
 * Execute jobs_list tool - list background jobs with optional filtering
 */
export async function executeJobsList(
  input: {
    status?: string[];
    type?: string[];
    limit?: number;
  },
  context: SpecialToolContext
): Promise<SpecialToolResult> {
  const { status: statusFilter, type: typeFilter, limit = 50 } = input;

  let jobs = context.deriveJobs().map((j) => ({
    jobId: j.jobId,
    parentJobId: j.parentJobId,
    type: j.type,
    status: j.status,
    description: j.description,
    command: j.command,
    startTime: j.startTime,
    ...(j.subagentSessionId ? { subagentSessionId: j.subagentSessionId } : {}),
  }));

  // Apply filters
  if (statusFilter && statusFilter.length > 0) {
    jobs = jobs.filter((j) => statusFilter.includes(j.status));
  }
  if (typeFilter && typeFilter.length > 0) {
    jobs = jobs.filter((j) => typeFilter.includes(j.type));
  }

  // Apply limit
  jobs = jobs.slice(0, limit);

  return {
    status: 'completed',
    content: [{ type: 'text', text: JSON.stringify({ jobs }, null, 2) }],
  };
}

/**
 * Execute job_kill tool - terminate a running background job
 */
export async function executeJobKill(
  input: {
    jobId?: string;
  },
  context: SpecialToolContext
): Promise<SpecialToolResult> {
  const { jobId } = input;

  if (!jobId) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: 'job_kill.jobId is required' }],
    };
  }

  const jobs = context.getJobs();
  const job = jobs.get(jobId);

  if (!job || job.status !== 'running') {
    return {
      status: 'completed',
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: false, reason: 'Job not running' }),
        },
      ],
    };
  }

  job.status = 'cancelled';

  let killed = false;
  if (job.proc) {
    const proc = job.proc;
    try {
      // Kill the entire process group on POSIX so we don't leak child processes
      if (process.platform !== 'win32' && typeof proc.pid === 'number') {
        process.kill(-proc.pid, 'SIGTERM');
      } else {
        proc.kill('SIGTERM');
      }
      killed = true;
    } catch {
      killed = false;
    }
  } else {
    // Subagent job - just mark as cancelled (completion promise will resolve)
    killed = true;
  }

  return {
    status: 'completed',
    content: [{ type: 'text', text: JSON.stringify({ success: killed }) }],
  };
}
