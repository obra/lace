// ABOUTME: Permission request handling for tool execution approvals

import { JSONRPC_ERROR_CANCELLED, type JsonRpcPeer } from '@lace/ent-protocol';
import { appendDurableEvent } from '../storage/event-log';
import { readSessionState, writeSessionState, loadSession } from '../storage/session-store';
import {
  derivePendingPermissionsFromDurableEvents,
  type PendingPermissionRecord,
} from '../storage/permissions-from-events';
import { toNonEmptyString } from './utils';
import type { AgentServerState, SessionUpdate } from '../server-types';

type ToolUseUpdate = Extract<SessionUpdate, { type: 'tool_use' }>;
type ToolUseKind = NonNullable<ToolUseUpdate['kind']>;

const TOOL_USE_KINDS = new Set<ToolUseKind>([
  'read',
  'edit',
  'delete',
  'search',
  'execute',
  'think',
  'fetch',
  'other',
]);

function toToolUseKind(kind: string | undefined): ToolUseKind | undefined {
  return kind && TOOL_USE_KINDS.has(kind as ToolUseKind) ? (kind as ToolUseKind) : undefined;
}

async function recordPermissionCancelled(
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  record: PendingPermissionRecord
): Promise<void> {
  if (!state.activeSession) return;

  await runExclusive(() => {
    if (!state.activeSession) return;

    let sessionState = readSessionState(state.activeSession.dir);
    const { nextState } = appendDurableEvent(state.activeSession.dir, sessionState, {
      type: 'permission_cancelled',
      turnId: record.turnId,
      data: { toolCallId: record.toolCallId, turnSeq: record.turnSeq, reason: 'cancelled' },
    });
    sessionState = nextState;
    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
  });
}

async function emitPermissionCancelledUpdate(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  record: PendingPermissionRecord
): Promise<void> {
  if (!state.activeSession) return;
  const kind = toToolUseKind(record.kind);
  const update: ToolUseUpdate = {
    type: 'tool_use',
    toolCallId: record.toolCallId,
    name: record.tool,
    ...(kind ? { kind } : {}),
    input: record.input,
    status: 'cancelled',
    result: {
      outcome: 'cancelled',
      content: [{ type: 'error', message: 'Cancelled' }],
    },
  };

  await runExclusive(() => {
    if (!state.activeSession) return;

    const sessionState = readSessionState(state.activeSession.dir);
    peer.notify('session/update', {
      sessionId: state.activeSession.meta.sessionId,
      streamSeq: sessionState.nextStreamSeq,
      turnId: record.turnId,
      turnSeq: record.turnSeq,
      ...(record.jobId ? { jobId: record.jobId } : {}),
      ...update,
    });
    writeSessionState(state.activeSession.dir, {
      ...sessionState,
      nextStreamSeq: sessionState.nextStreamSeq + 1,
    });
    state.activeSession = loadSession(state.activeSession.meta.sessionId);
  });
}

export async function cancelPendingPermissionRequests(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  options?: { exceptTurnId?: string }
): Promise<void> {
  const pending = Array.from(state.pendingPermissionRequests.values()).filter(
    (permission) => permission.record.turnId !== options?.exceptTurnId
  );

  for (const permission of pending) {
    state.pendingPermissionRequests.delete(permission.record.toolCallId);
    peer.rejectRequest(permission.rpcId, JSONRPC_ERROR_CANCELLED, 'cancelled');
    await recordPermissionCancelled(state, runExclusive, permission.record);
    await emitPermissionCancelledUpdate(peer, state, runExclusive, permission.record);
  }
}

/**
 * Request permission from client for a tool execution.
 * Sends permission request to client and waits for response.
 */
