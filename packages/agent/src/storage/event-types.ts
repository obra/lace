// ABOUTME: Type-safe discriminated union for durable event data
// All event types are defined here with their specific data shapes

import type { ToolResult } from '@lace/ent-protocol';
import type { RuntimeExecutionBinding } from '../tools/runtime/types';
import type {
  LaceStopReason,
  LaceStopDetails,
  BetaCacheMissReason,
} from '@lace/agent/providers/base-provider';

// Content block types used in prompts and messages
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

// Individual event data types
export type PromptEventData = {
  type: 'prompt';
  content: ContentBlock[];
};

export type MessageEventData = {
  type: 'message';
  content: ContentBlock[] | string;
};

export type ToolUseEventData = {
  type: 'tool_use';
  toolCallId: string;
  name: string;
  kind?: string;
  input: Record<string, unknown>;
  result?: ToolResult;
};

export type TurnStartEventData = {
  type: 'turn_start';
};

export type TurnEndEventData = {
  type: 'turn_end';
  stopReason: LaceStopReason;
  /**
   * Structured detail accompanying the stop reason (refusal category, max
   * output tokens source, etc.). Optional for back-compat: legacy durable
   * events written before chunk G have no `stopDetails` field and deserialize
   * to `undefined`. Consumers should treat `undefined` and `null` identically
   * (no detail available). New events always populate the field — `null` when
   * the stop reason carries no extra context.
   */
  stopDetails?: LaceStopDetails | null;
  /**
   * Anthropic cache-diagnosis-2026-04-07 beta only. The cache_miss_reason from
   * the LAST provider response of this turn (multi-call tool-use loops reuse
   * the same prefix within a turn, so inner calls' miss reasons aren't a
   * meaningful "vs previous request" comparison). `null` means a cache hit (or
   * diagnostics not opted in). `undefined` on legacy events written before
   * chunk K. Consumers treat `undefined` and `null` identically.
   */
  cacheMissReason?: BetaCacheMissReason | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
};

/**
 * Stop reason written to a synthesized `turn_end` event by
 * `repairOrphanTurnStarts` when the prior process died (SIGKILL, OOM,
 * container restart) between `turn_start` and the matching `turn_end`.
 * Surfaces crash-driven turn aborts in the durable log so downstream
 * consumers (cost accounting, compaction, UI) can distinguish them from
 * clean terminations. See PRI-1818.
 */
export const PROCESS_DIED_STOP_REASON = 'process_died';

export type ContextCompactedEventData = {
  type: 'context_compacted';
  strategy: string;
  preserved: unknown[];
  summary?: string;
};

export type ContextInjectedEventData = {
  type: 'context_injected';
  content: ContentBlock[];
  priority?: string;
};

export type SystemPromptSetEventData = {
  type: 'system_prompt_set';
  text: string;
};

export type JobStartedEventData = {
  type: 'job_started';
  jobId: string;
  jobType: 'shell' | 'delegate';
  command?: string;
  description?: string;
  prompt?: string;
  runtimeBinding?: RuntimeExecutionBinding;
};

export type JobFinishedEventData = {
  type: 'job_finished';
  jobId: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  exitCode?: number;
  error?: string;
};

export type JobUpdateEventData = {
  type: 'job_update';
  jobId: string;
  update: Record<string, unknown>;
};

export type JobSessionAssignedEventData = {
  type: 'job_session_assigned';
  jobId: string;
  subagentSessionId: string;
};

export type PermissionRequestedEventData = {
  type: 'permission_requested';
  toolCallId: string;
  turnSeq: number;
  jobId?: string;
  tool: string;
  kind?: string;
  resource: string;
  options: Array<{ optionId: string; label: string }>;
  requestedAt: string;
  input: Record<string, unknown>;
};

export type PermissionDecidedEventData = {
  type: 'permission_decided';
  toolCallId: string;
  turnSeq: number;
  decision?: string;
  updatedInput?: Record<string, unknown>;
};

export type PermissionCancelledEventData = {
  type: 'permission_cancelled';
  toolCallId: string;
  turnSeq: number;
  reason: string;
};

export type CheckpointCreatedEventData = {
  type: 'checkpoint_created';
  checkpointId: string;
  label?: string;
};

export type FilesRewoundEventData = {
  type: 'files_rewound';
  checkpointId: string;
  filesRestored: string[];
};

// The discriminated union of all event data types
export type DurableEventData =
  | PromptEventData
  | MessageEventData
  | ToolUseEventData
  | TurnStartEventData
  | TurnEndEventData
  | ContextCompactedEventData
  | ContextInjectedEventData
  | SystemPromptSetEventData
  | JobStartedEventData
  | JobFinishedEventData
  | JobUpdateEventData
  | JobSessionAssignedEventData
  | PermissionRequestedEventData
  | PermissionDecidedEventData
  | PermissionCancelledEventData
  | CheckpointCreatedEventData
  | FilesRewoundEventData;

// A typed durable event with proper type narrowing
export type TypedDurableEvent = {
  eventSeq: number;
  timestamp: string;
  turnId?: string;
  turnSeq?: number;
  type: DurableEventData['type'];
  data: DurableEventData;
};

// Type guard to check if event data matches a specific type
export function isEventDataOfType<T extends DurableEventData['type']>(
  data: DurableEventData,
  type: T
): data is Extract<DurableEventData, { type: T }> {
  return data.type === type;
}
