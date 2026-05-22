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
import type { AgentServerState, SessionUpdate, CreateToolExecutorFn } from '../server-types';

/**
 * Dependencies passed to handler registration functions
 */
interface HandlerDependencies {
  createToolExecutorForMode: CreateToolExecutorFn;
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>;
  emitSessionUpdate: (
    update: SessionUpdate,
    context?: { turnId?: string; turnSeq?: number; jobId?: string }
  ) => Promise<void>;
  reissuePendingPermissions: () => Promise<void>;
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
  startShellJob: (options: {
    command: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
    progressIntervalMs?: number;
  }) => Promise<{ jobId: string }>;
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null };
  /**
   * Rebind the per-process AlarmScheduler to the currently active session.
   * Called after every session switch (session/new, session/load, session/resume)
   * and after session/close (which is a no-op since activeSession is null).
   */
  ensureAlarmScheduler: () => Promise<void>;
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
    deps.reissuePendingPermissions,
    deps.ensureAlarmScheduler
  );
  registerSessionOperationHandlers(peer, state, deps.runExclusive, deps.createToolExecutorForMode);

  // MCP server management
  registerMcpHandlers(peer, state, deps.runExclusive);

  // Job management
  registerJobHandlers(peer, state);

  // Prompt/agent execution
  registerPromptHandler(
    peer,
    state,
    deps.runExclusive,
    deps.emitSessionUpdate,
    deps.requestPermissionFromClient,
    deps.createToolExecutorForMode,
    deps.startShellJob,
    deps.runPromptInternalRef
  );
}
