// ABOUTME: Job output retrieval tool using JobManager
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

/**
 * Minimum blocking-wait timeout when `block=true`. Mirrors serf's
 * `minWaitTimeoutMS = 120_000` — any shorter wait encourages a rapid-retry
 * polling loop, which is exactly the failure mode `job_notify` exists to
 * prevent. Any `timeoutMs` below this is clamped up.
 */
export const JOB_OUTPUT_MIN_BLOCKING_TIMEOUT_MS = 120_000;

const jobOutputSchema = z.object({
  jobId: NonEmptyString,
  block: z.boolean().default(true),
  timeoutMs: z.number().int().min(0).max(600_000).default(30_000),
  byteOffset: z.number().int().min(0).default(0),
});

export class JobOutputTool extends Tool {
  name = 'job_output';
  description = `Read status + stdout from a background job. **Read-only tool** — does NOT continue the conversation.

**Mental model.** A job is one round; a session is the whole conversation. \`job_output\` shows what came out of *this round*. To continue the conversation (add a follow-up message to the same subagent), call \`delegate(resume=jobId, prompt=...)\` — that creates a new job in the same session.

**Use \`job_notify\`, not blocking waits, to know when a job is done.** Blocking here brings the parent's conversation to a halt. If you set \`block=true\`, the timeout is clamped to a minimum of 120s — anything shorter would be polling.

Parameters:
- \`jobId\` (required): the job to inspect.
- \`block\` (default true): wait for the job to finish before returning. If you only want a snapshot of current state, pass \`block=false\`.
- \`timeoutMs\` (default 30_000): blocking wait cap. **Clamped to a minimum of 120_000** (120s) when \`block=true\`. To wait longer than two minutes, subscribe with \`job_notify(jobId)\` instead and return to the user; the next-turn injection will wake you.
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

    const { jobId, block, timeoutMs } = args;

    const job = jobManager.getJob(jobId);
    if (!job) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: `Job ${jobId} not found` }],
      };
    }

    // If blocking mode and job is still running, wait for completion.
    // Clamp the wait up to the 120s minimum — anything shorter encourages a
    // polling loop, which is exactly what job_notify exists to replace.
    if (block && job.status === 'running') {
      const effectiveTimeoutMs = Math.max(timeoutMs, JOB_OUTPUT_MIN_BLOCKING_TIMEOUT_MS);
      const timeoutPromise = new Promise<void>((resolve) =>
        setTimeout(resolve, effectiveTimeoutMs)
      );
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
