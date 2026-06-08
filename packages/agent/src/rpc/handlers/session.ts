// ABOUTME: Session lifecycle RPC handlers for creating, loading, and managing sessions

import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getLaceDir } from '../../config/lace-dir';
import { resolveMcpServerPaths } from '../../config/mcp-path-resolution';
import {
  SECURE_DIR_MODE,
  SECURE_FILE_MODE,
  transcriptFilePath,
  validatePersonaName,
} from '../../storage/transcript-paths';
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
import { eventToRow } from '../../storage/recall/event-to-row';
import { getRecallIndex } from '../../storage/recall/index-db';
import { insertRow } from '../../storage/recall/index-writer';
import type { TypedDurableEvent } from '../../storage/event-types';
import type { AgentServerState, CreateToolExecutorFn } from '../../server-types';
import { assertInitialized, throwInvalidParams, toNonEmptyString } from '../utils';
import { loadPromptConfig } from '../../config/prompts';
import { logger } from '../../utils/logger';
import { reconcileMcpServersForActiveSession } from './mcp-servers';
import { SkillRegistry, getSkillDirectories } from '../../skills';
import { composeSkillDirs } from '../../skills/compose-skill-dirs';
import { getAgentSkillsDir } from '../../skills/agent-skills-dir';
import { killAllRunningJobs } from '../../jobs';
import { getEffectiveConfig } from '@lace/agent/core/session';
import { PersonaNotFoundError, PersonaParseError } from '../../config/persona-registry';
import {
  applyEmbedderMcpServers,
  buildSessionConfigOptions,
  defaultMcpServerPlacements,
  mergeMcpServers,
  tagMcpServers,
} from '../session-config';
import { cancelPendingPermissionRequests } from '../permissions';
import {
  buildDefaultBoundedHostRuntimeBinding,
  parseRuntimeExecutionBinding,
} from '../../tools/runtime/validation';
import type { RuntimeExecutionBinding } from '../../tools/runtime/types';
import { buildPersonaProjectedRuntimeBinding } from '../../jobs/persona-projected-binding';
import { assertCompactionStrategyRegistered } from '../../compaction/strategy';
import { compactionStrategyNameForSession } from '../../compaction/select';

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
  return runtimeBinding;
}

/**
 * Resolve a container RuntimeExecutionBinding for the MAIN session from its
 * persona's declared environment. Mirrors delegate.ts's proven resolution path:
 * parsePersona → if runtime.type==='container', parseEnvironment(name).runtime →
 * buildPersonaProjectedRuntimeBinding. The persona's environment is PERSISTENT
 * for a main session, so childSessionId/scratchDirHostPath (per_invocation only)
 * are not passed.
 *
 * Returns undefined for a non-container (root/host) persona, or when persona /
 * environment resolution fails — the caller then falls back to a host binding.
 * Resolution failure must not crash session creation, so errors are logged and
 * swallowed; a VALID container persona produces a container binding.
 */
