// ABOUTME: Job listing tool using JobManager
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const jobsListSchema = z.object({
  status: z
    .array(z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted']))
    .optional(),
  type: z.array(z.enum(['bash', 'delegate'])).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export class JobsListTool extends Tool {
  name = 'jobs_list';
  description = `List background **jobs** in the current parent session. Useful for finding jobIds to feed to \`job_output\`, \`job_kill\`, \`job_notify\`, or \`delegate(resume=...)\`.

**Remember:** each \`delegate(prompt=...)\` is one job — one round. A delegate **session** (the subagent's conversation history) can be associated with multiple jobs over time: every \`delegate(resume=<prior jobId>)\` creates a new job under the same session. This list shows jobs, not sessions; the \`subagentSessionId\` field (when present) reveals which session a delegate job belongs to.

Filter by status: \`["pending","running","completed","failed","cancelled","interrupted"]\`.
\`interrupted\` = the job was running when this agent process last stopped; its true outcome is unknown (a delegate's container may even still be working). Treat it as "unverified", not as failed.
Filter by type: \`["bash","delegate"]\`.

Returns: \`[{ jobId, type, status, description, startTime }]\`, **most recent first**. When more jobs match than \`limit\` allows, the result says how many were withheld.`;
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

    // Newest first, then limit. listJobs() derives records in event order, so
    // an un-reversed slice returns the OLDEST jobs — in a long-lived session
    // that puts recent work past the limit, where a killed job is
    // indistinguishable from one that never ran.
    const matched = jobs.length;
    jobs = jobs.slice().reverse().slice(0, limit);

    // Format output
    const formatted = jobs.map((j) => ({
      jobId: j.jobId,
      type: j.type,
      status: j.status,
      description: j.description,
      startTime: j.startTime,
    }));

    // Name the truncation. Silence here reads as "this is all of them".
    const note =
      matched > formatted.length
        ? `\n\n${formatted.length} most recent of ${matched} matching jobs. Raise \`limit\` or narrow with \`status\`/\`type\` to see more.`
        : '';

    return Promise.resolve({
      status: 'completed',
      content: [{ type: 'text', text: `${JSON.stringify(formatted, null, 2)}${note}` }],
    });
  }
}
