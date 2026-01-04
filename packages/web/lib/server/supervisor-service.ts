// ABOUTME: Supervisor singleton for web server routes
// ABOUTME: Bridges supervisor session updates into EventStreamManager SSE broadcasts

import { Supervisor } from '@lace/supervisor';
import { ensureLaceDir } from '@lace/web/lib/server/lace-imports';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import type { LaceEvent } from '@lace/web/types/core';
import { isSessionId } from '@lace/ent-protocol';

declare global {
  var laceWebSupervisor: Supervisor | undefined;
  var laceWebPendingPermissions:
    | Map<
        string,
        {
          workspaceSessionId: string;
          agentSessionId: string;
          toolCallId: string;
          toolCall?: { name: string; arguments: Record<string, unknown> };
          params: Record<string, unknown>;
          createdAt: number;
          resolve: (decision: {
            decision: 'allow' | 'deny';
            updatedInput?: Record<string, unknown>;
          }) => void;
        }
      >
    | undefined;
  var laceWebPendingToolCalls:
    | Map<
        string,
        {
          workspaceSessionId: string;
          agentSessionId: string;
          toolCallId: string;
          toolCall: { name: string; arguments: Record<string, unknown> };
          createdAt: number;
        }
      >
    | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function permissionKey(agentSessionId: string, toolCallId: string): string {
  return `${agentSessionId}:${toolCallId}`;
}

type ToolResultContentItem =
  | { type: 'text'; text: string }
  | { type: 'json'; data: unknown }
  | { type: 'image'; data: string; mediaType?: string }
  | { type: 'error'; message: string; code?: string };

function isToolResultContentItem(value: unknown): value is ToolResultContentItem {
  if (!isRecord(value)) return false;

  if (value.type === 'text') return typeof value.text === 'string';
  if (value.type === 'json') return 'data' in value;
  if (value.type === 'image') return typeof value.data === 'string';
  if (value.type === 'error') return typeof value.message === 'string';

  return false;
}

function toToolResultContent(
  content: ToolResultContentItem[]
): Array<{ type: 'text'; text: string }> {
  return content.map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'json') return { type: 'text', text: JSON.stringify(c.data, null, 2) };
    if (c.type === 'image') return { type: 'text', text: `[image:${c.mediaType ?? 'unknown'}]` };
    return { type: 'text', text: c.message };
  });
}

function updateToLaceEvents(params: {
  workspaceSessionId: string;
  projectId?: string;
  agentSessionId?: string;
  update: Record<string, unknown>;
}): LaceEvent[] {
  const { workspaceSessionId, projectId, agentSessionId, update } = params;
  const type = update.type;

  const baseContext: LaceEvent['context'] = {
    sessionId: workspaceSessionId,
    ...(projectId ? { projectId } : {}),
    ...(agentSessionId ? { threadId: agentSessionId } : {}),
  };

  if (type === 'text_delta' && typeof update.text === 'string') {
    return [
      {
        type: 'AGENT_STREAMING',
        timestamp: new Date(),
        transient: true,
        data: { content: update.text },
        context: baseContext,
      },
    ];
  }

  if (type === 'tool_use') {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    const name = typeof update.name === 'string' ? update.name : '';
    const input = isRecord(update.input) ? update.input : {};
    const status = typeof update.status === 'string' ? update.status : '';

    const events: LaceEvent[] = [];

    if (status === 'pending' || status === 'awaiting_permission') {
      if (toolCallId && name && agentSessionId) {
        const key = permissionKey(agentSessionId, toolCallId);
        global.laceWebPendingToolCalls?.set(key, {
          workspaceSessionId,
          agentSessionId,
          toolCallId,
          toolCall: { name, arguments: input },
          createdAt: Date.now(),
        });
      }

      events.push({
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: { id: toolCallId, name, arguments: input },
        context: baseContext,
      });
    }

    if (
      (status === 'completed' ||
        status === 'failed' ||
        status === 'denied' ||
        status === 'timeout' ||
        status === 'cancelled') &&
      update.result &&
      isRecord(update.result)
    ) {
      const result = update.result;
      const rawContent = Array.isArray(result.content) ? result.content : [];
      const content = rawContent.filter(isToolResultContentItem);

      events.push({
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          id: toolCallId,
          status: status === 'completed' ? 'completed' : status === 'denied' ? 'denied' : 'failed',
          content: toToolResultContent(content),
        },
        context: baseContext,
      });
    }

    return events;
  }

  return [];
}

