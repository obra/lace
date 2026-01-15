// ABOUTME: Job cancellation tool using JobManager
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const jobKillSchema = z.object({
  jobId: NonEmptyString,
});

export class JobKillTool extends Tool {
  name = 'job_kill';
  description = `Cancel a running background job. Only jobs with status="running" can be killed.

After killing, status becomes "cancelled". For subagent jobs, the session is preserved - use delegate(resume=jobId) to continue later.`;
  schema = jobKillSchema;
  annotations: ToolAnnotations = {
    title: 'Kill Job',
    // Internal job management - cancels jobs without external side effects
    // The job itself may have been doing dangerous things, but killing it
    // just stops work rather than causing harm
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof jobKillSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager } = context;

    if (!jobManager) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'job_kill requires jobManager in context' }],
      };
    }

    const { jobId } = args;

    const job = jobManager.getJob(jobId);
    if (!job) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: `Job ${jobId} not found` }],
      };
    }

    if (job.status !== 'running') {
      return {
        status: 'failed',
        content: [{ type: 'text', text: `Job ${jobId} is not running (status: ${job.status})` }],
      };
    }

    await jobManager.cancelJob(jobId);

    return {
      status: 'completed',
      content: [{ type: 'text', text: `Job ${jobId} cancelled` }],
    };
  }
}
