// ABOUTME: Types for ConversationRunner - the extracted agentic loop

import type { AIProvider } from '@lace/agent/providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolResult as CoreToolResult, ToolCall, ToolContext } from '@lace/agent/tools/types';
import type { MountRegistryEntry, SessionUpdate } from '@lace/agent/server-types';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { MCPServerManager } from '@lace/agent/mcp/server-manager';
import type { SkillRegistry } from '@lace/agent/skills';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type { ReminderScheduler } from '@lace/agent/reminders';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
import type { ProjectedContainerManager } from '@lace/agent/tools/runtime/projected-container';
import type { RuntimeSecretResolver } from '@lace/agent/tools/runtime/secrets';

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

  /** Get model pricing for cost calculation */
  getModelPricing: () => Promise<{ costPer1mIn: number; costPer1mOut: number } | null>;

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

  /** Update session cost and token usage */
  updateSessionUsage: (params: {
    costDelta: number;
    inputTokens: number;
    outputTokens: number;
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
 */
export interface RunResult {
  /** Unique identifier for this turn */
  turnId: string;
  /** Reason the turn stopped */
  stopReason:
    | 'end_turn'
    | 'max_tokens'
    | 'max_turns'
    | 'cancelled'
    | 'budget_exceeded'
    | 'incomplete'
    | 'permission_cancelled';
  /** Final assistant content */
  content: Array<{ type: 'text'; text: string }>;
  /** Token usage for this turn */
  usage: { inputTokens: number; outputTokens: number };
}