export function getSupervisor(): Supervisor {
  if (global.laceWebSupervisor) return global.laceWebSupervisor;

  const laceDir = ensureLaceDir();
  if (!global.laceWebPendingPermissions) global.laceWebPendingPermissions = new Map();
  if (!global.laceWebPendingToolCalls) global.laceWebPendingToolCalls = new Map();

  global.laceWebSupervisor = new Supervisor({
    laceDir,
    onSessionUpdate: (workspaceSessionId, update) => {
      const supervisor = global.laceWebSupervisor;
      if (!supervisor) return;

      const record = supervisor.getWorkspaceSession(workspaceSessionId);
      const projectId = record?.projectId;
      const agentSessionId = typeof update.sessionId === 'string' ? update.sessionId : undefined;

      const events = updateToLaceEvents({
        workspaceSessionId,
        projectId,
        agentSessionId,
        update,
      });

      if (events.length === 0) return;

      const manager = EventStreamManager.getInstance();
      for (const event of events) manager.broadcast(event);
    },
    onPermissionRequest: async (workspaceSessionId, params) => {
      const manager = EventStreamManager.getInstance();
      const supervisor = global.laceWebSupervisor;
      const record = supervisor?.getWorkspaceSession(workspaceSessionId);
      const projectId = record?.projectId;

      const agentSessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;

      const toolCallId = typeof params.toolCallId === 'string' ? params.toolCallId : '';

      manager.broadcast({
        type: 'TOOL_APPROVAL_REQUEST',
        timestamp: new Date(),
        data: { toolCallId },
        context: {
          sessionId: workspaceSessionId,
          ...(projectId ? { projectId } : {}),
          ...(agentSessionId ? { threadId: agentSessionId } : {}),
        },
      });

      if (!agentSessionId || !isSessionId(agentSessionId)) {
        return { decision: 'deny' };
      }

      const pending = global.laceWebPendingPermissions;
      if (!pending) return { decision: 'deny' };
      const pendingToolCalls = global.laceWebPendingToolCalls;

      const timeoutMs = 5 * 60 * 1000;

      return await new Promise<{
        decision: 'allow' | 'deny';
        updatedInput?: Record<string, unknown>;
      }>((resolve) => {
        const key = permissionKey(agentSessionId, toolCallId);
        const toolCallFromUpdates = pendingToolCalls?.get(key);
        const toolCall =
          toolCallFromUpdates &&
          toolCallFromUpdates.workspaceSessionId === workspaceSessionId &&
          toolCallFromUpdates.agentSessionId === agentSessionId
            ? toolCallFromUpdates.toolCall
            : undefined;

        if (pendingToolCalls) pendingToolCalls.delete(key);

        pending.set(key, {
          workspaceSessionId,
          agentSessionId,
          toolCallId,
          ...(toolCall ? { toolCall } : {}),
          params,
          createdAt: Date.now(),
          resolve,
        });

        setTimeout(() => {
          const still = pending.get(key);
          if (!still) return;
          pending.delete(key);
          pendingToolCalls?.delete(key);
          still.resolve({ decision: 'deny' });
        }, timeoutMs);
      });
    },
  });

  return global.laceWebSupervisor;
}

export function isAgentSessionId(value: string): boolean {
  return isSessionId(value);
}

export function listPendingPermissions(workspaceSessionId: string): Array<{
  toolCallId: string;
  agentSessionId: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  params: Record<string, unknown>;
  requestedAt: Date;
}> {
  const pending = global.laceWebPendingPermissions;
  if (!pending) return [];

  return Array.from(pending.values())
    .filter((v) => v.workspaceSessionId === workspaceSessionId)
    .map((v) => ({
      toolCallId: v.toolCallId,
      agentSessionId: v.agentSessionId,
      ...(v.toolCall ? { toolCall: v.toolCall } : {}),
      params: v.params,
      requestedAt: new Date(v.createdAt),
    }))
    .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
}

export function resolvePendingPermission(params: {
  workspaceSessionId: string;
  agentSessionId?: string;
  toolCallId: string;
  decision: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
}): boolean {
  const pending = global.laceWebPendingPermissions;
  if (!pending) return false;

  const key = params.agentSessionId
    ? permissionKey(params.agentSessionId, params.toolCallId)
    : undefined;

  const found =
    key && pending.has(key)
      ? pending.get(key)
      : Array.from(pending.values()).find(
          (v) =>
            v.workspaceSessionId === params.workspaceSessionId && v.toolCallId === params.toolCallId
        );
  if (!found) return false;
  if (found.workspaceSessionId !== params.workspaceSessionId) return false;

  const resolvedKey = permissionKey(found.agentSessionId, found.toolCallId);
  pending.delete(resolvedKey);
  global.laceWebPendingToolCalls?.delete(resolvedKey);
  found.resolve({
    decision: params.decision,
    ...(params.updatedInput ? { updatedInput: params.updatedInput } : {}),
  });
  return true;
}

export async function shutdownSupervisorForTests(): Promise<void> {
  const supervisor = global.laceWebSupervisor;
  if (!supervisor) return;

  global.laceWebSupervisor = undefined;
  global.laceWebPendingPermissions?.clear();
  global.laceWebPendingToolCalls?.clear();
  await supervisor.shutdown();
}
