// ABOUTME: Delegate tool - spawns subagent jobs using JobManager
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const delegateSchema = z
  .object({
    prompt: NonEmptyString,
    description: z.string().optional(),
    background: z.boolean().default(false),
    resume: z.string().optional(),
    progressIntervalMs: z.number().int().min(5000).max(600000).optional(),
    connectionId: z.string().optional(),
    modelId: z.string().optional(),
  })
  .strict();

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Spawn a subagent to handle a task autonomously. ALL delegate jobs are resumable - the subagent session persists after completion.

Parameters:
- prompt: The task or message for the subagent (required)
- description: Label shown in job listings (optional)
- background: Set to true to return immediately with jobId (default: false)
- resume: JobId of a previous delegate job to continue its session
- progressIntervalMs: For background jobs, interval in ms for progress notifications (5000-600000, default 300000)
- connectionId: Provider connection to use for the subagent (optional, defaults to parent session's connection)
- modelId: Model to use for the subagent (optional, defaults to parent session's model)

**Sync mode (default):** Blocks until subagent completes. Output is prefixed with "delegate jobId=<id>". This jobId can be used with resume.

**Background mode:** Returns { jobId, status: "started" } immediately. This jobId can be used with resume.

**Resuming (works for BOTH sync and background jobs):**
To continue a conversation with a previous subagent:
  delegate(resume="<jobId>", prompt="your follow-up message")
The subagent receives your message with its full conversation history intact.`;
  schema = delegateSchema;
  annotations: ToolAnnotations = {
    title: 'Delegate',
    // Delegation itself is safe internal control flow - the subagent
    // handles its own permissions for any destructive operations
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof delegateSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager } = context;

    if (!jobManager) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'delegate requires jobManager in context' }],
      };
    }

    const { prompt, description, background, resume, progressIntervalMs, connectionId, modelId } =
      args;

    // Handle resume - look up previous job's session
    let resumeSessionId: string | undefined;
    if (resume) {
      const jobs = jobManager.listJobs();
      const previousJob = jobs.find((j) => j.jobId === resume);
      if (!previousJob?.subagentSessionId) {
        const jobIds = jobs.map((j) => j.jobId).join(', ');
        const withSession = jobs
          .filter((j) => j.subagentSessionId)
          .map((j) => `${j.jobId}=${j.subagentSessionId}`)
          .join(', ');
        return {
          status: 'failed',
          content: [
            {
              type: 'text',
              text:
                `Cannot resume job ${resume}: no subagentSessionId found.\n` +
                `Available jobs: [${jobIds}]\n` +
                `Jobs with sessionId: [${withSession || 'none'}]`,
            },
          ],
        };
      }
      resumeSessionId = previousJob.subagentSessionId;
    }

    // Create the job
    const { jobId, job } = await jobManager.createJob('delegate', {
      prompt,
      description,
      resumeSessionId,
      progressIntervalMs,
      connectionId,
      modelId,
      turnContext:
        context.turnId && context.turnSeq !== undefined
          ? { turnId: context.turnId, turnSeq: context.turnSeq }
          : undefined,
    });

    // Background mode - return immediately
    if (background) {
      return {
        status: 'completed',
        content: [{ type: 'text', text: JSON.stringify({ jobId, status: 'started' }) }],
      };
    }

    // Sync mode - wait for completion
    const abortPromise = new Promise<never>((_, reject) => {
      context.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
        once: true,
      });
    });

    try {
      await Promise.race([job.completion, abortPromise]);
    } catch {
      job.status = 'cancelled';
      await jobManager.finalizeJob(job);
    }

    // Read output
    const output = jobManager.getJobOutput(jobId);

    const status = job.status ?? 'failed';
    return {
      status: status === 'completed' ? 'completed' : status === 'cancelled' ? 'aborted' : 'failed',
      content: [
        {
          type: 'text',
          text:
            `delegate jobId=${jobId}\n\n` +
            (output.trim().length > 0 ? output.trim() : '(no output)'),
        },
      ],
    };
  }
}
