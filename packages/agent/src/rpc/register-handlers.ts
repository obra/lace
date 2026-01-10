// ABOUTME: Central handler registration - wires all RPC handlers to the JSON-RPC peer

import type { JsonRpcPeer } from '@lace/ent-protocol';
import { registerInitializeHandler } from './handlers/initialize';
import { registerAgentStatusHandlers } from './handlers/agent-status';
import { registerProviderHandlers } from './handlers/providers';
import { registerConnectionHandlers } from './handlers/connections';
import { registerModelHandlers } from './handlers/models';
import { registerToolHandlers } from './handlers/tools';
import { registerJobHandlers } from './handlers/jobs';
import { registerSessionHandlers } from './handlers/session';
import { registerSessionOperationHandlers } from './handlers/session-operations';
import { registerMcpHandlers } from './handlers/mcp-servers';
import { registerPromptHandler } from './handlers/prompt';
import { registerWorkspaceHandlers } from './handlers/workspace';
import type {
  AgentServerState,
  JobState,
  SessionUpdate,
  JobType,
  JobStatus,
} from '../server-types';
import type { MCPServerManager } from '../mcp/server-manager';

/**
 * Dependencies passed to handler registration functions
 */
interface HandlerDependencies {
  createToolExecutorForMode: (
    mode: 'plan' | 'execute',
    mcpServerManager?: MCPServerManager
  ) => { executor: any; toolsForProvider: any[] };
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>;
  emitSessionUpdate: (
    update: SessionUpdate,
    context?: { turnId?: string; turnSeq?: number; jobId?: string }
  ) => Promise<void>;
  reissuePendingPermissions: () => Promise<void>;
  deriveJobsForActiveSession: () => Array<{
    jobId: string;
    parentJobId?: string;
    type: JobType;
    status: JobStatus;
    description?: string;
    command?: string;
    startTime: string;
    exitCode?: number;
    subagentSessionId?: string;
  }>;
  requestPermissionFromClient: (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    jobId?: string;
    toolCallId: string;
    tool: string;
    kind?: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
    input: Record<string, unknown>;
    signal?: AbortSignal;
  }) => Promise<{ decision?: string; updatedInput?: Record<string, unknown> }>;
  finalizeJob: (job: JobState, options?: { exitCode?: number }) => Promise<void>;
  startShellJob: (options: {
    command: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
    progressIntervalMs?: number;
  }) => Promise<{ jobId: string }>;
  startSubagentJob: (options: {
    prompt: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
    resumeSessionId?: string;
    progressIntervalMs?: number;
    connectionId?: string;
    modelId?: string;
  }) => Promise<{ jobId: string }>;
  runShellJobProcess: (job: JobState) => void;
  runSubagentJobProcess: (job: JobState) => void;
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null };
}

/**
 * Register all RPC handler methods with the peer.
 * This centralizes handler wiring and dependency injection.
 */
export function registerAllHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  deps: HandlerDependencies
): void {
  // Core initialization and status
  registerInitializeHandler(peer, state, deps.createToolExecutorForMode);
  registerAgentStatusHandlers(peer, state, deps.reissuePendingPermissions);

  // Provider and model management
  registerProviderHandlers(peer, state);
  registerConnectionHandlers(peer, state);
  registerModelHandlers(peer, state);

  // Tool management
  registerToolHandlers(peer, state, deps.createToolExecutorForMode);

  // Session management
  registerSessionHandlers(
    peer,
    state,
    deps.createToolExecutorForMode,
    deps.runExclusive,
    deps.reissuePendingPermissions
  );
  registerSessionOperationHandlers(peer, state, deps.runExclusive, deps.createToolExecutorForMode);

  // MCP server management
  registerMcpHandlers(peer, state, deps.runExclusive);

  // Job management
  registerJobHandlers(peer, state, deps.deriveJobsForActiveSession, deps.finalizeJob);

  // Prompt/agent execution
  registerPromptHandler(
    peer,
    state,
    deps.runExclusive,
    deps.emitSessionUpdate,
    deps.requestPermissionFromClient,
    deps.createToolExecutorForMode,
    deps.startShellJob,
    deps.startSubagentJob,
    deps.deriveJobsForActiveSession,
    deps.runShellJobProcess,
    deps.runSubagentJobProcess,
    deps.finalizeJob,
    deps.runPromptInternalRef
  );

  // Workspace information
  registerWorkspaceHandlers(peer, state);
}
