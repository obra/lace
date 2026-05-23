// ABOUTME: Shared types and constants for the agent server, extracted from server.ts
// This module contains type definitions and configuration constants used across
// the server implementation, including session updates, job state, and server configuration.

import type { ChildProcess } from 'node:child_process';
import type { z } from 'zod';
import { SessionUpdateNotificationSchema } from '@lace/ent-protocol';
import type { JsonRpcId, JsonRpcPeer } from '@lace/ent-protocol';
import type { LoadedSession } from './storage/session-store';
import type { PendingPermissionRecord } from './storage/permissions-from-events';
import { ProviderCatalogManager } from './providers/catalog/manager';
import { ProviderInstanceManager } from './providers/instance/manager';
import { MCPServerManager } from './mcp/server-manager';
import type { JobManager } from './jobs/job-manager';
import type { ToolExecutor } from './tools/executor';
import type { Tool } from './tools/tool';
import type { SkillRegistry } from './skills';
import type { PersonaRegistry } from './config/persona-registry';
import type { ContainerManager } from './containers/container-manager';
import type { ExecStreamHandle } from './containers/types';
import type { PersonaContainerRuntime } from './jobs/persona-container-spec';
import type { ReminderScheduler } from './reminders';
import type { RuntimeExecutionBinding } from './tools/runtime/types';
import type { RuntimeSecretResolver } from './tools/runtime/secrets';
import type { PerInvocationReaper } from './jobs/per-invocation-reaper';

/**
 * Per-build allowlist of tool names. `undefined` means "no scope filter" (all tools available).
 * An empty array means "allow nothing".
 */
export type AgentToolScope = readonly string[] | undefined;

/**
 * Factory function type for creating tool executors.
 * Used by RPC handlers to create executors with the appropriate mode and dependencies.
 */
export type CreateToolExecutorFn = (
  mode: 'plan' | 'execute',
  mcpServerManager?: MCPServerManager,
  jobManager?: JobManager,
  skillRegistry?: SkillRegistry,
  toolScope?: AgentToolScope,
  personaRegistry?: PersonaRegistry
) => Promise<{
  executor: ToolExecutor;
  toolsForProvider: Tool[];
}>;

// Configuration Constants
export const SUPPORTED_PROVIDER_TYPES = new Set([
  'anthropic',
  'openai',
  'gemini',
  'lmstudio',
  'ollama',
]);
export const JOB_LOG_DIR = 'jobs';
export const MAX_CONCURRENT_JOBS = 10;
export const MAX_JOB_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_PROGRESS_INTERVAL_MS = 300000; // 5 minutes

// Type Utilities
type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;

// Session Update Types
export type SessionUpdateParams = z.infer<typeof SessionUpdateNotificationSchema>['params'];
export type SessionUpdate = DistributiveOmit<SessionUpdateParams, 'sessionId' | 'streamSeq'>;
export type JobInnerUpdate = Extract<SessionUpdateParams, { type: 'job_update' }>['update'];

// Job Types
export type JobType = 'bash' | 'delegate';
export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type JobNotificationType = 'completed' | 'failed' | 'cancelled' | 'progress';

export type JobState = {
  jobId: string;
  parentJobId?: string;
  type: JobType;
  status: JobStatus;
  description?: string;
  command?: string;
  subagentContent?: unknown[];
  startedAt: string;
  originTurnId?: string;
  originTurnSeq?: number;
  exitCode?: number;
  outputPath: string;
  proc?: ChildProcess;
  // When the subagent runs inside a persona container, the long-lived stream
  // for the in-container lace-agent process is stored here instead of `proc`.
  // job-control consults both fields to terminate the right thing.
  containerExec?: ExecStreamHandle;
  permissionAbortController?: AbortController;
  childPeer?: JsonRpcPeer;
  subagentSessionId?: string;
  // True when the host pre-allocated subagentSessionId before session/new (PRI-1796).
  // Distinguishes from the resume case, where subagentSessionId is set because a
  // prior job already ran with that session.
  subagentSessionPreallocated?: boolean;
  // Host scratch-directory path reserved for this invocation (PRI-1796).
  scratchDirHostPath?: string;
  // Container-sharing mode for this delegate job (PRI-1796).
  containerSharing?: 'per_invocation' | 'persistent';
  childTransportClose?: () => void;
  finished: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
  // Progress notification fields
  progressIntervalMs?: number;
  lastProgressAt?: number;
  lastProgressBytes?: number;
  progressTimer?: ReturnType<typeof setInterval>;
  // Subagent provider/model configuration
  connectionId?: string;
  modelId?: string;
  runtimeBinding?: RuntimeExecutionBinding;
  // Persona bundle applied to subagent session (delegate jobs only)
  persona?: string;
  // Carries the parsed persona runtime ONLY when `agentPlacement: 'container'`
  // — i.e. the lace-agent itself runs inside the persona container. Host-placed
  // persona containers flow through `runtimeBinding` instead (the projected
  // binding describes how the host-side lace-agent reaches into the container
  // for tool execution).
  personaContainerRuntime?: PersonaContainerRuntime;
};

