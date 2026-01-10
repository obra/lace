// ABOUTME: Handler for delegate tool - spawns subagent jobs
// Delegate runs a prompt in a new agent session, optionally in background

import { readFileSync } from 'node:fs';
import { getJobOutputPath } from '@lace/agent/jobs/job-manager';
import type { SpecialToolContext, SpecialToolResult } from './types';

export interface DelegateInput {
  prompt?: string;
  description?: string;
  background?: boolean;
  resume?: string;
  connectionId?: string;
  modelId?: string;
}

/**
 * Execute delegate tool - spawn a subagent to handle a task
 */
export async function executeDelegate(
  input: DelegateInput,
  context: SpecialToolContext
): Promise<SpecialToolResult> {
  const { prompt, description, background = false, resume: resumeJobId, connectionId, modelId } =
    input;

  // Validate prompt
  if (!prompt) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: 'delegate.prompt is required' }],
    };
  }

  // If resuming, look up the previous job's subagentSessionId
  let resumeSessionId: string | undefined;
  if (resumeJobId) {
    const jobs = context.getJobs();
    const previousJob = jobs.get(resumeJobId);
    if (!previousJob?.subagentSessionId) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: `Cannot resume job ${resumeJobId}: no subagentSessionId found` }],
      };
    }
    resumeSessionId = previousJob.subagentSessionId;
  }

  // Start the subagent job
  const { jobId } = await context.startSubagentJob({
    prompt,
    description: description || 'Delegate',
    turnContext: { turnId: context.turnId, turnSeq: context.turnSeq },
    resumeSessionId,
    connectionId,
    modelId,
  });

  // If background mode, return immediately
  if (background) {
    return {
      status: 'completed',
      content: [
        {
          type: 'text',
          text: JSON.stringify({ jobId, status: 'started' }),
        },
      ],
    };
  }

  // Wait for job completion
  const jobs = context.getJobs();
  const job = jobs.get(jobId);
  if (job) {
    const abortPromise = new Promise<never>((_, reject) => {
      context.abortSignal.addEventListener('abort', () => reject(new Error('cancelled')), {
        once: true,
      });
    });

    try {
      await Promise.race([job.completion, abortPromise]);
    } catch {
      job.status = 'cancelled';
      await context.finalizeJob(job);
    }
  }

  // Read output
  let output = '';
  try {
    output = readFileSync(getJobOutputPath(context.sessionDir, jobId), 'utf8');
  } catch {
    output = '';
  }

  const tailLimit = 64 * 1024;
  const truncated = output.length > tailLimit;
  const reportText = truncated ? output.slice(-tailLimit) : output;

  const status = job?.status ?? 'failed';
  return {
    status: status === 'completed' ? 'completed' : status === 'cancelled' ? 'aborted' : 'failed',
    content: [
      {
        type: 'text',
        text:
          `delegate jobId=${jobId}\n\n` +
          (reportText.trim().length > 0 ? reportText.trim() : '(no output)') +
          (truncated ? '\n\n(truncated)' : ''),
      },
    ],
  };
}
