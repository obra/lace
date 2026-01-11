// ABOUTME: Permission request handling for tool execution approvals

import type { JsonRpcPeer } from '@lace/ent-protocol';
import { appendDurableEvent } from '../storage/event-log';
import { readSessionState, writeSessionState, loadSession } from '../storage/session-store';
import {
  derivePendingPermissionsFromDurableEvents,
  type PendingPermissionRecord,
} from '../storage/permissions-from-events';
import { toNonEmptyString } from './utils';
import type { AgentServerState } from '../server-types';

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

  let response: any;
  try {
    response = abortPromise ? await Promise.race([result, abortPromise]) : await result;
  } catch {
    peer.abandonRequest(rpcId);
    state.pendingPermissionRequests.delete(request.toolCallId);

    await runExclusive(() => {
      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'permission_cancelled',
        turnId: request.turnId,
        data: { toolCallId: request.toolCallId, turnSeq: request.turnSeq, reason: 'cancelled' },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);
    });

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
        const response = (await result) as any;
        const decision = toNonEmptyString(response?.decision) ?? undefined;
        const updatedInput =
          response?.updatedInput && typeof response.updatedInput === 'object'
            ? (response.updatedInput as Record<string, unknown>)
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
