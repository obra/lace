// ABOUTME: Job output retrieval tool using JobManager
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const jobOutputSchema = z.object({
  jobId: NonEmptyString,
  block: z.boolean().default(true),
  timeoutMs: z.number().int().min(0).max(600_000).default(30_000),
  byteOffset: z.number().int().min(0).default(0),
});

export class JobOutputTool extends Tool {
  name = 'job_output';
  description = `Get status and output from a background job (started with background=true).

**Blocking (default):** Waits up to timeoutMs for job completion, then returns.
**Non-blocking:** Set block=false to check current status without waiting.
**Incremental:** Use byteOffset to read new output since last check.

Returns: { status: "running"|"completed"|"failed"|"cancelled", output: string, exitCode?: number }`;
  schema = jobOutputSchema;
  annotations: ToolAnnotations = {
    title: 'Get Job Output',
    // Internal job management - queries job state without side effects
    safeInternal: true,
    readOnlySafe: true,
  };

  protected async executeValidated(
    args: z.infer<typeof jobOutputSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager } = context;

    if (!jobManager) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'job_output requires jobManager in context' }],
      };
    }

    const { jobId, block, timeoutMs } = args;

    const job = jobManager.getJob(jobId);
    if (!job) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: `Job ${jobId} not found` }],
      };
    }

    // If blocking mode and job is still running, wait for completion
    if (block && job.status === 'running') {
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
      await Promise.race([job.completion, timeoutPromise]);
    }

    // Re-fetch job state after potential wait
    const currentJob = jobManager.getJob(jobId);
    const output = jobManager.getJobOutput(jobId);

    const status = currentJob?.status ?? job.status;
    const exitCode = currentJob?.exitCode ?? job.exitCode;

    const result = {
      jobId,
      status,
      output: output.trim() || '(no output)',
      ...(typeof exitCode === 'number' ? { exitCode } : {}),
    };

    return {
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
}
