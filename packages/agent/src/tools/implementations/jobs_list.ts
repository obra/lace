// ABOUTME: Job listing tool using JobManager
// Uses JobManager from ToolContext for all job operations

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
  description = `List background **jobs** in the current parent session. Useful for finding jobIds to feed to \`job_output\`, \`job_kill\`, \`job_notify\`, or \`delegate(resume=...)\`.

**Remember:** each \`delegate(prompt=...)\` is one job — one round. A delegate **session** (the subagent's conversation history) can be associated with multiple jobs over time: every \`delegate(resume=<prior jobId>)\` creates a new job under the same session. This list shows jobs, not sessions; the \`subagentSessionId\` field (when present) reveals which session a delegate job belongs to.

Filter by status: \`["pending","running","completed","failed","cancelled"]\`.
Filter by type: \`["bash","delegate"]\`.

Returns: \`[{ jobId, type, status, description, startTime }]\`.`;
  schema = jobsListSchema;
  annotations: ToolAnnotations = {
    title: 'List Jobs',
    // Internal job management - queries job state without side effects
    safeInternal: true,
    readOnlySafe: true,
  };

  protected executeValidated(
    args: z.infer<typeof jobsListSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager } = context;

    if (!jobManager) {
      return Promise.resolve({
        status: 'failed',
        content: [{ type: 'text', text: 'jobs_list requires jobManager in context' }],
      });
    }

    const { status: statusFilter, type: typeFilter, limit } = args;

    let jobs = jobManager.listJobs();

    // Apply status filter
    if (statusFilter && statusFilter.length > 0) {
      jobs = jobs.filter((j) => statusFilter.includes(j.status));
    }

    // Apply type filter
    if (typeFilter && typeFilter.length > 0) {
      jobs = jobs.filter((j) => typeFilter.includes(j.type));
    }

    // Apply limit
    jobs = jobs.slice(0, limit);

    // Format output
    const formatted = jobs.map((j) => ({
      jobId: j.jobId,
      type: j.type,
      status: j.status,
      description: j.description,
      startTime: j.startTime,
    }));

    return Promise.resolve({
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
    });
  }
}
