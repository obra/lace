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
import {
  appendDurableEvent,
  readDurableEvents,
  summarizeDurableEvents,
} from '../../storage/event-log';
import type { AgentServerState } from '../../server-types';
import {
  assertInitialized,
  throwInvalidParams,
  toNonEmptyString,
} from '../utils';
import { loadPromptConfig } from '../../config/prompts';
import { logger } from '../../utils/logger';
import { reconcileMcpServersForActiveSession } from './mcp-servers';

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
  createToolExecutorForMode: (
    mode: 'plan' | 'execute',
    mcpServerManager?: any
  ) => { toolsForProvider: any[] },
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
    for (const job of state.jobs.values()) {
      if (job.status === 'running') {
        job.status = 'cancelled';
        if (job.proc) {
          try {
            if (process.platform !== 'win32' && typeof job.proc.pid === 'number') {
              process.kill(-job.proc.pid, 'SIGTERM');
            } else {
              job.proc.kill('SIGTERM');
            }
          } catch (error) {
            logger.debug('session.new.job_kill.failed', {
              jobId: job.jobId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        job.permissionAbortController?.abort();
      }
    }

    // Wait briefly for processes to terminate
    await Promise.all(
      [...state.jobs.values()]
        .filter((job) => job.proc && job.proc.exitCode === null)
        .map((job) =>
          Promise.race([job.completion, new Promise<void>((resolve) => setTimeout(resolve, 500))])
        )
    );

    state.pendingPermissionRequests.clear();
    state.jobs.clear();

    const parsed = params as { workDir: string; persona?: string; systemPrompt?: unknown };
    if (!parsed?.workDir) throwInvalidParams('workDir is required');

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
          connectionId: state.config.connectionId,
          modelId: state.config.modelId,
          maxBudgetUsd: state.config.maxBudgetUsd,
          maxThinkingTokens: state.config.maxThinkingTokens,
        },
      });
      ensureSessionFiles(sessionDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('session.new.storage_unavailable', {
        error: message,
        ...((err as any)?.path ? { path: (err as any).path } : {}),
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
    const persona = toNonEmptyString(parsed.persona) ?? 'lace';

    // Get available tools for system prompt context
    const { toolsForProvider } = createToolExecutorForMode(
      state.config.executionMode,
      state.mcpServerManager
    );
    const tools = toolsForProvider.map((t) => ({ name: t.name, description: t.description }));

    // Create session context for working directory
    const sessionContext = { getWorkingDirectory: () => parsed.workDir };

    const promptConfig = await loadPromptConfig({ persona, tools, session: sessionContext });
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
      for (const job of state.jobs.values()) {
        if (job.status === 'running') {
          job.status = 'cancelled';
          if (job.proc) {
            try {
              if (process.platform !== 'win32' && typeof job.proc.pid === 'number') {
                process.kill(-job.proc.pid, 'SIGTERM');
              } else {
                job.proc.kill('SIGTERM');
              }
            } catch (error) {
              logger.debug('session.load.job_kill.failed', {
                jobId: job.jobId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          job.permissionAbortController?.abort();
        }
      }

      // Wait briefly for processes to terminate
      await Promise.all(
        [...state.jobs.values()]
          .filter((job) => job.proc && job.proc.exitCode === null)
          .map((job) =>
            Promise.race([job.completion, new Promise<void>((resolve) => setTimeout(resolve, 500))])
          )
      );

      state.pendingPermissionRequests.clear();
      state.jobs.clear();
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

    // Copy all events from source session to forked session
    const { events: sourceEvents } = readDurableEvents(sourceSession.dir, {});
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
      const effectiveBefore = { ...state.config, ...currentConfig };
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
