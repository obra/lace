// ABOUTME: Session lifecycle RPC handlers for creating, loading, and managing sessions

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AcpErrorCodes,
  SessionForkParamsSchema,
  isSessionId,
  type JsonRpcPeer,
} from '@lace/ent-protocol';
import {
  ensureSessionFiles,
  getSessionDir,
  listSessions,
  loadSession,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
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

/**
 * Register session lifecycle handlers with the peer.
 * - session/new: Create a new session
 * - session/list: List all available sessions
 * - session/load: Load an existing session
 * - session/fork: Create a fork of an existing session
 * - $/cancel_request: Cancel active operations
 * - session/set_mode: Change execution mode (plan/execute)
 */
export function registerSessionHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  createToolExecutorForMode: CreateToolExecutorFn,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  reissuePendingPermissionRequests: () => Promise<void>
): void {
  peer.onRequest('session/new', async (params: unknown) => {
    assertInitialized(state);
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    // Kill all running jobs before switching sessions
    await killAllRunningJobs(state.jobManager.getRunningJobs());
    state.pendingPermissionRequests.clear();
    state.jobManager.clearJobs();

    const parsed = params as {
      workDir: string;
      persona?: string;
      systemPrompt?: unknown;
      config?: {
        connectionId?: string;
        modelId?: string;
        persona?: string;
        mcpServers?: Array<{
          name: string;
          command: string;
          args?: string[];
          env?: Record<string, string>;
          transport?: 'stdio' | 'sse' | 'http';
          enabled?: boolean;
          tools?: Record<string, 'allow' | 'ask' | 'deny' | 'disable'>;
        }>;
      };
    };
    if (!parsed?.workDir) throwInvalidParams('workDir is required');

    // Persona may arrive top-level (subagent/delegate path) or nested under config.
    const requestedPersona =
      toNonEmptyString(parsed.config?.persona) ?? toNonEmptyString(parsed.persona);

    // Parse persona frontmatter before any storage writes so we fail fast on invalid input.
    let personaDefaults: {
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
        if (personaConfig.tools) personaDefaults.toolScope = [...personaConfig.tools];
        if (personaConfig.mcpServers) {
          personaDefaults.mcpServers = Object.entries(personaConfig.mcpServers).map(
            ([name, spec]) => ({
              name,
              command: spec.command,
              ...(spec.args ? { args: spec.args } : {}),
              ...(spec.env ? { env: spec.env } : {}),
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
    const effectiveMcpServers = parsed.config?.mcpServers ?? personaDefaults.mcpServers;
    const effectiveToolScope = personaDefaults.toolScope;

    const sessionId = `sess_${randomUUID()}`;
    const created = new Date().toISOString();

    let sessionDir: string;
    try {
      sessionDir = getSessionDir(sessionId);
      writeSessionMeta(sessionDir, { sessionId, workDir: parsed.workDir, created });
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
    await reconcileMcpServersForActiveSession(state);

    // Inject system prompt as context_injected event
    const persona = requestedPersona ?? 'lace';

    // Create skill registry for this session's working directory
    const skillDirs = getSkillDirectories(parsed.workDir);
    const skillRegistry = new SkillRegistry({ skillDirs });

    // Get available tools for system prompt context
    const { toolsForProvider } = await createToolExecutorForMode(
      state.config.executionMode,
      state.mcpServerManager,
      undefined, // jobManager
      skillRegistry
    );
    const tools = toolsForProvider.map((t) => ({ name: t.name, description: t.description }));

    // Create session context for working directory
    const sessionContext = { getWorkingDirectory: () => parsed.workDir };

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

    return { sessionId, created };
  });

  // ACP-aligned: cwd instead of workDir
  peer.onRequest('session/list', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { cwd?: string; cursor?: string } | undefined;
    const cwdFilter = parsed?.cwd;
    // Note: cursor/pagination not yet implemented

    return { sessions: listSessions(cwdFilter) };
  });

  peer.onRequest('session/load', async (params: unknown) => {
    assertInitialized(state);

    const parsed = params as { sessionId: string };
    if (!parsed?.sessionId) throwInvalidParams('sessionId is required');
    if (!isSessionId(parsed.sessionId)) {
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };
    }

    if (state.activeTurn) {
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };
    }

    const switchingSessions =
      state.activeSession && state.activeSession.meta.sessionId !== parsed.sessionId;
    if (switchingSessions) {
      // Kill all running jobs before switching sessions
      await killAllRunningJobs(state.jobManager.getRunningJobs());
      state.pendingPermissionRequests.clear();
      state.jobManager.clearJobs();
    }

    let loaded;
    try {
      loaded = loadSession(parsed.sessionId);
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
    state.activeSession = loaded;
    await reconcileMcpServersForActiveSession(state);
    await reissuePendingPermissionRequests();
    const summary = summarizeDurableEvents(loaded.dir);
    // ACP-aligned: lastActive renamed to updatedAt
    return {
      sessionId: parsed.sessionId,
      messageCount: summary.messageCount,
      updatedAt: summary.lastActive ?? loaded.meta.created,
    };
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

    const forkedSessionDir = getSessionDir(forkedSessionId);
    writeSessionMeta(forkedSessionDir, { sessionId: forkedSessionId, workDir: forkedCwd, created });

    // Copy state from source session with optional MCP server overrides
    const forkedState: SessionState = {
      nextEventSeq: sourceSession.state.nextEventSeq,
      nextStreamSeq: sourceSession.state.nextStreamSeq,
      config: {
        ...sourceSession.state.config,
      },
    };

    // Apply MCP server overrides if provided
    if (parsed.mcpServers) {
      forkedState.config = forkedState.config ?? {};
      forkedState.config.mcpServers = parsed.mcpServers;
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

  peer.onRequest('$/cancel_request', async (_params: unknown) => {
    assertInitialized(state);

    // Auto-cascade: send $/cancel_request for all pending permission requests
    for (const [, permission] of state.pendingPermissionRequests) {
      peer.notify('$/cancel_request', { requestId: permission.rpcId });
    }

    // Abort the active turn if one is running
    if (state.activeTurn) {
      state.activeTurn.abortController.abort();
    }

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
