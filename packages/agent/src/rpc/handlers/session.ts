// ABOUTME: Session lifecycle RPC handlers for creating, loading, and managing sessions

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AcpErrorCodes,
  SessionForkParamsSchema,
  isSessionId,
  type JsonRpcPeer,
  type McpServerConfig,
} from '@lace/ent-protocol';
import {
  ensureSessionFiles,
  getSessionDir,
  listSessions,
  loadSession,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
  type LoadedSession,
  type SessionState,
} from '../../storage/session-store';
import { SessionStorageError } from '../../errors/agent-errors';
import {
  appendDurableEvent,
  readDurableEvents,
  summarizeDurableEvents,
} from '../../storage/event-log';
import type { AgentServerState, CreateToolExecutorFn } from '../../server-types';
import { assertInitialized, throwInvalidParams, toNonEmptyString } from '../utils';
import { loadPromptConfig } from '../../config/prompts';
import { logger } from '../../utils/logger';
import { reconcileMcpServersForActiveSession } from './mcp-servers';
import { SkillRegistry, getSkillDirectories } from '../../skills';
import { killAllRunningJobs } from '../../jobs';
import { getEffectiveConfig } from '@lace/agent/core/session';
import { PersonaNotFoundError, PersonaParseError } from '../../config/persona-registry';
import { LACE_BUILTIN_TOOL_NAMES } from '../../tools/executor';
import {
  buildSessionConfigOptions,
  defaultMcpServerPlacements,
  mergeMcpServers,
} from '../session-config';
import { cancelPendingPermissionRequests } from '../permissions';
import {
  buildDefaultLocalRuntimeBinding,
  parseRuntimeExecutionBinding,
} from '../../tools/runtime/validation';
import type { RuntimeExecutionBinding } from '../../tools/runtime/types';

type SessionRestoreParams = {
  sessionId: string;
  cwd: string;
  mcpServers: McpServerConfig[];
  runtimeBinding?: RuntimeExecutionBinding;
};

function assertSessionIdParam(sessionId: unknown): asserts sessionId is string {
  if (!sessionId) throwInvalidParams('sessionId is required');
  if (typeof sessionId !== 'string' || !isSessionId(sessionId)) {
    throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
  }
}

function parseSessionRestoreParams(params: unknown): SessionRestoreParams {
  const parsed = params as
    | (Partial<SessionRestoreParams> & { config?: { runtimeBinding?: unknown } })
    | undefined;
  assertSessionIdParam(parsed?.sessionId);
  if (!parsed?.cwd) throwInvalidParams('cwd is required');
  if (!Array.isArray(parsed.mcpServers)) throwInvalidParams('mcpServers is required');
  return {
    sessionId: parsed.sessionId,
    cwd: parsed.cwd,
    mcpServers: parsed.mcpServers,
    ...(parsed.config?.runtimeBinding !== undefined
      ? { runtimeBinding: parseSessionRuntimeBinding(parsed.config.runtimeBinding) }
      : {}),
  };
}

