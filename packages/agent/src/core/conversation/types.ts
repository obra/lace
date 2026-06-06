// ABOUTME: Types for ConversationRunner - the extracted agentic loop

import type { AIProvider, LaceStopDetails } from '@lace/agent/providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolResult as CoreToolResult, ToolCall, ToolContext } from '@lace/agent/tools/types';
import type {
  ContainerExecutionIdentityConfig,
  MountRegistryEntry,
  SessionUpdate,
} from '@lace/agent/server-types';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { MCPServerManager } from '@lace/agent/mcp/server-manager';
import type { SkillRegistry } from '@lace/agent/skills';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type { ReminderScheduler } from '@lace/agent/reminders';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
import type { ProjectedContainerManager } from '@lace/agent/tools/runtime/projected-container';
import type { RuntimeSecretResolver } from '@lace/agent/tools/runtime/secrets';
import type { PerInvocationReaper } from '@lace/agent/jobs/per-invocation-reaper';
import type { WorkspaceReaper } from '@lace/agent/jobs/workspace-reaper';

/**
 * Approval mode for tool permissions.
 */
export type ApprovalMode =
  | 'ask'
  | 'approveReads'
  | 'approveEdits'
  | 'approve'
  | 'deny'
  | 'dangerouslySkipPermissions';

/**
 * Configuration for creating a ConversationRunner instance.
 */
export interface RunnerConfig {
  /** Directory where session files are stored */
  sessionDir: string;
  /** Session ID */
  sessionId: string;
  /** Working directory for tool execution */
  cwd: string;
  /** Execution mode - plan (read-only) or execute (full tools) */
  executionMode: 'plan' | 'execute';
  /** Approval mode for tool permissions */
  approvalMode: ApprovalMode;
  /** Provider connection ID */
  connectionId?: string;
  /** Model ID to use */
  modelId?: string;
  /** Environment variables for tool execution */
  environment?: Record<string, string>;
  /** Runtime binding for tool execution */
  runtimeBinding?: RuntimeExecutionBinding;
  /** Maximum budget in USD for this session */
  maxBudgetUsd?: number;
  /** Persona name for this session; stamped into every ToolContext. */
  persona?: string;
}

/**
 * Dependencies injected into the ConversationRunner.
 * These are callbacks that the runner uses to interact with the outside world.
 */
export interface RunnerDependencies {
  /** Callback for emitting session updates to clients */
  onUpdate: (turnSeq: number, update: SessionUpdate) => Promise<void>;

  /** Function to run code exclusively (mutex) to prevent race conditions */
  runExclusive: <T>(fn: () => T | Promise<T>) => Promise<T>;

  /** Request permission from the client for tool use */
  requestPermission: (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    toolCallId: string;
    tool: string;
    kind: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
    input: Record<string, unknown>;
    signal: AbortSignal;
  }) => Promise<{ decision?: string; updatedInput?: Record<string, unknown> } | undefined>;

  /** Create a tool executor for the given execution mode */
  createToolExecutor: (
    executionMode: 'plan' | 'execute',
    mcpServerManager?: MCPServerManager,
    jobManager?: JobManager,
    skillRegistry?: SkillRegistry,
    personaRegistry?: PersonaRegistry
  ) => Promise<{
    executor: {
      getTool: (name: string) => CoreTool | undefined;
      execute: (toolCall: ToolCall, context: ToolContext) => Promise<CoreToolResult>;
    };
    toolsForProvider: CoreTool[];
  }>;

  /** Create an AI provider for this turn */
  createProvider: () => Promise<AIProvider>;

  /**
   * Get model pricing for cost calculation. The runner expects cache pricing
   * for both creation and read tiers; providers without cache
   * pricing must return the base input rate for both so the cost formula
   * stays correct on uncached workloads.
   */
  getModelPricing: () => Promise<{
    costPer1mIn: number;
    costPer1mOut: number;
    costPer1mCacheCreation: number;
    costPer1mCacheRead: number;
  } | null>;

  /** Start a background shell job (used for bash with background=true) */
  startShellJob: (options: {
    command: string;
    description?: string;
    turnContext: { turnId: string; turnSeq: number };
    runtimeBinding?: RuntimeExecutionBinding;
  }) => Promise<{ jobId: string }>;

  /** MCP server manager (optional) */
  mcpServerManager?: MCPServerManager;

  /** Job manager for job-related tools */
  jobManager: JobManager;

  /** Projected container manager for container-backed tool runtimes */
  containerManager?: ProjectedContainerManager | null;

  /** Resolver for runtime-scoped secret references */
  runtimeSecretResolver?: RuntimeSecretResolver;

  /** Skill registry for skill-related tools (optional) */
  skillRegistry?: SkillRegistry;

  /**
   * PersonaRegistry to thread into DelegateTool so embedder-supplied
   * `userPersonasPaths` are visible from `delegate({persona})` calls.
   * Optional: when omitted, DelegateTool falls back to the module-load
   * default registry (which scans LACE_DIR/agent-personas).
   */
  personaRegistry?: PersonaRegistry;

  /** Update the active turn status */
  setActiveTurnStatus: (
    status: 'running' | 'awaiting_permission' | null,
    abortController?: AbortController
  ) => void;

  /** Get session cost in USD */
  getSessionCostUsd: () => number;

  /**
   * Update session cost and token usage.
   *
   * `cacheCreationInputTokens` and `cacheReadInputTokens` are
   * optional so callers/tests that don't track cache accounting can omit
   * them; the session-state accumulator treats absent fields as zero.
   */
  updateSessionUsage: (params: {
    costDelta: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  }) => void;

  /** Optional reminder scheduler for the current session's reminder tools */
  reminderScheduler?: ReminderScheduler;

  /** Current session's id (used by reminder tools that need session-scoped context) */
  activeSessionId?: string;

  /**
   * Embedder-supplied named-mount registry. Threaded into ToolContext so the
   * delegate tool can translate persona-declared mount names into host paths
   * when projecting a host-placed persona container.
   */
  containerMounts?: Readonly<Record<string, MountRegistryEntry>>;
  containerExecutionIdentity?: ContainerExecutionIdentityConfig;

  /**
   * Idle TTL reaper for per_invocation containers (Chunk E).
   * Threaded into ToolContext so the delegate tool can cancel a pending
   * destruction timer when a resume invocation arrives.
   */
  perInvocationReaper?: PerInvocationReaper;

  /**
   * Per-process map of per_invocation child workspaces. Threaded into
   * ToolContext so delegate can track a child's workspace and job_kill
   * can dispose it (container destroyed before /work removal).
   */
  workspaceReaper?: WorkspaceReaper;
}

