// ABOUTME: Pure helpers used by subagent-job — config inheritance + RPC error extraction.
// Kept separate from subagent-job.ts so they can be unit-tested without spawning a child process.

import type { LaceStopDetails } from '@lace/agent/providers/base-provider';

export type ApprovalMode =
  | 'ask'
  | 'approveReads'
  | 'approveEdits'
  | 'approve'
  | 'deny'
  | 'dangerouslySkipPermissions';

export interface SubagentEffectiveConfig {
  connectionId?: string;
  modelId?: string;
  approvalMode?: ApprovalMode;
}

/**
 * Build the `config` block passed to a child subagent's `initialize` RPC.
 *
 * The child must inherit the parent's effective approvalMode — otherwise a
 * parent running with `dangerouslySkipPermissions` (e.g. an automated runner
 * that never attaches a permission handler) would spawn children that still
 * ask, and those requests would be cancelled by the upstream supervisor with
 * no handler, silently dropping the subagent's tool calls. When the parent
 * has no approvalMode set, fall back to `ask` (safe default — never grant a
 * silent permission bypass).
 */
export function buildSubagentInitConfig(effective: SubagentEffectiveConfig): {
  approvalMode: ApprovalMode;
} {
  return { approvalMode: effective.approvalMode ?? 'ask' };
}

export interface SubagentConfigSlot {
  connectionId?: string;
  modelId?: string;
}

/**
 * Independently fill any unset connectionId/modelId field on the job from the
 * parent's effective config. The two fields must be inherited independently:
 * when a persona supplies a modelId (so job.modelId is set) but the delegate
 * call provides no connectionId, the parent's connectionId must still flow
 * through — otherwise the subagent's session/prompt fails with InvalidParams.
 */
export function applyEffectiveJobConfig(
  job: SubagentConfigSlot,
  effective: SubagentEffectiveConfig
): void {
  if (job.connectionId === undefined) job.connectionId = effective.connectionId;
  if (job.modelId === undefined) job.modelId = effective.modelId;
}

/**
 * Map a subagent's session/prompt stopReason to the parent job's terminal
 * status.
 *
 * The 11 canonical RunResult.stopReason values (LaceStopReason minus the
 * non-terminal 'tool_use' and 'pause_turn' that the runner handles internally)
 * each map to one of three terminal job statuses:
 *
 *  - 'completed': the subagent finished the turn cleanly or hit a soft cap.
 *    Includes 'end_turn', 'stop_sequence', 'max_output_tokens', 'max_turns',
 *    'budget_exceeded'. The model produced what it could; downstream sees a
 *    success and can read job_output for partial results.
 *
 *  - 'cancelled': the turn was aborted via signal ('cancelled'). The parent
 *    initiated the stop and should not see a noisy failure notification.
 *
 *  - 'failed': the subagent did not complete what it claimed and the parent
 *    needs to react. Includes:
 *      'permission_cancelled' (kata #37 — tool permission was cancelled before
 *        the tool could run; the writes never landed),
 *      'context_window_exceeded' (provider rejected the prompt for being too
 *        long; the work was not performed),
 *      'refusal' (model refused to answer — content filter / safety policy),
 *      'incomplete' (kata #31 round 2 — model declared intent but did not call
 *        the tool that would do the work),
 *      'failed' (provider reported an unrecoverable error code).
 *
 * An undefined or unrecognized stopReason falls back to 'completed' — defensive
 * default that surfaces whatever the subagent did write rather than silently
 * synthesizing a failure for a value the runner did not produce.
 */
const FAILED_STOP_REASONS: ReadonlySet<string> = new Set([
  'permission_cancelled',
  'context_window_exceeded',
  'refusal',
  'incomplete',
  'failed',
]);
const CANCELLED_STOP_REASONS: ReadonlySet<string> = new Set(['cancelled']);

export function jobStatusFromStopReason(
  stopReason: string | undefined
): 'completed' | 'failed' | 'cancelled' {
  if (stopReason && FAILED_STOP_REASONS.has(stopReason)) return 'failed';
  if (stopReason && CANCELLED_STOP_REASONS.has(stopReason)) return 'cancelled';
  return 'completed';
}

/**
 * Format a subagent's structured stopDetails as a human-readable block suitable
 * for appending to the job output file. The parent agent surfaces this block
 * through `job_output(jobId="…")` and through the trailing-line hint in the
 * job-completed/job-failed notification body.
 *
 * Only stopDetails that carry diagnostic context produce a block:
 *  - 'refusal' surfaces the model's category + explanation (the *why*),
 *  - 'context_window_exceeded' surfaces the source (where in the stack the
 *    overflow was detected) and estimated excess tokens when present,
 *  - 'failed' surfaces the provider's code + message,
 *  - 'max_output_tokens' surfaces the requested max budget so the parent can
 *    decide whether to retry with a larger one,
 *  - 'stop_sequence' surfaces the matched sequence.
 *
 * Returns null when stopDetails is null or its `type` adds no information the
 * caller doesn't already have from `stopReason` alone (e.g. 'pause_turn',
 * 'cancelled' — the runner-side reason is already obvious from job.status).
 */
export function formatSubagentStopDetails(stopDetails: LaceStopDetails | null): string | null {
  if (stopDetails === null) return null;
  switch (stopDetails.type) {
    case 'refusal': {
      const parts = [
        `Source: ${stopDetails.source}`,
        ...(stopDetails.category ? [`Category: ${stopDetails.category}`] : []),
        ...(stopDetails.explanation ? [`Explanation: ${stopDetails.explanation}`] : []),
      ];
      return `\n[SUBAGENT STOP: refusal]\n${parts.join('\n')}\n`;
    }
    case 'context_window_exceeded': {
      const parts = [
        `Source: ${stopDetails.source}`,
        ...(typeof stopDetails.estimatedExcessTokens === 'number'
          ? [`Estimated excess tokens: ${stopDetails.estimatedExcessTokens}`]
          : []),
      ];
      return `\n[SUBAGENT STOP: context_window_exceeded]\n${parts.join('\n')}\n`;
    }
    case 'failed': {
      return `\n[SUBAGENT STOP: failed]\nSource: ${stopDetails.source}\nCode: ${stopDetails.code}\nMessage: ${stopDetails.message}\n`;
    }
    case 'max_output_tokens': {
      const parts = [
        `Source: ${stopDetails.source}`,
        ...(typeof stopDetails.requestedMaxTokens === 'number'
          ? [`Requested max tokens: ${stopDetails.requestedMaxTokens}`]
          : []),
      ];
      return `\n[SUBAGENT STOP: max_output_tokens]\n${parts.join('\n')}\n`;
    }
    case 'stop_sequence': {
      return `\n[SUBAGENT STOP: stop_sequence]\nSource: ${stopDetails.source}\nSequence: ${stopDetails.sequence}\n`;
    }
    case 'pause_turn':
    case 'cancelled':
      // No diagnostic value to surface — pause_turn is never terminal (runner
      // auto-resumes), and 'cancelled' is initiated by the parent so the
      // surrounding job lifecycle already explains the stop.
      return null;
  }
}

/**
 * Extract a human-readable message from an unknown error value.
 *
 * JSON-RPC error responses arrive as plain objects of the shape
 * `{ code: number, message: string, data?: unknown }` — `instanceof Error` is
 * false for these, so `String(error)` collapses them to `"[object Object]"`,
 * destroying the diagnostic information. This helper pulls `.message` when it
 * is a string and falls back to `String()` otherwise.
 */
export function rpcErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(error);
}