function parseSessionRuntimeBinding(value: unknown): RuntimeExecutionBinding {
  let runtimeBinding: RuntimeExecutionBinding;
  try {
    runtimeBinding = parseRuntimeExecutionBinding(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throwInvalidParams(`config.runtimeBinding is invalid: ${message}`);
  }
  if (runtimeBinding.toolRuntime.type !== 'local') {
    throwInvalidParams(
      'config.runtimeBinding is invalid: only local runtime bindings are supported for sessions'
    );
  }
  return runtimeBinding;
}

function rehydrateServerConfigFromSession(
  state: AgentServerState,
  sessionState: SessionState
): void {
  const loadedConfig = sessionState.config;
  if (loadedConfig?.connectionId) {
    state.config.connectionId = loadedConfig.connectionId;
  }
  if (loadedConfig?.modelId) {
    state.config.modelId = loadedConfig.modelId;
  }
}

function mergeMcpServersIntoLoadedSession(
  loaded: LoadedSession,
  mcpServers: McpServerConfig[],
  runtimeBinding?: RuntimeExecutionBinding
): LoadedSession {
  const currentState = loaded.state;
  const currentConfig = currentState.config ?? {};
  const nextState: SessionState = {
    ...currentState,
    config: {
      ...currentConfig,
      mcpServers: mergeMcpServers(currentConfig.mcpServers, mcpServers),
      ...(runtimeBinding ? { runtimeBinding } : {}),
    },
  };
  return { ...loaded, state: nextState };
}

function abortActiveTurn(state: AgentServerState): void {
  if (state.activeTurn) {
    state.activeTurn.abortController.abort();
  }
}

function abortRunningJobPermissionControllers(state: AgentServerState): void {
  for (const job of state.jobManager.getRunningJobs().values()) {
    job.permissionAbortController?.abort();
  }
}

async function releaseRunningSessionWork(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>
): Promise<void> {
  await cancelPendingPermissionRequests(peer, state, runExclusive);
  const runningJobs = [...state.jobManager.getRunningJobs().values()];
  await killAllRunningJobs(state.jobManager.getRunningJobs(), { waitMs: 500, forceKill: true });
  await Promise.all(runningJobs.map((job) => state.jobManager.finalizeJob(job)));
  state.pendingPermissionRequests.clear();
  state.jobManager.clearJobs();
}

async function activateStoredSession(
  peer: JsonRpcPeer,
  state: AgentServerState,
  params: SessionRestoreParams,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  reissuePendingPermissionRequests: () => Promise<void>,
  ensureAlarmScheduler: () => Promise<void>
): Promise<LoadedSession> {
  if (state.activeTurn) {
    throw {
      code: AcpErrorCodes.SessionBusy,
      message: 'SessionBusy',
      data: { category: 'session' },
    };
  }

  let loaded;
  try {
    loaded = loadSession(params.sessionId);
  } catch (error) {
    if (error instanceof Error && error.message === 'Session not found') {
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    }
    throw error;
  }
  if (loaded.state.config?.runtimeBinding !== undefined) {
    parseSessionRuntimeBinding(loaded.state.config.runtimeBinding);
  }

  const loadedWithMcpServers = mergeMcpServersIntoLoadedSession(
    loaded,
    params.mcpServers,
    params.runtimeBinding
  );
  const switchingSessions =
    state.activeSession && state.activeSession.meta.sessionId !== params.sessionId;

  writeSessionState(loadedWithMcpServers.dir, loadedWithMcpServers.state);
  if (switchingSessions) {
    await releaseRunningSessionWork(peer, state, runExclusive);
  }

  state.activeSession = loadedWithMcpServers;
  rehydrateServerConfigFromSession(state, state.activeSession.state);
  await ensureAlarmScheduler();

  await reconcileMcpServersForActiveSession(state);
  await reissuePendingPermissionRequests();
  return state.activeSession;
}

/**
 * Register session lifecycle handlers with the peer.
 * - session/new: Create a new session
 * - session/list: List all available sessions
 * - session/load: Load an existing session
 * - session/resume: Reconnect to an existing session without replaying history
 * - session/close: Release an active session
 * - session/fork: Create a fork of an existing session
 * - session/cancel: Cancel active operations
 * - session/set_mode: Change execution mode (plan/execute)
 */
export function registerSessionHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  createToolExecutorForMode: CreateToolExecutorFn,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  reissuePendingPermissionRequests: () => Promise<void>,
  ensureAlarmScheduler: () => Promise<void>
): void {
  peer.onRequest('session/new', async (params: unknown) => {
    assertInitialized(state);
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    await releaseRunningSessionWork(peer, state, runExclusive);

    const parsed = params as {
      cwd: string;
      mcpServers?: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
        transport?: 'stdio' | 'sse' | 'http';
        enabled?: boolean;
        tools?: Record<string, 'allow' | 'ask' | 'deny' | 'disable'>;
      }>;
      persona?: string;
      systemPrompt?: unknown;
      config?: {
        connectionId?: string;
        modelId?: string;
        persona?: string;
        runtimeBinding?: unknown;
      };
      parent?: {
        sessionId: string;
        jobId: string;
        personaName?: string;
      };
    };
    if (!parsed?.cwd) throwInvalidParams('cwd is required');
    const runtimeBinding =
      parsed.config?.runtimeBinding !== undefined
        ? parseSessionRuntimeBinding(parsed.config.runtimeBinding)
        : undefined;

    // Persona may arrive top-level (subagent/delegate path) or nested under config.
    const requestedPersona =
      toNonEmptyString(parsed.config?.persona) ?? toNonEmptyString(parsed.persona);

    // Parse persona frontmatter before any storage writes so we fail fast on invalid input.
    const personaDefaults: {
      modelId?: string;
      toolScope?: string[];
      mcpServers?: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
        enabled?: boolean;
        tools?: Record<string, 'allow' | 'ask' | 'deny' | 'disable'>;
      }>;
    } = {};
    if (requestedPersona) {
      try {
        const { config: personaConfig } = state.personaRegistry.parsePersona(requestedPersona);
        if (personaConfig.model) personaDefaults.modelId = personaConfig.model;
        if (personaConfig.tools) {
          // Persona `tools:` frontmatter is ADDITIVE over lace builtins.
          // Builtins are platform tools (file_read, bash, ripgrep_search, ...)
          // that should always be available; the persona layer only declares
          // its specialized additions (typically MCP-namespaced tools).
          // Treating persona.tools as a strict allowlist caused kata #31:
          // subagents lost access to file_read and stopped after one turn.
          const union = new Set<string>([...LACE_BUILTIN_TOOL_NAMES, ...personaConfig.tools]);
          personaDefaults.toolScope = Array.from(union);
        }
        if (personaConfig.mcpServers) {
          personaDefaults.mcpServers = Object.entries(personaConfig.mcpServers).map(
            ([name, spec]) => ({
              name,
              command: spec.command,
              ...(spec.args ? { args: spec.args } : {}),
              ...(spec.env ? { env: spec.env } : {}),
              ...(spec.transport ? { transport: spec.transport } : {}),
              ...(spec.secretEnv ? { secretEnv: spec.secretEnv } : {}),
              ...(spec.placement ? { placement: spec.placement } : {}),
              ...(spec.enabled !== undefined ? { enabled: spec.enabled } : {}),
              ...(spec.tools
                ? {
                    tools: spec.tools as Record<string, 'allow' | 'ask' | 'deny' | 'disable'>,
                  }
                : {}),
            })
          );
        }
      } catch (err) {
        if (err instanceof PersonaNotFoundError || err instanceof PersonaParseError) {
          throw {
            code: -32602,
            message: err.message,
            data: { category: 'protocol', reason: 'PersonaInvalid' },
          };
        }
        throw err;
      }
    }

    // Request-level fields win over persona defaults.
    const effectiveModelId =
      toNonEmptyString(parsed.config?.modelId) ?? personaDefaults.modelId ?? state.config.modelId;
    const effectiveConnectionId =
      toNonEmptyString(parsed.config?.connectionId) ?? state.config.connectionId;
    const effectiveMcpServers =
      parsed.mcpServers !== undefined
        ? mergeMcpServers(personaDefaults.mcpServers, parsed.mcpServers)
        : personaDefaults.mcpServers
          ? defaultMcpServerPlacements(personaDefaults.mcpServers)
          : undefined;
    const effectiveToolScope = personaDefaults.toolScope;

    const sessionId = `sess_${randomUUID()}`;
    const created = new Date().toISOString();

    let sessionDir: string;
    try {
      sessionDir = getSessionDir(sessionId);
      writeSessionMeta(sessionDir, {
        sessionId,
        workDir: parsed.cwd,
        created,
        ...(parsed.parent ? { parent: parsed.parent } : {}),
      });
      writeSessionState(sessionDir, {
        nextEventSeq: 1,
        nextStreamSeq: 1,
        config: {
          executionMode: state.config.executionMode,
          approvalMode: state.config.approvalMode,
          connectionId: effectiveConnectionId,
          modelId: effectiveModelId,
          maxBudgetUsd: state.config.maxBudgetUsd,
          maxThinkingTokens: state.config.maxThinkingTokens,
          ...(effectiveMcpServers ? { mcpServers: effectiveMcpServers } : {}),
          ...(effectiveToolScope ? { toolScope: effectiveToolScope } : {}),
          ...(runtimeBinding ? { runtimeBinding } : {}),
        },
      });
      ensureSessionFiles(sessionDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorPath = err instanceof SessionStorageError ? err.path : undefined;
      logger.error('session.new.storage_unavailable', {
        error: message,
        ...(errorPath ? { path: errorPath } : {}),
      });
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionStorageUnavailable',
        data: { category: 'session', reason: 'SessionStorageUnavailable', detail: message },
      };
    }

    state.activeSession = loadSession(sessionId);
    await ensureAlarmScheduler();
    await reconcileMcpServersForActiveSession(state);

    // Inject system prompt as context_injected event
    const persona = requestedPersona ?? 'lace';

    // Create skill registry for this session. Embedder-supplied skillDirs
    // (set during initialize) override the default workDir-based discovery.
    const skillDirs = state.skillDirs ?? getSkillDirectories(parsed.cwd);
    const skillRegistry = new SkillRegistry({ skillDirs });

    // Get available tools for system prompt context
    const { toolsForProvider } = await createToolExecutorForMode(
      state.config.executionMode,
      state.mcpServerManager,
      undefined, // jobManager
      skillRegistry,
      undefined, // toolScope
      state.personaRegistry
    );
    const tools = toolsForProvider.map((t) => ({ name: t.name, description: t.description }));

    // Create session context for working directory
    const sessionContext = { getWorkingDirectory: () => parsed.cwd };

    const promptConfig = await loadPromptConfig({
      persona,
      tools,
      session: sessionContext,
      skillRegistry,
      personaRegistry: state.personaRegistry,
    });
    let sessionState: SessionState = readSessionState(sessionDir);
    const { nextState } = appendDurableEvent(sessionDir, sessionState, {
      type: 'context_injected',
      data: { content: [{ type: 'text', text: promptConfig.systemPrompt }], priority: 'normal' },
    });
    sessionState = nextState;
    writeSessionState(sessionDir, sessionState);

    // Also inject user instructions if present
    if (promptConfig.userInstructions.trim()) {
      const { nextState: userInstrState } = appendDurableEvent(sessionDir, sessionState, {
        type: 'context_injected',
        data: {
          content: [{ type: 'text', text: promptConfig.userInstructions }],
          priority: 'normal',
        },
      });
      sessionState = userInstrState;
      writeSessionState(sessionDir, sessionState);
    }

    state.activeSession = { ...state.activeSession, state: sessionState };

    return {
      sessionId,
      created,
      configOptions: buildSessionConfigOptions(state.config, state.activeSession.state.config),
    };
  });

  peer.onRequest('session/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { cwd?: string; cursor?: string } | undefined;
    const cwdFilter = parsed?.cwd;
    // Note: cursor/pagination not yet implemented

    return { sessions: listSessions(cwdFilter) };
  });

  peer.onRequest('session/load', async (params: unknown) => {
    assertInitialized(state);

    const parsed = parseSessionRestoreParams(params);
    const loaded = await activateStoredSession(
      peer,
      state,
      parsed,
      runExclusive,
      reissuePendingPermissionRequests,
      ensureAlarmScheduler
    );
    const summary = summarizeDurableEvents(loaded.dir);
    return {
      sessionId: parsed.sessionId,
      messageCount: summary.messageCount,
      updatedAt: summary.lastActive ?? loaded.meta.created,
      configOptions: buildSessionConfigOptions(state.config, loaded.state.config),
    };
  });

  peer.onRequest('session/resume', async (params: unknown) => {
    assertInitialized(state);

    const parsed = parseSessionRestoreParams(params);
    await activateStoredSession(
      peer,
      state,
      parsed,
      runExclusive,
      reissuePendingPermissionRequests,
      ensureAlarmScheduler
    );
    return {};
  });

  peer.onRequest('session/fork', async (params: unknown) => {
    assertInitialized(state);

    const parsed = SessionForkParamsSchema.parse(params);

    // Load the source session
    let sourceSession;
    try {
      sourceSession = loadSession(parsed.sessionId);
    } catch (error) {
      if (error instanceof Error && error.message === 'Session not found') {
        throw {
          code: AcpErrorCodes.SessionNotFound,
          message: 'SessionNotFound',
          data: { category: 'session' },
        };
      }
      throw error;
    }

    // Create new forked session
    const forkedSessionId = `sess_${randomUUID()}`;
    const created = new Date().toISOString();
    const forkedCwd = parsed.cwd ?? sourceSession.meta.workDir;
    const runtimeBinding = buildDefaultLocalRuntimeBinding({
      sessionId: forkedSessionId,
      cwd: forkedCwd,
    });

    const forkedSessionDir = getSessionDir(forkedSessionId);
    writeSessionMeta(forkedSessionDir, { sessionId: forkedSessionId, workDir: forkedCwd, created });

    // Copy state from source session with optional MCP server overrides
    const forkedState: SessionState = {
      nextEventSeq: sourceSession.state.nextEventSeq,
      nextStreamSeq: sourceSession.state.nextStreamSeq,
      config: {
        ...sourceSession.state.config,
        runtimeBinding,
        ...(Array.isArray(sourceSession.state.config?.mcpServers)
          ? { mcpServers: defaultMcpServerPlacements(sourceSession.state.config.mcpServers) }
          : {}),
      },
    };

    // Apply MCP server overrides if provided
    if (parsed.mcpServers) {
      forkedState.config = forkedState.config ?? {};
      forkedState.config.mcpServers = defaultMcpServerPlacements(parsed.mcpServers);
    }

    writeSessionState(forkedSessionDir, forkedState);
    ensureSessionFiles(forkedSessionDir);

    // Copy all events from source session to forked session.
    // NOTE: readDurableEvents has a default limit of 100, so we must page until exhausted.
    const sourceEvents = [] as ReturnType<typeof readDurableEvents>['events'];
    let afterEventSeq = 0;
    while (true) {
      const page = readDurableEvents(sourceSession.dir, { afterEventSeq, limit: 1000 });
      sourceEvents.push(...page.events);
      if (!page.hasMore || page.events.length === 0) break;
      afterEventSeq = page.events[page.events.length - 1]!.eventSeq;
    }

    const forkedEventsPath = join(forkedSessionDir, 'events.jsonl');
    for (const event of sourceEvents) {
      appendFileSync(forkedEventsPath, JSON.stringify(event) + '\n', { encoding: 'utf8' });
    }

    // Return fork result with forkedFrom field
    const summary = summarizeDurableEvents(forkedSessionDir);
    return {
      sessionId: forkedSessionId,
      forkedFrom: parsed.sessionId,
      messageCount: summary.messageCount,
      updatedAt: summary.lastActive ?? created,
    };
  });

  peer.onRequest('session/close', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { sessionId?: unknown } | undefined;
    assertSessionIdParam(parsed?.sessionId);
    if (!state.activeSession || state.activeSession.meta.sessionId !== parsed.sessionId) {
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    }
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    abortActiveTurn(state);
    await releaseRunningSessionWork(peer, state, runExclusive);
    await state.mcpServerManager.shutdown();
    state.toolExecutorCache.clear();
    if (state.alarmScheduler) {
      await state.alarmScheduler.stop();
      state.alarmScheduler = undefined;
    }
    state.activeTurn = null;
    state.activeSession = null;

    return {};
  });

  peer.onRequest('session/cancel', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { sessionId?: unknown } | undefined;
    if (!parsed?.sessionId || typeof parsed.sessionId !== 'string') {
      return undefined;
    }
    if (state.activeSession?.meta.sessionId !== parsed.sessionId) {
      return undefined;
    }

    abortActiveTurn(state);
    await cancelPendingPermissionRequests(peer, state, runExclusive);
    abortRunningJobPermissionControllers(state);
    return undefined;
  });

  peer.onRequest('session/set_mode', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const parsed = params as { mode?: unknown } | undefined;
    const mode: 'plan' | 'execute' =
      parsed?.mode === 'plan'
        ? 'plan'
        : parsed?.mode === 'execute'
          ? 'execute'
          : throwInvalidParams('mode must be "plan" or "execute"');

    return await runExclusive(() => {
      if (!state.activeSession)
        throw {
          code: AcpErrorCodes.SessionNotFound,
          message: 'SessionNotFound',
          data: { category: 'session' },
        };

      const currentState = readSessionState(state.activeSession.dir);
      const currentConfig = currentState.config || {};
      const effectiveBefore = getEffectiveConfig(state.config, currentConfig);
      const previousMode =
        effectiveBefore.executionMode === 'plan' ? ('plan' as const) : ('execute' as const);

      const nextState = { ...currentState, config: { ...currentConfig, executionMode: mode } };
      writeSessionState(state.activeSession.dir, nextState);
      state.activeSession = { ...state.activeSession, state: nextState };
      state.config.executionMode = mode;

      return { mode, previousMode };
    });
  });
}