/**
 * Parameters for running a prompt through the agentic loop.
 */
export interface RunParams {
  /** Content blocks for the prompt */
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mediaType: string }
  >;
  /** Optional output format constraint */
  outputFormat?: unknown;
  /** Maximum turns before stopping (default: 10000, see ConversationRunner.DEFAULT_MAX_TURNS) */
  maxTurns?: number;
  /** Pre-created abort controller */
  abortController: AbortController;
  /** Turn ID for this turn */
  turnId: string;
  /** Timestamp when the turn started */
  startedAt: string;
}

/**
 * Result from running a prompt through the agentic loop.
 *
 * `stopReason` is the canonical reason the turn ended. Provider-derived terminal
 * reasons (`'refusal'`, `'context_window_exceeded'`, `'max_output_tokens'`,
 * `'stop_sequence'`) are surfaced verbatim; runner-derived stops
 * (`'max_turns'`, `'cancelled'`, `'budget_exceeded'`, `'incomplete'`,
 * `'permission_cancelled'`, `'end_turn'`) are unchanged. `'failed'` is reserved
 * for callers that catch a runner throw and want to attribute it (the runner
 * itself throws an EntErrorCodes.ProviderError instead of returning when the
 * provider reports `stopReason === 'failed'`). Non-terminal provider stops
 * (`'tool_use'`, `'pause_turn'`) are intentionally excluded — the runner
 * handles them internally.
 *
 * The error-shaped values (`provider_error_*`, `tool_error_*`, `internal_error`)
 * are written by the runner's finally block when the agentic loop threw, so
 * every `turn_start` has a matching `turn_end` even on failure. They surface
 * in the durable `turn_end` event for downstream consumers (cost accounting,
 * compaction, supervision UI). The runner rethrows after writing turn_end, so
 * the returned `RunResult` never carries these values on a real run — they are
 * included in the union for type compatibility with the internal stopReason
 * variable that gets persisted to the durable log.
 *
 * `process_died` is intentionally NOT included — that label is written by the
 * crash-recovery scan at session-open time when an orphan `turn_start` is
 * found. `prompt_handler_caught` is the prompt.ts defense-in-
 * depth fallback label and is similarly not in this union.
 */
export interface RunResult {
  /** Unique identifier for this turn */
  turnId: string;
  /** Reason the turn stopped */
  stopReason:
    | 'end_turn'
    | 'stop_sequence'
    | 'max_output_tokens'
    | 'context_window_exceeded'
    | 'refusal'
    | 'max_turns'
    | 'cancelled'
    | 'budget_exceeded'
    | 'incomplete'
    | 'permission_cancelled'
    | 'failed'
    | 'provider_error_overloaded'
    | 'provider_error_invalid'
    | 'provider_error_network'
    | 'provider_error_other'
    | 'tool_error_throw'
    | 'tool_error_timeout'
    | 'internal_error';
  /**
   * Structured stop detail when the provider supplied one (refusal category,
   * stop sequence, max-output-tokens source, etc.). `null` for runner-derived
   * stops or providers that didn't supply a detail.
   */
  stopDetails: LaceStopDetails | null;
  /** Final assistant content */
  content: Array<{ type: 'text'; text: string }>;
  /**
   * Token usage for this turn. Cache fields are optional for back-compat
   * with non-Anthropic providers that don't report cache accounting.
   */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    /**
     * The LAST API call's on-the-wire input context size for this turn (not
     * summed across calls). See TurnEndEventData.usage.lastCallInputContextTokens
     * for the full rationale. Mirrored here because runner.run() returns the
     * same shape as its emitted turn_end event.
     */
    lastCallInputContextTokens?: number;
    costUsd?: number;
  };
  /**
   * The model's answer parsed as a structured object, present only when the
   * prompt requested an `outputFormat`. Carried up from
   * `ProviderResponse.structuredOutput`. `undefined` when no outputFormat was
   * requested or the response text could not be parsed.
   */
  structuredOutput?: unknown;
}
