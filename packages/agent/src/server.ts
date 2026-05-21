// ABOUTME: Agent server entry point - orchestrates RPC handlers and delegates to specialized modules

import type { JsonRpcPeer } from '@lace/ent-protocol';
import { loadSession, readSessionState, writeSessionState } from './storage/session-store';
import { appendDurableEvent } from './storage/event-log';
import { ProviderCatalogManager } from './providers/catalog/manager';
import { ProviderInstanceManager } from './providers/instance/manager';
import { MCPServerManager } from './mcp/server-manager';
import {
  personaRegistry as defaultPersonaRegistry,
  type PersonaRegistry,
} from './config/persona-registry';
import { createDefaultContainerManager } from './containers/manager-factory';
import { ToolExecutor } from './tools/executor';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import type { SkillRegistry } from '@lace/agent/skills';
import { createRunShellJobProcess } from './jobs/shell-job';
import { runSubagentJobProcess as runSubagentJobProcessImpl } from './jobs/subagent-job';
import {
  createQueueJobNotification,
  createSetupProgressTimer,
  createFinalizeJob,
} from './jobs/job-notifications';
import {
  createShellJob,
  createSubagentJob,
  JobCreationError,
  type CreateShellJobOptions,
  type CreateSubagentJobOptions,
} from './jobs/job-creation';
import { JobManager } from './jobs/job-manager';
import {
  type SessionUpdate,
  type JobState,
  type AgentServerState,
  type AgentToolScope,
} from './server-types';
import { toolKindFromName } from './rpc/utils';
import { requestPermissionFromClient, reissuePendingPermissionRequests } from './rpc/permissions';
import { registerAllHandlers } from './rpc/register-handlers';
import { AlarmScheduler } from './alarms/alarm-scheduler';
import { AlarmStore } from './alarms/alarm-store';
import { injectNotification, composeAlarmFiredBody } from './notifications';
import { logger } from './utils/logger';

// Re-export public API from message-builder for backwards compatibility
export {
  buildProviderMessagesFromDurableEvents,
  estimateProviderTokens,
} from './message-building/message-builder';

export async function createToolExecutorForMode(
  executionMode: 'plan' | 'execute',
  mcpServerManager?: MCPServerManager,
  jobManager?: JobManager,
  skillRegistry?: SkillRegistry,
  toolScope?: AgentToolScope,
  personaRegistry?: PersonaRegistry
): Promise<{
  executor: ToolExecutor;
  toolsForProvider: CoreTool[];
}> {
  const executor = new ToolExecutor();
  executor.registerAllAvailableTools(skillRegistry, { personaRegistry });

  if (mcpServerManager) {
    executor.registerMCPTools(mcpServerManager);
    // Block until MCP discovery resolves so the returned tool list is complete.
    await executor.ensureMCPToolsReady(10000);
  }

  if (jobManager) {
    executor.setJobManager(jobManager);
  }

  const allTools = executor.getAllTools();
  // Scope filter runs before plan-mode kind filter so plan still restricts to read/search.
  const scoped =
    toolScope === undefined ? allTools : allTools.filter((t) => toolScope.includes(t.name));
  const filteredTools =
    executionMode === 'plan'
      ? scoped.filter((t) => {
          const kind = toolKindFromName(t.name);
          return kind === 'read' || kind === 'search';
        })
      : scoped;

  // Cast to CoreTool[] for provider compatibility - providers still use core Tool type
  const toolsForProvider = filteredTools as unknown as CoreTool[];

  return { executor, toolsForProvider };
}

export function createAgentServerState(): AgentServerState {
  // JobManager is created as a placeholder here and properly initialized
  // in registerAgentRpcMethods once we have the peer and other dependencies
  return {
    initialized: false,
    activeSession: null,
    config: { executionMode: 'execute', approvalMode: 'ask' },
    activeTurn: null,
    providerCatalog: new ProviderCatalogManager(),
    providerCatalogLoaded: false,
    providerInstances: new ProviderInstanceManager(),
    mcpServerManager: new MCPServerManager(),
    jobManager: null as unknown as JobManager, // Initialized in registerAgentRpcMethods
    pendingPermissionRequests: new Map(),
    sessionMutex: Promise.resolve(),
    toolExecutorCache: new Map(),
    personaRegistry: defaultPersonaRegistry,
    containerMounts: {},
    containerManager: createDefaultContainerManager(),
  };
}

