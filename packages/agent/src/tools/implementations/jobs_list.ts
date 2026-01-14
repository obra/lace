// ABOUTME: Job listing tool schema stub
// ABOUTME: Executed by lace-agent runtime (not via ToolExecutor)

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const jobsListSchema = z.object({
  status: z.array(z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])).optional(),
  type: z.array(z.enum(['bash', 'delegate'])).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export class JobsListTool extends Tool {
  name = 'jobs_list';
  description = `List all background jobs in the current session. Use to find jobIds for job_output or job_kill.

Filter by status: ["pending", "running", "completed", "failed", "cancelled"]
Filter by type: ["bash", "delegate"]

Returns: [{ jobId, type, status, description, startTime }]`;
  schema = jobsListSchema;
  annotations: ToolAnnotations = {
    title: 'List Jobs',
    // Internal job management - queries job state without side effects
    safeInternal: true,
    readOnlySafe: true,
  };

  protected executeValidated(
    _args: z.infer<typeof jobsListSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve({
      status: 'failed',
      content: [
        {
          type: 'text',
          text: 'jobs_list is executed by the lace-agent runtime (should not be executed via ToolExecutor).',
        },
      ],
    });
  }
}
