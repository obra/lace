// ABOUTME: Types for ConversationRunner - the extracted agentic loop

import type { AIProvider } from '@lace/agent/providers/base-provider';
import type { SessionUpdate } from '../types';

/**
 * Configuration for creating a ConversationRunner instance.
 */
export interface RunnerConfig {
  /** Directory where session files are stored */
  sessionDir: string;
  /** Working directory for tool execution */
  cwd: string;
  /** Callback for emitting session updates to clients */
  onUpdate: (update: SessionUpdate) => void;
  /** Provider connection ID */
  connectionId?: string;
  /** Model ID to use */
  modelId?: string;
  /** Execution mode - plan (read-only) or execute (full tools) */
  executionMode?: 'plan' | 'execute';
  /** Approval mode for tool permissions */
  approvalMode?:
    | 'ask'
    | 'approveReads'
    | 'approveEdits'
    | 'approve'
    | 'deny'
    | 'dangerouslySkipPermissions';
  /** Environment variables for tool execution */
  environment?: Record<string, string>;
  /** Maximum budget in USD for this session */
  maxBudgetUsd?: number;
}

/**
 * Parameters for running a prompt through the agentic loop.
 */
export interface RunParams {
  /** Content blocks for the prompt */
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mediaType: string }>;
  /** AI provider to use for generating responses */
  provider: AIProvider;
  /** Optional output format constraint */
  outputFormat?: unknown;
  /** Maximum turns before stopping (default: 10) */
  maxTurns?: number;
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
