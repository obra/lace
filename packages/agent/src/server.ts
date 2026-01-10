// ABOUTME: Agent server entry point - orchestrates RPC handlers and delegates to specialized modules

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AcpErrorCodes, type JsonRpcPeer } from '@lace/ent-protocol';
import { loadSession, readSessionState, writeSessionState } from './storage/session-store';
import { appendDurableEvent } from './storage/event-log';
import { ProviderCatalogManager } from './providers/catalog/manager';
import { ProviderInstanceManager } from './providers/instance/manager';
import { MCPServerManager } from './mcp/server-manager';
import { ToolExecutor } from './tools/executor';
import type { Tool as CoreTool } from '@lace/agent/tools/tool';
import { createRunShellJobProcess } from './jobs/shell-job';
import { runSubagentJobProcess as runSubagentJobProcessImpl } from './jobs/subagent-job';
import { getJobOutputPath } from './jobs/job-manager';
import {
  createQueueJobNotification,
  createSetupProgressTimer,
  createFinalizeJob,
} from './jobs/job-notifications';
import {
  MAX_CONCURRENT_JOBS,
  type SessionUpdate,
  type JobType,
  type JobStatus,
  type JobState,
  type AgentServerState,
} from './server-types';
import { toNonEmptyString, toolKindFromName } from './rpc/utils';
import { requestPermissionFromClient, reissuePendingPermissionRequests } from './rpc/permissions';
import { registerAllHandlers } from './rpc/register-handlers';

// Re-export public API from message-builder for backwards compatibility
export {
  buildProviderMessagesFromDurableEvents,
  estimateProviderTokens,
} from './message-building/message-builder';

export function createToolExecutorForMode(
  executionMode: 'plan' | 'execute',
  mcpServerManager?: MCPServerManager
): {
  executor: ToolExecutor;
  toolsForProvider: CoreTool[];
} {
  const executor = new ToolExecutor();
  executor.registerAllAvailableTools();

  if (mcpServerManager) {
    executor.registerMCPTools(mcpServerManager);
  }

  const allTools = executor.getAllTools();
  const filteredTools =
    executionMode === 'plan'
      ? allTools.filter((t) => {
          const kind = toolKindFromName(t.name);
          return kind === 'read' || kind === 'search';
        })
      : allTools;

  // Cast to CoreTool[] for provider compatibility - providers still use core Tool type
  const toolsForProvider = filteredTools as unknown as CoreTool[];

  return { executor, toolsForProvider };
}

