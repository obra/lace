// ABOUTME: Job output retrieval tool using JobManager
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const jobOutputSchema = z
  .object({
    jobId: NonEmptyString,
    byteOffset: z.number().int().min(0).default(0),
  })
  .strict();

export class JobOutputTool extends Tool {
  name = 'job_output';
  description = `Read a **snapshot** of status + stdout from a background job. **Read-only tool** — returns immediately and does NOT continue the conversation or wait for the job to finish.

**Mental model.** A job is one round; a session is the whole conversation. \`job_output\` shows what has come out of *this round* so far. To continue the conversation (add a follow-up message to the same subagent), call \`delegate(resume=jobId, prompt=...)\` — that creates a new job in the same session.

**To know when a job is done, use \`job_notify(jobId)\`, not polling.** \`job_output\` never blocks: if the job is still running you get the current partial output and \`status:"running"\`. Do NOT loop calling \`job_output\` to wait for completion. Instead call \`job_notify(jobId)\` (subscribe and return to the user); you'll be woken on a later turn when the job finishes.

Parameters:
- \`jobId\` (required): the job to inspect.
- \`byteOffset\` (default 0): reserved for future incremental reads.

Returns: \`{ status: "running"|"completed"|"failed"|"cancelled", output: string, exitCode?: number }\`.`;
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

    const { jobId } = args;

    const job = jobManager.getJob(jobId);
    if (!job) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: `Job ${jobId} not found` }],
      };
    }

    const output = jobManager.getJobOutput(jobId);

    const result = {
      jobId,
      status: job.status,
      output: output.trim() || '(no output)',
      ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
    };

    return {
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
}