/**
 * Read-only accessor for the embedder-supplied containerMounts registry.
 * Returns the registry as set by the most recent initialize call (defaults to {}).
 * Persona-container materialization (K-49e) consults this to resolve
 * `runtime.mounts[name]` into a host path + readonly flag.
 */
export function getContainerMounts(
  state: AgentServerState
): Readonly<AgentServerState['containerMounts']> {
  return state.containerMounts;
}

type ToolExecutorCacheValue = { executor: ToolExecutor; toolsForProvider: CoreTool[] };
type ToolExecutorCache = Map<string, Promise<ToolExecutorCacheValue>>;

export function getOrCreateSessionToolExecutor(
  cache: ToolExecutorCache,
  sessionId: string,
  executionMode: 'plan' | 'execute',
  build: () => Promise<ToolExecutorCacheValue>,
  toolScope?: AgentToolScope
): Promise<ToolExecutorCacheValue> {
  const scopeKey = toolScope === undefined ? '*' : toolScope.slice().sort().join(',');
  const key = `${sessionId}|${executionMode}|${scopeKey}`;
  const existing = cache.get(key);
  if (existing) return existing;
  // Insert the Promise synchronously so concurrent callers see the same in-flight build.
  const pending = build();
  cache.set(key, pending);
  // If the build rejects, drop the entry so the next call retries.
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

/**
 * Bind a fresh AlarmScheduler to the currently active session.
 * Idempotent: if a scheduler already exists, it is stopped first.
 * No-op when there is no active session (e.g., after session/close).
 *
 * The scheduler's notifier writes an immediate-priority context_injected
 * event into the active session's events.jsonl and triggers an internal
 * turn if the agent is idle, so the next turn picks up the alarm body.
 */
export function ensureAlarmSchedulerForActiveSession(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null }
): void {
  if (!state.activeSession) return;
  if (state.alarmScheduler) {
    void state.alarmScheduler.stop();
    state.alarmScheduler = undefined;
  }
  const sessionDir = state.activeSession.dir;
  const store = new AlarmStore(sessionDir);
  const jitterEnv = Number(process.env.LACE_ALARM_JITTER_MS ?? 60_000);
  const jitterMaxMs = Number.isFinite(jitterEnv) && jitterEnv >= 0 ? jitterEnv : 60_000;
  state.alarmScheduler = new AlarmScheduler({
    sessionDir,
    store,
    now: () => Date.now(),
    jitterMaxMs,
    notifier: ({ row }) => {
      injectNotification({
        sessionDir,
        kind: 'alarm-fired',
        identifiers: { 'alarm-id': row.id },
        body: composeAlarmFiredBody({
          kind: row.kind,
          schedule: row.schedule,
          timezone: row.timezone,
          prompt: row.prompt,
        }),
        idleWake: {
          isActive: (d) => d === state.activeSession?.dir,
          hasActiveTurn: () => !!state.activeTurn,
          triggerInternalTurn: () => {
            if (!runPromptInternalRef.current) return;
            setImmediate(() => {
              if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
                void runPromptInternalRef.current([]);
              }
            });
          },
        },
      });
    },
    onError: (err) => {
      logger.warn('alarm.scheduler.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    },
  });
  void state.alarmScheduler.start();
}

export function invalidateSessionToolExecutor(cache: ToolExecutorCache, sessionId: string): void {
  const prefix = `${sessionId}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function registerAgentRpcMethods(peer: JsonRpcPeer, state: AgentServerState): void {
  const runExclusive = async <T>(work: () => Promise<T> | T): Promise<T> => {
    const previous = state.sessionMutex;
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    state.sessionMutex = previous.then(() => next);
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };

  const emitSessionUpdate = async (
    update: SessionUpdate,
    context?: { turnId?: string; turnSeq?: number; jobId?: string }
  ) => {
    if (!state.activeSession) return;

    await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      peer.notify('session/update', {
        sessionId: state.activeSession!.meta.sessionId,
        streamSeq: sessionState.nextStreamSeq,
        turnId: context?.turnId,
        turnSeq: context?.turnSeq,
        jobId: context?.jobId,
        ...update,
      });
      writeSessionState(state.activeSession!.dir, {
        ...sessionState,
        nextStreamSeq: sessionState.nextStreamSeq + 1,
      });
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });
  };

  // Reference to the prompt handler logic, assigned when session/prompt is registered.
  // This allows queueJobNotification to trigger turns internally when notifications
  // are pending and the agent is idle.
  const runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null } = {
    current: null,
  };

  // Create job notification functions using factories
  // These still use state.jobManager internally
  const queueJobNotification = createQueueJobNotification(state, runPromptInternalRef);
  const setupProgressTimer = createSetupProgressTimer(
    state,
    runPromptInternalRef,
    queueJobNotification
  );
  const finalizeJob = createFinalizeJob(
    state,
    runExclusive,
    emitSessionUpdate,
    queueJobNotification
  );

  const _requestPermissionFromClient = async (request: {
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
  }): Promise<{ decision?: string; updatedInput?: Record<string, unknown> }> =>
    requestPermissionFromClient(peer, state, runExclusive, request);

  const _reissuePendingPermissionRequests = async (): Promise<void> =>
    reissuePendingPermissionRequests(peer, state, runExclusive);

  // Create job process runners - needed by job creation deps
  const runShellJobProcess = createRunShellJobProcess({
    getState: () => ({
      activeSession: state.activeSession,
      config: state.config,
      jobStreaming: state.jobManager.getStreamingMode(),
    }),
    runExclusive,
    emitSessionUpdate,
    requestPermissionFromClient: _requestPermissionFromClient,
    finalizeJob,
  });

  const runSubagentJobProcess = (job: JobState) => {
    runSubagentJobProcessImpl(job, {
      getState: () => state,
      runExclusive,
      emitSessionUpdate,
      requestPermissionFromClient: _requestPermissionFromClient,
      finalizeJob,
    });
  };

  // Create JobManager with all dependencies now available
  state.jobManager = new JobManager({
    getActiveSession: () =>
      state.activeSession
        ? { sessionId: state.activeSession.meta.sessionId, dir: state.activeSession.dir }
        : null,
    persistEvent: async (event) => {
      if (!state.activeSession) return;
      await runExclusive(() => {
        let sessionState = readSessionState(state.activeSession!.dir);
        const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, event);
        sessionState = nextState;
        writeSessionState(state.activeSession!.dir, sessionState);
        state.activeSession = loadSession(state.activeSession!.meta.sessionId);
      });
    },
    emitUpdate: async (update) => {
      await emitSessionUpdate(update as SessionUpdate);
    },
    runShellProcess: (job) => void runShellJobProcess(job),
    runSubagentProcess: (job) => void runSubagentJobProcess(job),
    setupProgressTimer: (job) => setupProgressTimer(job),
  });

  // Persist job_started event to session storage
  const persistJobStartedEvent = async (event: {
    jobId: string;
    parentJobId?: string;
    jobType: 'bash' | 'delegate';
    description?: string;
    command?: string;
    turnContext?: { turnId: string; turnSeq: number };
  }): Promise<void> => {
    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_started',
        turnId: event.turnContext?.turnId,
        turnSeq: event.turnContext?.turnSeq,
        data: {
          jobId: event.jobId,
          parentJobId: event.parentJobId,
          jobType: event.jobType,
          description: event.description,
          command: event.command,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });
  };

  // Shared job creation dependencies
  const jobCreationDeps = {
    getActiveSession: () => state.activeSession,
    getJobs: () => state.jobManager.getRunningJobs(),
    persistJobStartedEvent,
    emitSessionUpdate,
    setupProgressTimer,
    runShellJobProcess: (job: JobState) => void runShellJobProcess(job),
    runSubagentJobProcess: (job: JobState) => void runSubagentJobProcess(job),
  };

  // Common error handling for job creation - converts JobCreationError to RPC error format
  async function wrapJobCreation<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof JobCreationError) {
        throw { code: err.code, message: err.message, data: { category: err.category } };
      }
      throw err;
    }
  }

  // Job creation wrappers - delegate to extracted library functions
  const _startShellJob = (options: CreateShellJobOptions): Promise<{ jobId: string }> =>
    wrapJobCreation(() => createShellJob(options, jobCreationDeps));

  const _startSubagentJob = (options: CreateSubagentJobOptions): Promise<{ jobId: string }> =>
    wrapJobCreation(() => createSubagentJob(options, jobCreationDeps));

  const ensureAlarmScheduler = (): void =>
    ensureAlarmSchedulerForActiveSession(state, runPromptInternalRef);

  // Register all RPC handlers with dependencies
  registerAllHandlers(peer, state, {
    createToolExecutorForMode,
    runExclusive,
    emitSessionUpdate,
    reissuePendingPermissions: () => _reissuePendingPermissionRequests(),
    requestPermissionFromClient: _requestPermissionFromClient,
    startShellJob: _startShellJob,
    runPromptInternalRef,
    ensureAlarmScheduler,
  });
}