export async function requestPermissionFromClient(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  request: {
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
  }
): Promise<{ decision?: string; updatedInput?: Record<string, unknown> }> {
  const requestedAt = new Date().toISOString();

  const record: PendingPermissionRecord = {
    toolCallId: request.toolCallId,
    turnId: request.turnId,
    turnSeq: request.turnSeq,
    jobId: request.jobId,
    tool: request.tool,
    kind: request.kind,
    resource: request.resource,
    options: request.options,
    requestedAt,
    input: request.input,
  };

  await runExclusive(() => {
    let sessionState = readSessionState(state.activeSession!.dir);
    const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
      type: 'permission_requested',
      turnId: request.turnId,
      data: {
        toolCallId: request.toolCallId,
        turnSeq: request.turnSeq,
        ...(request.jobId ? { jobId: request.jobId } : {}),
        tool: request.tool,
        ...(request.kind ? { kind: request.kind } : {}),
        resource: request.resource,
        options: request.options,
        requestedAt,
        input: request.input,
      },
    });
    sessionState = nextState;
    writeSessionState(state.activeSession!.dir, sessionState);
    state.activeSession = loadSession(state.activeSession!.meta.sessionId);
  });

  const { requestId: rpcId, result } = peer.requestWithId('session/request_permission', {
    sessionId: request.sessionId,
    turnId: request.turnId,
    turnSeq: request.turnSeq,
    jobId: request.jobId,
    tool: request.tool,
    kind: request.kind,
    resource: request.resource,
    options: request.options,
    requestedAt,
    toolCallId: request.toolCallId,
  });

  state.pendingPermissionRequests.set(request.toolCallId, {
    requestId: String(rpcId),
    rpcId,
    record,
    result,
  });

  const abortPromise = request.signal
    ? new Promise<never>((_, reject) => {
        request.signal!.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        });
      })
    : null;

  let response: { decision?: string; updatedInput?: Record<string, unknown> } | undefined;
  try {
    response = (abortPromise ? await Promise.race([result, abortPromise]) : await result) as
      | { decision?: string; updatedInput?: Record<string, unknown> }
      | undefined;
  } catch {
    const pending = state.pendingPermissionRequests.get(request.toolCallId);
    if (pending?.rpcId !== rpcId) throw new Error('cancelled');

    peer.abandonRequest(rpcId);
    state.pendingPermissionRequests.delete(request.toolCallId);
    await recordPermissionCancelled(state, runExclusive, record);

    throw new Error('cancelled');
  }

  const decision = toNonEmptyString(response?.decision) ?? undefined;
  const updatedInput =
    response?.updatedInput && typeof response.updatedInput === 'object'
      ? (response.updatedInput as Record<string, unknown>)
      : undefined;

  state.pendingPermissionRequests.delete(request.toolCallId);

  await runExclusive(() => {
    let sessionState = readSessionState(state.activeSession!.dir);
    const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
      type: 'permission_decided',
      turnId: request.turnId,
      data: {
        toolCallId: request.toolCallId,
        turnSeq: request.turnSeq,
        ...(decision ? { decision } : {}),
        ...(updatedInput ? { updatedInput } : {}),
      },
    });
    sessionState = nextState;
    writeSessionState(state.activeSession!.dir, sessionState);
    state.activeSession = loadSession(state.activeSession!.meta.sessionId);
  });

  return { ...(decision ? { decision } : {}), ...(updatedInput ? { updatedInput } : {}) };
}

/**
 * Re-issue pending permission requests from durable events.
 * Used during initialization to restore pending permission requests.
 */
export async function reissuePendingPermissionRequests(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>
): Promise<void> {
  if (!state.activeSession) return;

  const sessionId = state.activeSession.meta.sessionId;
  const pending = derivePendingPermissionsFromDurableEvents(state.activeSession.dir);
  for (const record of pending) {
    if (state.pendingPermissionRequests.has(record.toolCallId)) continue;

    const { requestId: rpcId, result } = peer.requestWithId('session/request_permission', {
      sessionId,
      turnId: record.turnId,
      turnSeq: record.turnSeq,
      ...(record.jobId ? { jobId: record.jobId } : {}),
      toolCallId: record.toolCallId,
      tool: record.tool,
      kind: record.kind,
      resource: record.resource,
      options: record.options,
      requestedAt: record.requestedAt,
    });

    state.pendingPermissionRequests.set(record.toolCallId, {
      requestId: String(rpcId),
      rpcId,
      record,
      result,
    });

    void (async () => {
      try {
        const response = (await result) as {
          decision?: string;
          updatedInput?: Record<string, unknown>;
        } | null;
        const decision = toNonEmptyString(response?.decision) ?? undefined;
        const updatedInput =
          response?.updatedInput && typeof response.updatedInput === 'object'
            ? response.updatedInput
            : undefined;

        state.pendingPermissionRequests.delete(record.toolCallId);

        await runExclusive(() => {
          let sessionState = readSessionState(state.activeSession!.dir);
          const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
            type: 'permission_decided',
            turnId: record.turnId,
            data: {
              toolCallId: record.toolCallId,
              turnSeq: record.turnSeq,
              ...(decision ? { decision } : {}),
              ...(updatedInput ? { updatedInput } : {}),
            },
          });
          sessionState = nextState;
          writeSessionState(state.activeSession!.dir, sessionState);
          state.activeSession = loadSession(state.activeSession!.meta.sessionId);
        });
      } catch {
        state.pendingPermissionRequests.delete(record.toolCallId);
      }
    })();
  }
}
