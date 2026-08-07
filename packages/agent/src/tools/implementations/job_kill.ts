// ABOUTME: Job cancellation tool using JobManager
// Uses JobManager from ToolContext; destroy_container=true routes teardown through the shim (destroys container + removes /work)

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import { terminateJob, type TerminateJobOptions } from '@lace/agent/jobs/job-control';
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

**Plain kill (\`destroy_container\` omitted/false).** Terminates a \`status="running"\` job: the subagent's in-flight turn is aborted, its process killed, and the tool waits for the process to actually exit before reporting \`cancelled\`. If the process survives the grace window the tool FAILS and tells you — in that case its in-flight work may still land; verify before dispatching replacement work. **Does NOT destroy its session** — a delegate job's conversation history survives, so you can pick it back up with \`delegate(resume=<jobId>, prompt=...)\`. Use this to redirect a delegate that's gone off-track.

**Teardown (\`destroy_container: true\`).** Reclaim a per_invocation subagent when you're done with its deliverable: routes teardown through the sen-docker shim, which destroys the subagent's container AND removes its \`/work\` workspace, making the delegation **non-resumable**. Works whether the job is running (it's cancelled first) or already completed. Only the parent that created the delegation can tear it down. Call this when you've finished reading the workspace path a \`delegate\` returned — it frees a slot against the per-session retention ceiling.

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

  // Termination grace windows; overridable so tests don't sit through
  // multi-second waits.
  private readonly terminateOptions: TerminateJobOptions;

  constructor(opts: { terminateOptions?: TerminateJobOptions } = {}) {
    super();
    this.terminateOptions = opts.terminateOptions ?? {};
  }

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
      // Actually terminate the work (cancel the child's turn so in-container
      // tool calls abort, kill the process, wait for confirmed exit) rather
      // than just flipping status — a status flip lets the job run to
      // completion and land writes after "cancelled" was reported.
      const stopped = await terminateJob(job, this.terminateOptions);
      if (!stopped) {
        return fail(
          `Cancel requested for job ${jobId}, but its process did not exit within the grace window — ` +
            `in-flight work may still complete. Re-check with jobs_list/job_output before starting replacement work.`
        );
      }
      // Finalize (persist job_finished, notify subscribers, drop from the map).
      // Idempotent against the job runner's own finalize racing us.
      await jobManager.cancelJob(jobId);
    }

    if (!destroyContainer) {
      return ok(`Job ${jobId} cancelled — process terminated.`);
    }

    // Teardown: cancelJob (above) stops the PROCESS; dispose routes teardown
    // through the shim (workspaceReaper.dispose → containerManager.releasePerInvocation
    // → the plane 'release' verb), which destroys the container AND removes /work.
    // Serialized per childId against a concurrent resume; ownership is the
    // server-injected activeSessionId (the job is already scoped to this session,
    // and dispose only touches an entry this session owns).
    const childId = job.subagentSessionId;
    if (childId && workspaceReaper) {
      const entry = workspaceReaper.get(childId);
      if (entry && entry.parentId === activeSessionId) {
        await workspaceReaper.runExclusive(childId, () => workspaceReaper.dispose(childId));
        return ok(`Job ${jobId} torn down — container destroyed and workspace removed.`);
      }
      // Tracked by a DIFFERENT session: not ours to tear down.
      if (entry) {
        return ok(
          `Job ${jobId} ${wasRunning ? 'cancelled' : 'already finished'} (container owned by another session; not destroyed).`
        );
      }
      // Untracked. The reaper is per-process, so after a lace restart the entry
      // for a live container is simply gone — reporting "no container to
      // destroy" here left a finished browser holding its port with no
      // self-serve way to reclaim it. The job is already scoped to this
      // session, and the shim's release verb is idempotent (releasing a child
      // with no container is a no-op there), so route the release and let the
      // shim decide.
      await workspaceReaper.runExclusive(childId, () =>
        workspaceReaper.disposeUntracked(activeSessionId ?? '', childId)
      );
      return ok(
        `Job ${jobId} ${wasRunning ? 'cancelled' : 'already finished'}; release routed to the shim for its container (untracked in this process).`
      );
    }
    // No child session at all (host subagent / persistent box): the kill above
    // is the whole effect.
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
