import { randomUUID } from 'node:crypto';
import type { JsonRpcPeer } from '@lace/ent-protocol';
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
} from './storage/session-store.js';
import { appendDurableEvent, readDurableEvents } from './storage/event-log.js';

export type AgentServerState = {
  initialized: boolean;
  activeSession: LoadedSession | null;
};

export function createAgentServerState(): AgentServerState {
  return { initialized: false, activeSession: null };
}

export function registerAgentRpcMethods(peer: JsonRpcPeer, state: AgentServerState): void {
  peer.onRequest('initialize', async () => {
    state.initialized = true;
    return {
      protocolVersion: '1.0',
      agentInfo: { name: 'lace-agent', version: '0.1.0' },
      capabilities: {
        streaming: true,
        multiTurn: true,
        tools: [],
        'ent/contextInjection': false,
        'ent/backgroundJobs': false,
        'ent/fileCheckpointing': false,
        'ent/structuredOutput': false,
      },
    };
  });

  peer.onRequest('ent/agent/ping', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    return { ok: true, timestamp: new Date().toISOString() };
  });

  peer.onRequest('ent/agent/status', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    return {
      models: [],
      mcpServers: [],
      currentSession: state.activeSession
        ? {
            sessionId: state.activeSession.meta.sessionId,
            messageCount: 0,
            tokensUsed: 0,
            costUsd: 0,
          }
        : undefined,
      pendingPermissions: [],
      limits: {
        budgetUsedUsd: 0,
      },
    };
  });

  peer.onRequest('session/new', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { workDir: string; persona?: string; systemPrompt?: unknown };
    if (!parsed?.workDir) throw new Error('workDir is required');

    const sessionId = `sess_${randomUUID()}`;
    const created = new Date().toISOString();

    const sessionDir = getSessionDir(sessionId);
    writeSessionMeta(sessionDir, { sessionId, workDir: parsed.workDir, created });
    writeSessionState(sessionDir, { nextEventSeq: 1, nextStreamSeq: 1 });
    ensureSessionFiles(sessionDir);

    state.activeSession = loadSession(sessionId);

    return { sessionId, created };
  });

  peer.onRequest('session/list', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { workDir?: string } | undefined;
    const workDirFilter = parsed?.workDir;

    return { sessions: listSessions(workDirFilter) };
  });

  peer.onRequest('session/load', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');

    const parsed = params as { sessionId: string; fork?: boolean };
    if (!parsed?.sessionId) throw new Error('sessionId is required');
    if (parsed.fork) throw new Error('fork not implemented');

    const loaded = loadSession(parsed.sessionId);
    state.activeSession = loaded;
    return {
      sessionId: parsed.sessionId,
      messageCount: 0,
      lastActive: loaded.meta.created,
    };
  });

  peer.onRequest('ent/session/events', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw new Error('No active session');

    const parsed = params as
      | { afterEventSeq?: number; limit?: number; types?: string[] }
      | undefined;
    const result = readDurableEvents(state.activeSession.dir, {
      afterEventSeq: parsed?.afterEventSeq,
      limit: parsed?.limit,
      types: parsed?.types,
    });

    return result;
  });

  peer.onRequest('session/prompt', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw new Error('No active session');

    const parsed = params as { content: unknown[] };
    const turnId = `turn_${randomUUID()}`;

    let sessionState: SessionState = readSessionState(state.activeSession.dir);
    const writeAndAdvance = (event: {
      type: string;
      data: Record<string, unknown>;
      turnSeq: number;
    }) => {
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: event.type,
        data: event.data,
        turnId,
        turnSeq: event.turnSeq,
      });
      sessionState = nextState;
    };

    writeAndAdvance({ type: 'prompt', data: { content: parsed.content }, turnSeq: 0 });
    writeAndAdvance({ type: 'turn_start', data: {}, turnSeq: 1 });

    peer.notify('session/update', {
      sessionId: state.activeSession.meta.sessionId,
      streamSeq: sessionState.nextStreamSeq,
      turnId,
      turnSeq: 0,
      type: 'text_delta',
      text: 'hello',
    });
    sessionState = { ...sessionState, nextStreamSeq: sessionState.nextStreamSeq + 1 };

    writeAndAdvance({
      type: 'message',
      data: { content: [{ type: 'text', text: 'hello' }] },
      turnSeq: 2,
    });
    writeAndAdvance({ type: 'turn_end', data: { stopReason: 'end_turn' }, turnSeq: 3 });

    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);

    return {
      turnId,
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'hello' }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  });
}