// Server State Type
export type AgentServerState = {
  initialized: boolean;
  activeSession: LoadedSession | null;
  config: {
    executionMode: 'plan' | 'execute';
    approvalMode:
      | 'ask'
      | 'approveReads'
      | 'approveEdits'
      | 'approve'
      | 'deny'
      | 'dangerouslySkipPermissions';
    connectionId?: string;
    modelId?: string;
    maxBudgetUsd?: number;
    maxThinkingTokens?: number;
    environment?: Record<string, string>;
  };
  activeTurn: null | {
    turnId: string;
    startedAt: string;
    status: 'running' | 'awaiting_permission';
    abortController: AbortController;
  };
  providerCatalog: ProviderCatalogManager;
  providerCatalogLoaded: boolean;
  providerInstances: ProviderInstanceManager;
  mcpServerManager: MCPServerManager;
  jobManager: JobManager; // Replaces: jobs, jobStreaming, jobNotificationQueue
  pendingPermissionRequests: Map<
    string,
    {
      requestId: string;
      rpcId: JsonRpcId;
      record: PendingPermissionRecord;
      result: Promise<unknown>;
    }
  >;
  sessionMutex: Promise<void>;
  // Key: `${sessionId}|${executionMode}`. Holds Promises so concurrent calls
  // for the same key share one in-flight build.
  toolExecutorCache: Map<string, Promise<{ executor: ToolExecutor; toolsForProvider: Tool[] }>>;
  // Embedder-controlled persona resolver. Defaulted to the module singleton;
  // initialize handler replaces it when the client supplies userPersonasPaths.
  personaRegistry: PersonaRegistry;
  // Embedder-controlled skill directories (ordered, earlier wins). When unset,
  // skill registry construction falls back to getSkillDirectories(workDir).
  // Set by the initialize handler when the client supplies skillDirs.
  skillDirs?: string[];
  // Embedder-supplied named-mount registry. Consulted at persona-container
  // materialization to resolve persona `runtime.mounts[name]` into a host
  // path + readonly flag. Always present; defaults to {} when initialize
  // omits the param.
  containerMounts: Record<string, MountRegistryEntry>;
  // Persona-container materialization (K-49e). null when the host platform
  // has no supported container runtime — persona-container delegate calls
  // then fail with a clear error. Tests inject fakes by replacing this field.
  containerManager: ContainerManager | null;
  /**
   * Per-process ReminderScheduler bound to the currently active session.
   * Created/replaced on session switch via ensureReminderSchedulerForActiveSession;
   * cleared on session/close. Mid-flight fires are owned by the scheduler.
   */
  reminderScheduler?: ReminderScheduler;
  // The JsonRpcPeer this agent process uses to talk to its supervisor (the
  // CLI for a root agent, or the parent lace-agent for a subagent). Set by
  // main.ts after peer construction. Used by emitSubagentExitedIfNeeded to
  // ask the parent to record a `subagent-exited` notification under its
  // runExclusive mutex (avoids cross-process events.jsonl write races).
  peer: JsonRpcPeer | null;
  runtimeSecretResolver?: RuntimeSecretResolver;
  // Idle TTL reaper for per_invocation containers (PRI-1796 Chunk E).
  // Schedules destroy calls after a subagent exits; canceled on resume.
  // Always present after boot — cost is a Map with zero entries until used.
  perInvocationReaper: PerInvocationReaper;
};

// Single entry in the embedder-supplied containerMounts registry.
export type MountRegistryEntry = {
  hostPath: string;
  readonly: boolean;
};
