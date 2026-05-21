// ABOUTME: job_notify tool - subscribe to job lifecycle events (PRI-1692 Phase 1)
// Lets the parent agent register interest in a job's terminal-state transitions
// and return to other work; when the job finishes, lace synthesizes a
// <background-job-notification> block into the parent's next-turn inbox via
// the existing notification-injection path.

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

// Phase 1 intentionally omits maxNotifications / expiresMs from the spec's
// TypeScript block; deferred to Phase 2 along with overflow auto-stop. See
// docs/specs/2026-05-21-job-management-upgrade-design.md Acceptance #1.
const jobNotifySchema = z
  .object({
    jobId: NonEmptyString,
    on: z
      .array(z.enum(['completed', 'failed', 'cancelled', 'progress']))
      .min(1)
      .default(['completed', 'failed', 'cancelled']),
    filter: z.string().optional(),
  })
  .strict();

export class JobNotifyTool extends Tool {
  name = 'job_notify';
  description = `Subscribe to background-job lifecycle events so you can return to the user (or work on something else) instead of polling.

**Mental model — read this before using.**
A delegate **job** is one round. A delegate **session** is the whole conversation. Every \`delegate(prompt=...)\` creates a NEW job under a (new or resumed) session. \`job_notify\` wakes you when *this job* finishes. *You* decide whether the session keeps going via \`delegate(resume=jobId, prompt=...)\` — that creates the next job in the same session.

**Use this tool whenever you start a background job (\`delegate(..., background=true)\` or any \`bash(background=true)\`).** It is the cheap, async path. Don't sit in \`job_output(block=true)\` waiting; that brings the conversation to a halt and burns tokens. Subscribe, return to the user, do something else — lace will deliver a \`<background-job-notification>\` block on your next turn when the job transitions.

Parameters:
- \`jobId\` (required): the job to watch.
- \`on\`: which lifecycle kinds to wake on. Defaults to the three terminal states \`['completed','failed','cancelled']\`. Subscribe to all three unless you have a specific reason — a \`failed\`-only subscription stays SILENT through a successful completion ("silence is not success"). \`progress\` is opt-in and chatty; Phase 1 ships terminal-state delivery only.
- \`filter\` (optional): regex applied subscriber-side. **Phase 1: no-op for terminal-state subscriptions.** Reserved for Phase 2 progress / per-line subscriptions.

Subscription scope is per-jobId. \`delegate(resume=<old jobId>)\` creates a NEW jobId — re-subscribe with \`job_notify(<new jobId>)\` if you want notifications on the resumed round.

Returns: \`{ subscribed: true, subscriptionId, jobId, on, filter? }\`.`;
  schema = jobNotifySchema;
  annotations: ToolAnnotations = {
    title: 'Subscribe to job events',
    // Pure registration — no destructive side effects.
    safeInternal: true,
    readOnlySafe: true,
  };

  protected async executeValidated(
    args: z.infer<typeof jobNotifySchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager } = context;

    if (!jobManager) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'job_notify requires jobManager in context' }],
      };
    }

    const sub = jobManager.subscribe({
      jobId: args.jobId,
      on: args.on,
      ...(args.filter !== undefined ? { filter: args.filter } : {}),
    });

    const payload = {
      subscribed: true as const,
      subscriptionId: sub.subscriptionId,
      jobId: sub.jobId,
      on: sub.on,
      ...(sub.filter !== undefined ? { filter: sub.filter } : {}),
    };

    return await Promise.resolve({
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    });
  }
}