export function createAgentServerState(): AgentServerState {
  return {
    initialized: false,
    activeSession: null,
    config: { executionMode: 'execute', approvalMode: 'ask' },
    activeTurn: null,
    providerCatalog: new ProviderCatalogManager(),
    providerCatalogLoaded: false,
    providerInstances: new ProviderInstanceManager(),
    mcpServerManager: new MCPServerManager(),
    jobs: new Map(),
    pendingPermissionRequests: new Map(),
    sessionMutex: Promise.resolve(),
    jobStreaming: 'full',
    jobNotificationQueue: [],
  };
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

  // Cache for deriveJobsForActiveSession - avoids re-reading events.jsonl on every call
  let jobsCache: {
    sessionId: string;
    fileSize: number;
    fileMtime: number;
    result: Array<{
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
  } | null = null;

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

  const _startShellJob = async (options: {
    command: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
    progressIntervalMs?: number;
  }): Promise<{ jobId: string }> => {
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    // Check concurrent job limit
    const runningJobCount = [...state.jobs.values()].filter((j) => j.status === 'running').length;
    if (runningJobCount >= MAX_CONCURRENT_JOBS) {
      throw {
        code: -32003, // ResourceLimitExceeded
        message: `Maximum concurrent jobs (${MAX_CONCURRENT_JOBS}) exceeded`,
        data: { category: 'session' },
      };
    }

    const jobId = `job_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    const job: JobState = {
      jobId,
      parentJobId: options.parentJobId,
      type: 'bash',
      status: 'running',
      description: options.description,
      command: options.command,
      startedAt,
      originTurnId: options.turnContext?.turnId,
      originTurnSeq: options.turnContext?.turnSeq,
      outputPath,
      finished: false,
      completion,
      resolveCompletion,
      progressIntervalMs: options.progressIntervalMs,
    };

    state.jobs.set(jobId, job);

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_started',
        turnId: options.turnContext?.turnId,
        turnSeq: options.turnContext?.turnSeq,
        data: {
          jobId,
          parentJobId: options.parentJobId,
          jobType: 'bash',
          description: options.description,
          command: options.command,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    await emitSessionUpdate(
      {
        type: 'job_started',
        jobId,
        parentJobId: options.parentJobId,
        jobType: 'bash',
        description: options.description,
      },
      options.turnContext
        ? { turnId: options.turnContext.turnId, turnSeq: options.turnContext.turnSeq }
        : undefined
    );

    // Set up progress timer for background job
    setupProgressTimer(job);

    void runShellJobProcess(job);
    return { jobId };
  };

  const startSubagentJob = async (options: {
    prompt: string;
    description?: string;
    parentJobId?: string;
    turnContext?: { turnId: string; turnSeq: number };
    resumeSessionId?: string;
    progressIntervalMs?: number;
    connectionId?: string;
    modelId?: string;
  }): Promise<{ jobId: string }> => {
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    // Check concurrent job limit
    const runningJobCount = [...state.jobs.values()].filter((j) => j.status === 'running').length;
    if (runningJobCount >= MAX_CONCURRENT_JOBS) {
      throw {
        code: -32003, // ResourceLimitExceeded
        message: `Maximum concurrent jobs (${MAX_CONCURRENT_JOBS}) exceeded`,
        data: { category: 'session' },
      };
    }

    const jobId = `job_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const outputPath = getJobOutputPath(state.activeSession.dir, jobId);

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    const job: JobState = {
      jobId,
      parentJobId: options.parentJobId,
      type: 'delegate',
      status: 'running',
      description: options.description ?? 'Subagent',
      command: options.prompt,
      subagentContent: [{ type: 'text', text: options.prompt }],
      startedAt,
      originTurnId: options.turnContext?.turnId,
      originTurnSeq: options.turnContext?.turnSeq,
      outputPath,
      finished: false,
      completion,
      resolveCompletion,
      progressIntervalMs: options.progressIntervalMs,
      connectionId: options.connectionId,
      modelId: options.modelId,
      // For resume: pre-set the subagentSessionId if resuming a previous session
      ...(options.resumeSessionId ? { subagentSessionId: options.resumeSessionId } : {}),
    };

    state.jobs.set(jobId, job);

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'job_started',
        turnId: options.turnContext?.turnId,
        turnSeq: options.turnContext?.turnSeq,
        data: {
          jobId,
          parentJobId: options.parentJobId,
          jobType: 'delegate',
          description: job.description,
          command: options.prompt,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

    await emitSessionUpdate(
      {
        type: 'job_started',
        jobId,
        parentJobId: options.parentJobId,
        jobType: 'delegate',
        description: job.description,
      },
      options.turnContext
        ? { turnId: options.turnContext.turnId, turnSeq: options.turnContext.turnSeq }
        : undefined
    );

    // Set up progress timer for background job
    setupProgressTimer(job);

    void runSubagentJobProcess(job);
    return { jobId };
  };

  const runShellJobProcess = createRunShellJobProcess({
    state: {
      activeSession: state.activeSession,
      config: state.config,
      jobStreaming: state.jobStreaming,
    },
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

  const deriveJobsForActiveSession = (): Array<{
    jobId: string;
    parentJobId?: string;
    type: JobType;
    status: JobStatus;
    description?: string;
    command?: string;
    startTime: string;
    exitCode?: number;
    subagentSessionId?: string;
  }> => {
    if (!state.activeSession) return [];

    const sessionId = state.activeSession.meta.sessionId;
    const sessionDir = state.activeSession.dir;
    const eventsPath = join(sessionDir, 'events.jsonl');

    // Check cache validity
    let fileSize = 0;
    let fileMtime = 0;
    try {
      const stats = statSync(eventsPath);
      fileSize = stats.size;
      fileMtime = stats.mtimeMs;
    } catch {
      return [];
    }

    if (
      jobsCache &&
      jobsCache.sessionId === sessionId &&
      jobsCache.fileSize === fileSize &&
      jobsCache.fileMtime === fileMtime
    ) {
      // Cache hit - but still need to update running job status from in-memory state
      const result = jobsCache.result.map((job) => {
        if (job.status === 'running' && !state.jobs.has(job.jobId)) {
          return { ...job, status: 'failed' as JobStatus };
        }
        return job;
      });
      return result;
    }

    // Cache miss - read and parse the file
    let raw = '';
    try {
      raw = readFileSync(eventsPath, 'utf8');
    } catch {
      return [];
    }

    const byId = new Map<
      string,
      {
        jobId: string;
        parentJobId?: string;
        type: JobType;
        status: JobStatus;
        description?: string;
        command?: string;
        startTime: string;
        exitCode?: number;
        subagentSessionId?: string;
      }
    >();

    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string; timestamp?: string; data?: unknown };
        if (
          parsed.type !== 'job_started' &&
          parsed.type !== 'job_finished' &&
          parsed.type !== 'job_session_assigned'
        )
          continue;
        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined;
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        const jobId = toNonEmptyString(data.jobId);
        if (!jobId) continue;

        if (parsed.type === 'job_started') {
          const jobType = data.jobType === 'delegate' ? 'delegate' : 'bash';
          const startTime = timestamp ?? new Date().toISOString();
          byId.set(jobId, {
            jobId,
            parentJobId: toNonEmptyString(data.parentJobId) ?? undefined,
            type: jobType,
            status: 'running',
            description: toNonEmptyString(data.description) ?? undefined,
            command: toNonEmptyString(data.command) ?? undefined,
            startTime,
          });
        } else if (parsed.type === 'job_session_assigned') {
          const existing = byId.get(jobId);
          const subagentSessionId = toNonEmptyString(data.subagentSessionId);
          if (existing && subagentSessionId) {
            existing.subagentSessionId = subagentSessionId;
          }
        } else {
          const existing = byId.get(jobId);
          const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined;
          const outcome =
            data.outcome === 'completed' ||
            data.outcome === 'failed' ||
            data.outcome === 'cancelled'
              ? data.outcome
              : undefined;

          if (existing) {
            existing.status = outcome ?? existing.status;
            existing.exitCode = exitCode;
          } else {
            byId.set(jobId, {
              jobId,
              type: 'bash',
              status: outcome ?? 'failed',
              startTime: timestamp ?? new Date().toISOString(),
              exitCode,
            });
          }
        }
      } catch {
        // Ignore malformed lines.
      }
    }

    // Update cache with parsed results (before applying running status updates)
    const parsedResult = Array.from(byId.values());
    jobsCache = {
      sessionId,
      fileSize,
      fileMtime,
      result: parsedResult,
    };

    // Apply running job status updates from in-memory state
    for (const job of parsedResult) {
      if (job.status === 'running' && !state.jobs.has(job.jobId)) {
        job.status = 'failed';
      }
    }

    return parsedResult;
  };

  // Register all RPC handlers with dependencies
  registerAllHandlers(peer, state, {
    createToolExecutorForMode,
    runExclusive,
    emitSessionUpdate,
    reissuePendingPermissions: () => _reissuePendingPermissionRequests(),
    deriveJobsForActiveSession,
    requestPermissionFromClient: _requestPermissionFromClient,
    finalizeJob,
    startShellJob: _startShellJob,
    startSubagentJob,
    runShellJobProcess,
    runSubagentJobProcess,
    runPromptInternalRef,
  });
}
