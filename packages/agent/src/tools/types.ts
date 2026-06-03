// ABOUTME: Tool system type definitions and interfaces
// ABOUTME: Model-agnostic tool definitions compatible with multiple AI SDKs and MCP

import type { CombinedTokenUsage } from '@lace/agent/token-management/types';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { ReminderScheduler } from '@lace/agent/reminders';
import type {
  ContainerExecutionIdentityConfig,
  MountRegistryEntry,
} from '@lace/agent/server-types';
import type { RuntimeExecutionBinding, RuntimePath, ToolRuntime } from './runtime/types';
import type { PerInvocationReaper } from '@lace/agent/jobs/per-invocation-reaper';

export interface ToolContext {
  // Execution control - required for cancellation
  signal: AbortSignal;

  // Working directory for file operations
  workingDirectory?: string;

  // Temp directory management - provided by ToolExecutor
  toolTempRoot?: string; // Root directory where ToolExecutor creates per-call temp dirs
  toolTempDir?: string; // Tool-specific temp directory for bash output

  // Identity/context metadata (provided by the agent runtime)
  threadId?: string;
  projectId?: string;

  // Environment variables for subprocess execution
  processEnv?: NodeJS.ProcessEnv;

  runtime?: ToolRuntime;
  runtimeBinding?: RuntimeExecutionBinding;
  hasRuntimeFileBeenRead?: (path: RuntimePath) => boolean;
  markFileRead?: (path: RuntimePath) => void;

  // Job management (provided by runner for job-related tools)
  jobManager?: JobManager;

  // Turn context for job creation
  turnId?: string;
  turnSeq?: number;

  activeSessionId?: string;
  activeSessionDir?: string;

  /** Authoritative persona for the active session, resolved SERVER-SIDE. Never from
   *  tool arguments — the keystone invariant. */
  persona?: string;
  /** Per-call timeout for out-of-process tools (one-shot-exec). */
  timeoutMs?: number;

  // Reminder scheduling (provided by the session runner for manage_reminders).
  reminderScheduler?: ReminderScheduler;

  // Read-only view of the embedder-supplied named-mount registry. Set by the
  // session runner when available. Used by tools that need to translate
  // persona-declared mount names into host paths (delegate → projected
  // container runtime).
  containerMounts?: Readonly<Record<string, MountRegistryEntry>>;
  containerExecutionIdentity?: ContainerExecutionIdentityConfig;

  // Idle TTL reaper for per_invocation containers.
  // When a delegate invocation starts (fresh or resume), the tool calls
  // cancelReap so the container survives for the new invocation window.
  // The subagent-job exit handler schedules a new reap after each child exits.
  perInvocationReaper?: PerInvocationReaper;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  safeInternal?: boolean;
  readOnlySafe?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>; // MCP uses "arguments"
}

// Note: Tool class is now defined in ./tool.ts
// This ensures all tools use schema-based validation

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required: string[];
  [k: string]: unknown;
}

interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolProperty;
}

export interface ContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  uri?: string;
}

export type ToolResultStatus = 'completed' | 'failed' | 'aborted' | 'denied' | 'pending';

export interface ToolResult {
  id?: string; // Optional - set by tools if they have it
  content: ContentBlock[];
  status: ToolResultStatus;
  metadata?: Record<string, unknown>; // For delegation threadId, etc.
  tokenUsage?: CombinedTokenUsage;
}

// Helper to check if a result indicates an error
function _isToolError(result: ToolResult): boolean {
  return result.status !== 'completed';
}

export function createToolResult(
  status: ToolResultStatus,
  content: ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return {
    content,
    status,
    ...(id && { id }),
    ...(metadata && { metadata }),
  };
}

export function createSuccessResult(
  content: ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return createToolResult('completed', content, id, metadata);
}

export function createErrorResult(
  input: string | ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  if (typeof input === 'string') {
    return createToolResult('failed', [{ type: 'text', text: input }], id, metadata);
  }
  return createToolResult('failed', input, id, metadata);
}

// Tool approval types (consolidated from approval-types.ts)
export enum ApprovalDecision {
  ALLOW_ONCE = 'allow_once',
  ALLOW_SESSION = 'allow_session',
  ALLOW_PROJECT = 'allow_project',
  ALLOW_ALWAYS = 'allow_always',
  DENY = 'deny',
  DISABLE = 'disable',
}

export interface ApprovalCallback {
  requestApproval(toolCall: ToolCall): Promise<ApprovalDecision>;
}

export class ApprovalPendingError extends Error {
  constructor(public readonly toolCallId: string) {
    super(`Tool approval pending for ${toolCallId}`);
    this.name = 'ApprovalPendingError';
  }
}

export type ToolPolicy = 'allow' | 'ask' | 'deny' | 'disable';

export type PermissionOverrideMode = 'normal' | 'yolo' | 'read-only';
