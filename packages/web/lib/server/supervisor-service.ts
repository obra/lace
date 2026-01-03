// ABOUTME: Supervisor singleton for web server routes
// ABOUTME: Bridges supervisor session updates into EventStreamManager SSE broadcasts

import { Supervisor } from '@lace/supervisor';
import { ensureLaceDir } from '@lace/web/lib/server/lace-imports';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import type { LaceEvent } from '@lace/web/types/core';
import { SessionIdSchema } from '@lace/ent-protocol';

declare global {
  // eslint-disable-next-line no-var
  var laceWebSupervisor: Supervisor | undefined;
  // eslint-disable-next-line no-var
  var laceWebPendingPermissions:
    | Map<
        string,
        {
          workspaceSessionId: string;
          agentSessionId: string;
          params: Record<string, unknown>;
          createdAt: number;
          resolve: (decision: {
            decision: 'allow' | 'deny';
            updatedInput?: Record<string, unknown>;
          }) => void;
        }
      >
    | undefined;
}

function toToolResultContent(
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'json'; data: unknown }
    | { type: 'image'; data: string; mediaType?: string }
    | { type: 'error'; message: string; code?: string }
  >
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
    const input = typeof update.input === 'object' && update.input ? update.input : {};
    const status = typeof update.status === 'string' ? update.status : '';

    const events: LaceEvent[] = [];

    if (status === 'pending') {
      events.push({
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: { id: toolCallId, name, arguments: input },
        context: baseContext,
      });
    }

    if (status === 'awaiting_permission') {
      events.push({
        type: 'TOOL_APPROVAL_REQUEST',
        timestamp: new Date(),
        data: { toolCallId },
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
      typeof update.result === 'object'
    ) {
      const result = update.result as { outcome?: string; content?: unknown[] };
      const content = Array.isArray(result.content) ? (result.content as any[]) : [];

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

  global.laceWebSupervisor = new Supervisor({
    laceDir,
    onSessionUpdate: (workspaceSessionId, update) => {
      const supervisor = global.laceWebSupervisor;
      if (!supervisor) return;

      const record = supervisor.getWorkspaceSession(workspaceSessionId);
      const projectId = record?.projectId;
      const agentSessionId =
        typeof (update as any).sessionId === 'string' ? (update as any).sessionId : undefined;

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

      const agentSessionId =
        typeof (params as any).sessionId === 'string'
          ? String((params as any).sessionId)
          : undefined;

      const toolCallId = String((params as any).toolCallId ?? '');

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

      if (!agentSessionId || !SessionIdSchema.safeParse(agentSessionId).success) {
        return { decision: 'deny' };
      }

      const pending = global.laceWebPendingPermissions;
      if (!pending) return { decision: 'deny' };

      const timeoutMs = 5 * 60 * 1000;

      return await new Promise<{
        decision: 'allow' | 'deny';
        updatedInput?: Record<string, unknown>;
      }>((resolve) => {
        pending.set(toolCallId, {
          workspaceSessionId,
          agentSessionId,
          params: params as Record<string, unknown>,
          createdAt: Date.now(),
          resolve,
        });

        setTimeout(() => {
          const still = pending.get(toolCallId);
          if (!still) return;
          pending.delete(toolCallId);
          still.resolve({ decision: 'deny' });
        }, timeoutMs);
      });
    },
  });

  return global.laceWebSupervisor;
}

export function isAgentSessionId(value: string): boolean {
  return SessionIdSchema.safeParse(value).success;
}

export function listPendingPermissions(workspaceSessionId: string): Array<{
  toolCallId: string;
  agentSessionId: string;
  params: Record<string, unknown>;
  requestedAt: Date;
}> {
  const pending = global.laceWebPendingPermissions;
  if (!pending) return [];

  return Array.from(pending.entries())
    .filter(([, v]) => v.workspaceSessionId === workspaceSessionId)
    .map(([toolCallId, v]) => ({
      toolCallId,
      agentSessionId: v.agentSessionId,
      params: v.params,
      requestedAt: new Date(v.createdAt),
    }))
    .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
}

export function resolvePendingPermission(params: {
  workspaceSessionId: string;
  toolCallId: string;
  decision: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
}): boolean {
  const pending = global.laceWebPendingPermissions;
  if (!pending) return false;

  const found = pending.get(params.toolCallId);
  if (!found) return false;
  if (found.workspaceSessionId !== params.workspaceSessionId) return false;

  pending.delete(params.toolCallId);
  found.resolve({
    decision: params.decision,
    ...(params.updatedInput ? { updatedInput: params.updatedInput } : {}),
  });
  return true;
}
