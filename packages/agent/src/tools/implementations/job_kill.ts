// ABOUTME: Job cancellation tool using JobManager
// Uses JobManager from ToolContext; destroy_container=true tears down a per_invocation container + workspace

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const jobKillSchema = z
  .object({
    jobId: NonEmptyString,
    destroy_container: z.boolean().default(false),
  })
  .strict();

export class JobKillTool extends Tool {
  name = 'job_kill';
  description = `Cancel a running background **job**, and optionally tear down a finished delegation's container + workspace.

**Plain kill (\`destroy_container\` omitted/false).** Cancels a \`status="running"\` job. **Does NOT destroy its session** — a delegate job's conversation history survives, so you can pick it back up with \`delegate(resume=<jobId>, prompt=...)\`. Use this to redirect a delegate that's gone off-track. After killing, the job transitions to \`cancelled\` (you'll get a \`job_notify\` 'cancelled' notification if subscribed).

**Teardown (\`destroy_container: true\`).** Reclaim a per_invocation subagent when you're done with its deliverable: destroys the subagent's container AND removes its \`/work\` workspace, making the delegation **non-resumable**. Works whether the job is running (it's cancelled first) or already completed. Only the parent that created the delegation can tear it down. Call this when you've finished reading the workspace path a \`delegate\` returned — it frees a slot against the per-session retention ceiling.

Parameters:
- \`jobId\` (required): the job to kill / tear down.
- \`destroy_container\` (default false): also destroy the container and remove the workspace (non-resumable).`;
  schema = jobKillSchema;
  annotations: ToolAnnotations = {
    title: 'Kill Job',
    // Internal job management - cancels jobs / reclaims scratch without external
    // side effects. The job itself may have been doing dangerous things, but
    // killing/releasing it just stops work and frees space rather than causing harm.
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof jobKillSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager, workspaceReaper, activeSessionId } = context;

    if (!jobManager) {
      return fail('job_kill requires jobManager in context');
    }

    const { jobId, destroy_container: destroyContainer } = args;

    const job = jobManager.getJob(jobId);
    if (!job) {
      return fail(`Job ${jobId} not found`);
    }

    // A plain kill only acts on a running job.
    if (!destroyContainer && job.status !== 'running') {
      return fail(`Job ${jobId} is not running (status: ${job.status})`);
    }

    const wasRunning = job.status === 'running';
    if (wasRunning) {
      await jobManager.cancelJob(jobId);
    }

    if (!destroyContainer) {
      return ok(`Job ${jobId} cancelled`);
    }

    // Teardown: cancelJob (above) stops the PROCESS; dispose destroys the
    // CONTAINER (the live writer) before removing /work. Serialized per childId
    // against a concurrent resume; ownership is the server-injected
    // activeSessionId (the job is already scoped to this session, and dispose
    // only touches an entry this session owns).
    const childId = job.subagentSessionId;
    if (childId && workspaceReaper) {
      const entry = workspaceReaper.get(childId);
      if (entry && entry.parentId === activeSessionId) {
        await workspaceReaper.runExclusive(childId, () => workspaceReaper.dispose(childId));
        return ok(`Job ${jobId} torn down — container destroyed and workspace removed.`);
      }
    }
    // Nothing tracked to tear down (host subagent, persistent box, or already
    // gone): the kill above is the whole effect.
    return ok(
      `Job ${jobId} ${wasRunning ? 'cancelled' : 'already finished'} (no container to destroy).`
    );
  }
}

function fail(text: string): ToolResult {
  return { status: 'failed', content: [{ type: 'text', text }] };
}
function ok(text: string): ToolResult {
  return { status: 'completed', content: [{ type: 'text', text }] };
}