function resolvePersonaContainerBinding(
  state: AgentServerState,
  sessionId: string,
  personaName: string
): RuntimeExecutionBinding | undefined {
  try {
    const personaRuntime = state.personaRegistry.parsePersona(personaName).config.runtime;
    if (personaRuntime.type !== 'container') return undefined;
    const envRuntime = state.environmentRegistry.parseEnvironment(
      personaRuntime.environment
    ).runtime;
    return buildPersonaProjectedRuntimeBinding({
      parentSessionId: sessionId,
      personaName,
      environmentName: personaRuntime.environment,
      runtime: envRuntime,
      containerMounts: state.containerMounts ?? {},
    });
  } catch (error) {
    logger.warn('session.persona_container_binding_failed', {
      sessionId,
      persona: personaName,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
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
      mcpServers: applyEmbedderMcpServers(currentConfig.mcpServers, mcpServers),
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

  // Reclaim the closing session's per_invocation child workspaces. killAllRunningJobs
  // above killed the subagent PROCESSES; the CONTAINER teardown happens inside dispose
  // (which awaits containerManager.destroy) before each /work is removed.
  const closingSessionId = state.activeSession?.meta.sessionId;
  if (closingSessionId) {
    await state.workspaceReaper.releaseAllForParent(closingSessionId);
  }
}

async function activateStoredSession(
  peer: JsonRpcPeer,
  state: AgentServerState,
  params: SessionRestoreParams,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  reissuePendingPermissionRequests: () => Promise<void>,
  ensureSchedulers: () => Promise<void>
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
    // Cold session-open path: ask loadSession to scan for and synthesize
    // turn_end events for any orphan turn_starts left by a prior process
    // (SIGKILL, OOM, container restart). All other loadSession call sites
    // are mid-flight refreshes that must NOT repair.
    loaded = loadSession(params.sessionId, { repairOrphanTurnStarts: true });
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

  const persistedRuntimeBinding =
    loaded.state.config?.runtimeBinding !== undefined
      ? parseSessionRuntimeBinding(loaded.state.config.runtimeBinding)
      : undefined;
  // Safety net: a session/new from before this change (or a session whose
  // persisted binding was dropped) may lack a container binding even though its
  // persona declares a container environment. Re-resolve from the persona so a
  // resumed boxed coworker still runs in its box. Normally the persisted binding
  // already carries the container binding, so this only fires as a fallback.
  const personaName = loaded.state.config?.personaName ?? loaded.meta.persona;
  const personaContainerBinding =
    personaName !== undefined
      ? resolvePersonaContainerBinding(state, params.sessionId, personaName)
      : undefined;
  const activeRuntimeBinding =
    params.runtimeBinding ??
    persistedRuntimeBinding ??
    personaContainerBinding ??
    buildDefaultBoundedHostRuntimeBinding({
      sessionId: params.sessionId,
      cwd: loaded.meta.workDir,
    });

  const loadedWithMcpServers = mergeMcpServersIntoLoadedSession(
    loaded,
    // Resolve relative host-placement command/args against mcpBaseDir before
    // applying embedder servers (same as session/new).
    resolveMcpServerPaths(params.mcpServers, state.personaRegistry.getMcpBaseDir()),
    activeRuntimeBinding
  );
  const switchingSessions =
    state.activeSession && state.activeSession.meta.sessionId !== params.sessionId;

  writeSessionState(loadedWithMcpServers.dir, loadedWithMcpServers.state);

  // Fail fast if the persona stored in this session selects a compaction strategy
  // whose plugin isn't loaded. Surfaces misconfiguration at session-open time rather
  // than hours later at the first compaction.
  assertCompactionStrategyRegistered(compactionStrategyNameForSession(loadedWithMcpServers.dir));

  if (switchingSessions) {
    await releaseRunningSessionWork(peer, state, runExclusive);
  }

  state.activeSession = loadedWithMcpServers;
  rehydrateServerConfigFromSession(state, state.activeSession.state);
  await ensureSchedulers();

  await reconcileMcpServersForActiveSession(state);
  await reissuePendingPermissionRequests();
  return state.activeSession;
}

/**
 * Render the session's system prompt via loadPromptConfig and append a
 * system_prompt_set event to the session's durable event log. Shared by
 * session/new (RPC), session/fork (cwd-change re-render), and the /clear
 * slash command — every code path that creates a session that the runner
 * will later prompt must satisfy the system_prompt_set invariant
 * (runner.ts throws on empty frozenSystemPrompt).
 *
 * Returns the updated session state with the new event appended. Callers
 * are responsible for writing the returned state to disk.
 */
export async function composeAndWriteSystemPromptSet(params: {
  sessionDir: string;
  sessionState: SessionState;
  persona: string;
  cwd: string;
  state: AgentServerState;
  createToolExecutorForMode: CreateToolExecutorFn;
}): Promise<SessionState> {
  const { sessionDir, sessionState, persona, cwd, state, createToolExecutorForMode } = params;

  const skillDirs = composeSkillDirs(
    { skillDirs: state.skillDirs ?? getSkillDirectories(cwd) },
    state.personaRegistry.personaSkillsDir(persona),
    { coreDir: getAgentSkillsDir() }
  );
  const skillRegistry = new SkillRegistry({ skillDirs });

  const { toolsForProvider } = await createToolExecutorForMode(
    state.config.executionMode,
    state.mcpServerManager,
    undefined, // jobManager
    skillRegistry,
    undefined, // toolScope
    state.personaRegistry,
    persona,
    state.environmentRegistry
  );
  const tools = toolsForProvider.map((t) => ({ name: t.name, description: t.description }));

  const promptConfig = await loadPromptConfig({
    persona,
    tools,
    session: { getWorkingDirectory: () => cwd },
    skillRegistry,
    personaRegistry: state.personaRegistry,
  });

  const fullSystemPrompt = promptConfig.userInstructions.trim()
    ? `${promptConfig.systemPrompt}\n\n${promptConfig.userInstructions}`
    : promptConfig.systemPrompt;

  const { nextState } = appendDurableEvent(sessionDir, sessionState, {
    type: 'system_prompt_set',
    data: { type: 'system_prompt_set', text: fullSystemPrompt },
  });
  return nextState;
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
  ensureSchedulers: () => Promise<void>
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
      // Host-preallocated session id. When present and valid, used instead of
      // minting a fresh id. Must be a valid sess_<uuid> format and must not
      // collide with an existing session on disk.
      sessionId?: unknown;
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

    // Validate and apply host-preallocated sessionId when present.
    if (parsed.sessionId !== undefined) {
      if (typeof parsed.sessionId !== 'string' || !isSessionId(parsed.sessionId)) {
        throw {
          code: -32602,
          message: 'InvalidParams',
          data: { category: 'protocol', reason: 'sessionId must be sess_<uuid> format' },
        };
      }
      // Defensive: reject if the session already exists on disk to prevent
      // accidental re-use of an id the host was supposed to mint fresh.
      const candidateDir = getSessionDir(parsed.sessionId);
      const metaPath = join(candidateDir, 'meta.json');
      if (existsSync(metaPath)) {
        throw {
          code: -32602,
          message: 'InvalidParams',
          data: {
            category: 'protocol',
            reason: 'sessionId already exists on disk — host must supply a fresh id',
          },
        };
      }
    }
    const runtimeBinding =
      parsed.config?.runtimeBinding !== undefined
        ? parseSessionRuntimeBinding(parsed.config.runtimeBinding)
        : undefined;

    // Persona may arrive top-level (subagent/delegate path) or nested under config.
    // Validate the RAW string value BEFORE any trimming/coercion so we can't
    // silently accept "  ada  " (whitespace stripped to "ada") or drop "   "
    // (whitespace-only collapses to null and looks like "no persona"). The
    // validator rejects leading/trailing whitespace and all-whitespace, so
    // running it on the raw input surfaces both as PersonaInvalid RPC errors.
    const rawPersona = parsed.config?.persona ?? parsed.persona;
    if (typeof rawPersona === 'string') {
      try {
        validatePersonaName(rawPersona);
      } catch (err) {
        throw {
          code: -32602,
          message: err instanceof Error ? err.message : String(err),
          data: { category: 'protocol', reason: 'PersonaInvalid' },
        };
      }
    }

    // Only after raw validation passes do we trim/coerce for downstream use.
    // validatePersonaName already rejected the only shapes where trimming
    // would change meaning (leading/trailing whitespace, all-whitespace), so
    // toNonEmptyString is now a no-op coercion that just narrows the type to
    // string | null.
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
          // Persona `tools:` is the COMPLETE allowlist (Claude Code semantics):
          // present = exactly these tools (no implicit builtins); omitted =
          // inherit all; `[]` = zero tools. Personas that need a builtin must
          // list it explicitly. (This replaced the earlier additive union;
          // the migration re-audited every persona that declares tools: so none
          // silently lose a builtin they rely on.)
          personaDefaults.toolScope = [...personaConfig.tools];
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
        // Fail fast if the persona selects a compaction strategy whose plugin isn't loaded.
        // This surfaces the misconfiguration at session-open time rather than hours later
        // at the first compaction.
        assertCompactionStrategyRegistered(personaConfig.compaction?.strategy);
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
        ? mergeMcpServers(
            personaDefaults.mcpServers,
            // Resolve relative host-placement command/args in the embedder's
            // request servers against mcpBaseDir (persona defaults are already
            // resolved by parsePersona). Resolve BEFORE merge so the
            // stdio→toolRuntime placement default does not skip them.
            resolveMcpServerPaths(parsed.mcpServers, state.personaRegistry.getMcpBaseDir())
          )
        : personaDefaults.mcpServers
          ? defaultMcpServerPlacements(personaDefaults.mcpServers)
          : undefined;
    // Both persona-defaults and request-level entries come from the embedder.
    const effectiveStoredMcpServers = effectiveMcpServers
      ? tagMcpServers(effectiveMcpServers, 'embedder')
      : undefined;
    const effectiveToolScope = personaDefaults.toolScope;

    const sessionId =
      typeof parsed.sessionId === 'string' && isSessionId(parsed.sessionId)
        ? parsed.sessionId
        : `sess_${randomUUID()}`;
    const created = new Date().toISOString();
    // When the embedder did not supply an explicit binding and the session has
    // a persona whose runtime declares a container environment, materialize the
    // container binding here so the MAIN coworker session runs in its box (not
    // the host). Falls back to a host binding for root personas or on resolution
    // failure.
    const resolvedRuntimeBinding =
      runtimeBinding ??
      (requestedPersona
        ? resolvePersonaContainerBinding(state, sessionId, requestedPersona)
        : undefined);
    const activeRuntimeBinding =
      resolvedRuntimeBinding ??
      buildDefaultBoundedHostRuntimeBinding({
        sessionId,
        cwd: parsed.cwd,
      });

    let sessionDir: string;
    try {
      sessionDir = getSessionDir(sessionId);
      writeSessionMeta(sessionDir, {
        sessionId,
        workDir: parsed.cwd,
        created,
        ...(requestedPersona ? { persona: requestedPersona } : {}),
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
          ...(effectiveStoredMcpServers ? { mcpServers: effectiveStoredMcpServers } : {}),
          ...(effectiveToolScope ? { toolScope: effectiveToolScope } : {}),
          runtimeBinding: activeRuntimeBinding,
          personaName: requestedPersona ?? 'lace',
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
    await ensureSchedulers();
    await reconcileMcpServersForActiveSession(state);

    // Inject system prompt as system_prompt_set event. Every session that the
    // runner will prompt must have this event — runner throws on empty
    // frozenSystemPrompt. Use the shared helper so all creation paths agree.
    const persona = requestedPersona ?? 'lace';
    const sessionState = await composeAndWriteSystemPromptSet({
      sessionDir,
      sessionState: readSessionState(sessionDir),
      persona,
      cwd: parsed.cwd,
      state,
      createToolExecutorForMode,
    });
    writeSessionState(sessionDir, sessionState);

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
      ensureSchedulers
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
      ensureSchedulers
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
    const runtimeBinding = buildDefaultBoundedHostRuntimeBinding({
      sessionId: forkedSessionId,
      cwd: forkedCwd,
    });

    // Validate the inherited persona before writing meta.json. A legacy source
    // session may have a shape-invalid persona; we refuse to propagate it into
    // a freshly created session (the spec amendment requires meta.persona to
    // pass validatePersonaName at write time).
    if (sourceSession.meta.persona !== undefined) {
      try {
        validatePersonaName(sourceSession.meta.persona);
      } catch (err) {
        throw {
          code: -32602,
          message: err instanceof Error ? err.message : String(err),
          data: { category: 'protocol', reason: 'PersonaInvalid' },
        };
      }
    }

    const forkedSessionDir = getSessionDir(forkedSessionId);
    writeSessionMeta(forkedSessionDir, {
      sessionId: forkedSessionId,
      workDir: forkedCwd,
      created,
      ...(sourceSession.meta.persona ? { persona: sourceSession.meta.persona } : {}),
    });

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

    // Apply MCP server overrides if provided. Caller is the embedder, so tag
    // the new entries as 'embedder'-owned. Any 'user'-source entries from the
    // source session are discarded when an override is supplied (no merge):
    // a fork with explicit mcpServers is requesting a fresh embedder set.
    if (parsed.mcpServers) {
      forkedState.config = forkedState.config ?? {};
      forkedState.config.mcpServers = tagMcpServers(
        defaultMcpServerPlacements(parsed.mcpServers),
        'embedder'
      );
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

    // When cwd changes, we'll re-render and write a fresh system_prompt_set
    // below. Pre-compute the flag so we can skip the source's copy in the loop,
    // keeping the forked session at exactly one system_prompt_set event and
    // preventing message-builder's "invariant violation" warn on every rebuild.
    const willRerenderSystemPrompt = forkedCwd !== sourceSession.meta.workDir;

    // Write copied events under today's transcript path for the forked
    // session. Each event preserves its original eventSeq/timestamp, so the
    // forked session's transcript reads as a chronological replay of the
    // parent.
    const forkedPersona = sourceSession.meta.persona ?? null;
    const forkedEventsPath = transcriptFilePath({
      laceDir: getLaceDir(),
      persona: forkedPersona,
      date: new Date(),
      sessionId: forkedSessionId,
    });
    // Match the secure-mode pattern from appendDurableEvent: forked
    // transcript dirs are 0o700 and forked transcript files are 0o600.
    // Otherwise fork lands events at the system defaults (0o755 / 0o644),
    // making forked sessions world-readable even though the durable-event
    // hot path enforces the tighter modes.
    mkdirSync(dirname(forkedEventsPath), { recursive: true, mode: SECURE_DIR_MODE });
    for (const event of sourceEvents) {
      // Skip copying the source's system_prompt_set when we'll re-render it for
      // the new cwd — the re-rendered event written below will be the sole one.
      if (willRerenderSystemPrompt && event.type === 'system_prompt_set') continue;
      appendFileSync(forkedEventsPath, JSON.stringify(event) + '\n', { encoding: 'utf8' });

      // chmod once per write to converge on SECURE_FILE_MODE even if the
      // file pre-existed at a looser mode (mirrors appendDurableEvent's
      // stat-check-then-chmod pattern, minus the cost-saving stat — fork
      // is one-shot per session creation so the extra syscall is fine).
      try {
        const stat = statSync(forkedEventsPath);
        if ((stat.mode & 0o777) !== SECURE_FILE_MODE) {
          chmodSync(forkedEventsPath, SECURE_FILE_MODE);
        }
      } catch {
        // appendFileSync above would have already failed if the file is
        // unreadable; ignore so a transient stat error doesn't break fork.
      }

      // Write-through indexing: mirror copied events into the FTS index under
      // the forked sessionId so /recall queries find them immediately, without
      // waiting for the next process restart to re-scan via backfill. Failures
      // here must never break fork — JSONL is source of truth and the backfill
      // pass on next startup will repair anything the index missed. Matches
      // the pattern in `appendDurableEvent` (storage/event-log.ts).
      try {
        const row = eventToRow(event as TypedDurableEvent, {
          sessionId: forkedSessionId,
          persona: forkedPersona,
        });
        if (row) insertRow(getRecallIndex(), row);
      } catch (err) {
        console.error('recall indexer write failed during session/fork:', err);
      }
    }

    // If the fork uses a different cwd, the source's system_prompt_set event
    // (which embedded the source cwd) was skipped above. Write a fresh one
    // rendered with the new cwd so the forked session has exactly one.
    if (willRerenderSystemPrompt) {
      // Preserve the source session's persona; fall back to 'lace' only if the
      // source has none recorded (corrupt session or non-persona creation path).
      const sourcePersona = sourceSession.state.config?.personaName ?? 'lace';
      const forkedSessionState = await composeAndWriteSystemPromptSet({
        sessionDir: forkedSessionDir,
        sessionState: readSessionState(forkedSessionDir),
        persona: sourcePersona,
        cwd: forkedCwd,
        state,
        createToolExecutorForMode,
      });
      writeSessionState(forkedSessionDir, forkedSessionState);
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
    if (state.reminderScheduler) {
      await state.reminderScheduler.stop();
      state.reminderScheduler = undefined;
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
