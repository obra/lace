// ABOUTME: Types for ConversationRunner - the extracted agentic loop

import type { AIProvider } from '@lace/agent/providers/base-provider';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { ToolResult as CoreToolResult } from '@lace/agent/tools/types';
import type { SessionUpdate, JobState } from '@lace/agent/server-types';

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
    mcpServerManager?: unknown
  ) => {
    executor: {
      getTool: (name: string) => unknown;
      execute: (...args: unknown[]) => Promise<CoreToolResult>;
    };
    toolsForProvider: CoreTool[];
  };

  /** Create an AI provider for this turn */
  createProvider: () => Promise<AIProvider>;

  /** Get model pricing for cost calculation */
  getModelPricing: () => Promise<{ costPer1mIn: number; costPer1mOut: number } | null>;

  /** Start a background shell job */
  startShellJob: (options: {
    command: string;
    description?: string;
    turnContext: { turnId: string; turnSeq: number };
  }) => Promise<{ jobId: string }>;

  /** Start a subagent job */
  startSubagentJob: (options: {
    prompt: string;
    description?: string;
    turnContext: { turnId: string; turnSeq: number };
    resumeSessionId?: string;
    connectionId?: string;
    modelId?: string;
  }) => Promise<{ jobId: string }>;

  /** Derive jobs for the active session */
  deriveJobs: () => Array<{
    jobId: string;
    parentJobId?: string;
    type: string;
    status: string;
    description?: string;
    command?: string;
    startTime?: string;
    subagentSessionId?: string;
    exitCode?: number;
  }>;

  /** Finalize a job (mark as completed/failed) */
  finalizeJob: (job: JobState) => Promise<void>;

  /** Get a running job by ID */
  getJob: (jobId: string) => JobState | undefined;

  /** MCP server manager (optional) */
  mcpServerManager?: unknown;

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
}

/**
 * Parameters for running a prompt through the agentic loop.
 */
export interface RunParams {
  /** Content blocks for the prompt */
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mediaType: string }>;
  /** Optional output format constraint */
  outputFormat?: unknown;
  /** Maximum turns before stopping (default: 10) */
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
  stopReason: 'end_turn' | 'max_tokens' | 'max_turns' | 'cancelled' | 'budget_exceeded';
  /** Final assistant content */
  content: Array<{ type: 'text'; text: string }>;
  /** Token usage for this turn */
  usage: { inputTokens: number; outputTokens: number };
}
