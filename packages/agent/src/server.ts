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
} from './storage/session-store';
import { appendDurableEvent, readDurableEvents } from './storage/event-log';
import type { PermissionRequest, SessionUpdate, ToolResult } from './protocol/types';
import { shellExecTool, runShellExec } from './tools/shell-exec';

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
  };
  activeTurn: null | {
    turnId: string;
    startedAt: string;
    status: 'running' | 'awaiting_permission';
    abortController: AbortController;
  };
};

export function createAgentServerState(): AgentServerState {
  return {
    initialized: false,
    activeSession: null,
    config: { executionMode: 'execute', approvalMode: 'ask' },
    activeTurn: null,
  };
}

export function registerAgentRpcMethods(peer: JsonRpcPeer, state: AgentServerState): void {
  peer.onRequest('initialize', async (params: unknown) => {
    const parsed = params as
      | {
          protocolVersion?: string;
          config?: { approvalMode?: string; executionMode?: string };
        }
      | undefined;

    state.initialized = true;
    if (parsed?.config?.executionMode === 'plan') state.config.executionMode = 'plan';
    if (parsed?.config?.executionMode === 'execute') state.config.executionMode = 'execute';

    const approvalMode = parsed?.config?.approvalMode;
    if (
      approvalMode === 'ask' ||
      approvalMode === 'approveReads' ||
      approvalMode === 'approveEdits' ||
      approvalMode === 'approve' ||
      approvalMode === 'deny' ||
      approvalMode === 'dangerouslySkipPermissions'
    ) {
      state.config.approvalMode = approvalMode;
    }

    return {
      protocolVersion: '1.0',
      agentInfo: { name: 'lace-agent', version: '0.1.0' },
      capabilities: {
        streaming: true,
        multiTurn: true,
        tools: [shellExecTool],
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

    const pendingPermissions: PermissionRequest[] = [];
    if (state.activeSession) {
      for (const pending of state.activeSession.state.pendingPermissions || []) {
        if (!pending.requestId) continue;
        pendingPermissions.push({
          requestId: pending.requestId,
          toolCallId: pending.toolCallId,
          sessionId: state.activeSession.meta.sessionId,
          turnId: pending.turnId,
          turnSeq: pending.turnSeq,
          jobId: pending.jobId,
          tool: pending.tool,
          kind: pending.kind,
          resource: pending.resource,
          options: pending.options,
          requestedAt: pending.requestedAt,
        });
      }
    }

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
      currentTurn: state.activeTurn
        ? {
            turnId: state.activeTurn.turnId,
            status: state.activeTurn.status,
            startedAt: state.activeTurn.startedAt,
          }
        : undefined,
      pendingPermissions,
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

  peer.onRequest('session/cancel', async (_params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) return undefined;

    if (state.activeTurn) {
      state.activeTurn.abortController.abort();
      return undefined;
    }

    const sessionState = readSessionState(state.activeSession.dir);
    sessionState.pendingPermissions = [];
    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    return undefined;
  });

  peer.onRequest('session/prompt', async (params: unknown) => {
    if (!state.initialized) throw new Error('Not initialized');
    if (!state.activeSession) throw new Error('No active session');

    const parsed = params as { content: unknown[] };
    const turnId = `turn_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    state.activeTurn = { turnId, startedAt, status: 'running', abortController };

    let sessionState: SessionState = readSessionState(state.activeSession.dir);
    let durableTurnSeq = 0;
    const writeAndAdvance = (event: { type: string; data: Record<string, unknown> }) => {
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: event.type,
        data: event.data,
        turnId,
        turnSeq: durableTurnSeq++,
      });
      sessionState = nextState;
    };

    writeAndAdvance({ type: 'prompt', data: { content: parsed.content } });
    writeAndAdvance({ type: 'turn_start', data: {} });

    const emitUpdate = (turnSeq: number, update: SessionUpdate) => {
      peer.notify('session/update', {
        sessionId: state.activeSession!.meta.sessionId,
        streamSeq: sessionState.nextStreamSeq,
        turnId,
        turnSeq,
        ...update,
      });
      sessionState = { ...sessionState, nextStreamSeq: sessionState.nextStreamSeq + 1 };
    };

    emitUpdate(0, { type: 'text_delta', text: 'hello' });

    if (abortController.signal.aborted) {
      writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

      writeSessionState(state.activeSession.dir, sessionState);
      state.activeSession = loadSession(state.activeSession.meta.sessionId);
      state.activeTurn = null;

      return {
        turnId,
        stopReason: 'cancelled',
        content: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const promptText = (parsed.content as any[])
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');

    const runMatch = promptText.match(/^\s*run:\s*(.+)\s*$/m);
    const command = runMatch?.[1]?.trim();

    if (command && state.config.executionMode === 'execute') {
      const toolCallId = `tool_${randomUUID()}`;
      const toolInput = { command } as Record<string, unknown>;
      let shouldExecuteTool = true;

      emitUpdate(1, {
        type: 'tool_use',
        toolCallId,
        name: shellExecTool.name,
        kind: shellExecTool.kind,
        input: toolInput,
        status: 'pending',
      });

      const requiresPermission =
        shellExecTool.requiresPermission &&
        state.config.approvalMode !== 'approve' &&
        state.config.approvalMode !== 'dangerouslySkipPermissions' &&
        state.config.approvalMode !== 'deny';

      if (state.config.approvalMode === 'deny') {
        const denied: ToolResult = {
          outcome: 'denied',
          content: [{ type: 'error', message: 'Denied by policy' }],
        };

        shouldExecuteTool = false;
        emitUpdate(1, {
          type: 'tool_use',
          toolCallId,
          name: shellExecTool.name,
          kind: shellExecTool.kind,
          input: toolInput,
          status: 'denied',
          result: denied,
        });

        writeAndAdvance({
          type: 'tool_use',
          data: {
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: toolInput,
            result: denied,
          },
        });
      } else {
        let finalInput = toolInput;

        if (requiresPermission) {
          state.activeTurn = { turnId, startedAt, status: 'awaiting_permission', abortController };

          const options = [
            { optionId: 'allow', label: 'Allow' },
            { optionId: 'deny', label: 'Deny' },
          ];

          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: toolInput,
            status: 'awaiting_permission',
          });

          type PendingPermission = NonNullable<SessionState['pendingPermissions']>[number];
          const pending: PendingPermission = {
            toolCallId,
            turnId,
            turnSeq: 1,
            tool: shellExecTool.name,
            kind: shellExecTool.kind,
            resource: command,
            options,
            requestedAt: new Date().toISOString(),
            input: toolInput,
          };

          sessionState.pendingPermissions = [...(sessionState.pendingPermissions || []), pending];
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };

          const { requestId, result } = peer.requestWithId('session/request_permission', {
            sessionId: state.activeSession.meta.sessionId,
            turnId,
            turnSeq: 1,
            toolCallId,
            tool: shellExecTool.name,
            kind: shellExecTool.kind,
            resource: command,
            options,
          });

          pending.requestId = String(requestId);
          sessionState.pendingPermissions = (sessionState.pendingPermissions || []).map((p) =>
            p.toolCallId === toolCallId ? pending : p
          );
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };

          const abortPromise = new Promise<never>((_, reject) => {
            abortController.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            });
          });

          let permissionResponse: any;
          try {
            permissionResponse = await Promise.race([result, abortPromise]);
          } catch {
            peer.abandonRequest(requestId);

            sessionState.pendingPermissions = (sessionState.pendingPermissions || []).filter(
              (p) => p.toolCallId !== toolCallId
            );
            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = { ...state.activeSession, state: sessionState };

            const cancelled: ToolResult = {
              outcome: 'cancelled',
              content: [{ type: 'error', message: 'Cancelled' }],
            };

            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: toolInput,
              status: 'cancelled',
              result: cancelled,
            });

            writeAndAdvance({
              type: 'tool_use',
              data: {
                toolCallId,
                name: shellExecTool.name,
                kind: shellExecTool.kind,
                input: toolInput,
                result: cancelled,
              },
            });
            writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
            state.activeTurn = null;

            return {
              turnId,
              stopReason: 'cancelled',
              content: [],
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }

          sessionState.pendingPermissions = (sessionState.pendingPermissions || []).filter(
            (p) => p.toolCallId !== toolCallId
          );
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };
          state.activeTurn = { turnId, startedAt, status: 'running', abortController };

          const decision = permissionResponse?.decision;
          if (decision === 'deny') {
            const denied: ToolResult = {
              outcome: 'denied',
              content: [{ type: 'error', message: 'Denied' }],
            };

            shouldExecuteTool = false;
            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: toolInput,
              status: 'denied',
              result: denied,
            });

            writeAndAdvance({
              type: 'tool_use',
              data: {
                toolCallId,
                name: shellExecTool.name,
                kind: shellExecTool.kind,
                input: toolInput,
                result: denied,
              },
            });
          } else {
            if (
              permissionResponse?.updatedInput &&
              typeof permissionResponse.updatedInput === 'object'
            ) {
              finalInput = permissionResponse.updatedInput as Record<string, unknown>;
            }

            emitUpdate(1, {
              type: 'tool_use',
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: finalInput,
              status: 'running',
            });
          }
        } else {
          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: finalInput,
            status: 'running',
          });
        }

        if (shouldExecuteTool && !abortController.signal.aborted) {
          const commandToRun = String((finalInput as any).command || '');
          const result = await runShellExec(
            { command: commandToRun },
            { defaultCwd: state.activeSession.meta.workDir, signal: abortController.signal }
          );

          emitUpdate(1, {
            type: 'tool_use',
            toolCallId,
            name: shellExecTool.name,
            kind: shellExecTool.kind,
            input: finalInput,
            status: result.outcome,
            result,
          });

          writeAndAdvance({
            type: 'tool_use',
            data: {
              toolCallId,
              name: shellExecTool.name,
              kind: shellExecTool.kind,
              input: finalInput,
              result,
            },
          });

          if (result.outcome === 'cancelled') {
            writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });

            writeSessionState(state.activeSession.dir, sessionState);
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
            state.activeTurn = null;

            return {
              turnId,
              stopReason: 'cancelled',
              content: [],
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
        }
      }
    }

    writeAndAdvance({
      type: 'message',
      data: { content: [{ type: 'text', text: 'hello' }] },
    });
    writeAndAdvance({ type: 'turn_end', data: { stopReason: 'end_turn' } });

    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
    state.activeTurn = null;

    return {
      turnId,
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'hello' }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  });
}
