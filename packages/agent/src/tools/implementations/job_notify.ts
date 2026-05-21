// ABOUTME: job_notify tool - subscribe to job lifecycle events (PRI-1692 Phases 1-2)
// Lets the parent agent register interest in a job's lifecycle transitions
// (terminal states + optional progress with a filter regex) and return to
// other work; when the job transitions, lace synthesizes a
// <notification kind="job-..."> block into the parent's events.jsonl via
// the unified injectNotification path.

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

// Phase 1+2 intentionally omits maxNotifications / expiresMs from the spec's
// TypeScript block; deferred to Phase 3 along with overflow auto-stop. See
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
A delegate **job** is one round. A delegate **session** is the whole conversation. Every \`delegate(prompt=...)\` creates a NEW job under a (new or resumed) session. \`job_notify\` wakes you when *this job* transitions. *You* decide whether the session keeps going via \`delegate(resume=jobId, prompt=...)\` — that creates the next job in the same session.

**Use this tool whenever you start a background job (\`delegate(..., background=true)\` or any \`bash(background=true)\`).** It is the cheap, async path. Don't sit in \`job_output(block=true)\` waiting; that brings the conversation to a halt and burns tokens. Subscribe, return to the user, do something else — lace will deliver a \`<notification kind="job-completed"|"job-failed"|"job-cancelled"|"job-progress" job-id="...">\` block on your next turn when the job transitions.

**Silence is not success.** Always subscribe to the terminal states (\`completed\`, \`failed\`, \`cancelled\`) — they're cheap and fire exactly once. A \`progress\`-only or \`failed\`-only subscription will stay silent through a crash or a successful completion, and you will not learn the job ended.

Parameters:
- \`jobId\` (required): the job to watch.
- \`on\`: which lifecycle kinds to wake on. Defaults to the three terminal states \`['completed','failed','cancelled']\`. Subscribe to all three unless you have a specific reason. \`progress\` is opt-in and chatty — pair it with a \`filter\` and keep the terminal-state subscription armed alongside it. Subscribing with \`progress\` arms the job's progress timer on demand (default cadence ~5min); when you and any other progress subscribers unsubscribe, the timer stops and the job stops emitting. Operator-configured cadences (jobs created with an explicit \`progressIntervalMs\`) run independently and outlive subscriber churn.
- \`filter\` (optional): regex applied subscriber-side.
   - For \`progress\`: functional. The regex is evaluated (multi-line) against the latest tail-preview text; non-matching ticks are dropped for this subscriber. Typical pattern: \`filter='^ERROR:|^FATAL:'\` to wake only on interesting output.
   - For terminal states (\`completed\`/\`failed\`/\`cancelled\`): no-op. Terminal notifications always fire — they're never filterable, by design.
   - Invalid regex (e.g. \`'[invalid'\`) is rejected at subscribe time with a clear error.

**Batching window.** Multiple \`progress\` notifications that fire within 200ms for the same subscription are coalesced into a single delivery carrying the most recent tail preview. Terminal-state notifications flush any pending batch immediately and never wait.

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

    // jobManager.subscribe throws on invalid filter regex; surface that to
    // the agent as a structured failure rather than letting it bubble.
    let sub;
    try {
      sub = jobManager.subscribe({
        jobId: args.jobId,
        on: args.on,
        ...(args.filter !== undefined ? { filter: args.filter } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'failed',
        content: [{ type: 'text', text: message }],
      };
    }

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
