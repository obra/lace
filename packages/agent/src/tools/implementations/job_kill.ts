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
  description = `Cancel a running background **job**. Only jobs with \`status="running"\` can be killed.

**Killing a job does NOT destroy its session.** A delegate job's session — the subagent's conversation history — survives. You can pick the conversation back up later with \`delegate(resume=<killed jobId>, prompt=...)\`; that creates a new job under the same session, with the subagent's prior history intact. Use this when a delegate has gone off-track or stalled and you want to redirect it in a follow-up round.

After killing, the job transitions to \`cancelled\`. If you have an active \`job_notify\` subscription on this jobId with \`'cancelled'\` in its \`on\` set, you'll receive a notification on your next turn.`;
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
