// ABOUTME: Shared types and constants for the agent server, extracted from server.ts
// This module contains type definitions and configuration constants used across
// the server implementation, including session updates, job state, and server configuration.

import type { ChildProcess } from 'node:child_process';
import type { z } from 'zod';
import { SessionUpdateNotificationSchema } from '@lace/ent-protocol';
import type { JsonRpcPeer } from '@lace/ent-protocol';
import type { LoadedSession } from './storage/session-store';
import type { PendingPermissionRecord } from './storage/permissions-from-events';
import { ProviderCatalogManager } from './providers/catalog/manager';
import { ProviderInstanceManager } from './providers/instance/manager';
import { MCPServerManager } from './mcp/server-manager';
import type { JobManager } from './jobs/job-manager';
import type { ToolExecutor } from './tools/executor';
import type { Tool } from './tools/tool';
import type { SkillRegistry } from './skills';

/**
 * Factory function type for creating tool executors.
 * Used by RPC handlers to create executors with the appropriate mode and dependencies.
 */
export type CreateToolExecutorFn = (
  mode: 'plan' | 'execute',
  mcpServerManager?: MCPServerManager,
  jobManager?: JobManager,
  skillRegistry?: SkillRegistry
) => {
  executor: ToolExecutor;
  toolsForProvider: Tool[];
};

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
  permissionAbortController?: AbortController;
  childPeer?: JsonRpcPeer;
  subagentSessionId?: string;
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
};

export type PendingJobNotification = {
  jobId: string;
  type: JobNotificationType;
  content: string;
  createdAt: number;
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
      rpcId: unknown;
      record: PendingPermissionRecord;
      result: Promise<unknown>;
    }
  >;
  sessionMutex: Promise<void>;
};
