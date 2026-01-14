// ABOUTME: Job cancellation tool schema stub
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

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

  protected executeValidated(
    _args: z.infer<typeof jobKillSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'job_kill is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
