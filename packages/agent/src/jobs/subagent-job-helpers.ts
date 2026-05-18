// ABOUTME: Pure helpers used by subagent-job — config inheritance + RPC error extraction.
// Kept separate from subagent-job.ts so they can be unit-tested without spawning a child process.

export interface SubagentEffectiveConfig {
  connectionId?: string;
  modelId?: string;
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
