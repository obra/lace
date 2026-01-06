// ABOUTME: API endpoint for loading conversation history for a supervisor-backed agent session
// ABOUTME: Converts Ent durable session events into AppEvent timeline events

import { isAgentSessionId } from '@lace/web/lib/validation/session-id-validation';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import type { AppEvent } from '@lace/web/types/app-events';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import type { Route } from './+types/api.agents.$agentId.history';

type DurableEvent = {
  eventSeq: number;
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
};

function toTextContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const t = (item as { type?: unknown }).type;
      if (t !== 'text') return '';
      const text = (item as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

function toolResultToTextContent(result: unknown): Array<{ type: 'text'; text: string }> {
  const record = result as { content?: unknown; outcome?: unknown } | undefined;
  const raw = Array.isArray(record?.content) ? record?.content : [];
  const items = raw
    .map((c) => {
      if (!c || typeof c !== 'object') return null;
      const type = (c as { type?: unknown }).type;
      if (type === 'text') {
        const text = (c as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      if (type === 'json') {
        return JSON.stringify((c as { data?: unknown }).data, null, 2);
      }
      if (type === 'error') {
        const message = (c as { message?: unknown }).message;
        return typeof message === 'string' ? message : 'Error';
      }
      if (type === 'image') {
        const mediaType = (c as { mediaType?: unknown }).mediaType;
        return `[image:${typeof mediaType === 'string' ? mediaType : 'unknown'}]`;
      }
      return null;
    })
    .filter((v): v is string => typeof v === 'string');

  if (items.length === 0) {
    const outcome = record && typeof record.outcome === 'string' ? record.outcome : 'completed';
    return [{ type: 'text', text: outcome }];
  }

  return items.map((text) => ({ type: 'text', text }));
}

function durableEventsToAppEvents(agentSessionId: string, events: DurableEvent[]): AppEvent[] {
  const out: AppEvent[] = [];

  for (const e of events) {
    const timestamp = new Date(e.timestamp);

    if (e.type === 'prompt') {
      const content = toTextContent(e.data?.content);
      if (content.trim()) {
        out.push({
          id: `ent_${e.eventSeq}_user`,
          type: 'USER_MESSAGE_SENT',
          timestamp,
          data: { content, agentSessionId },
          agentSessionId,
          workspaceSessionId: 'unknown',
        } as AppEvent);
      }
      continue;
    }

    if (e.type === 'message') {
      const content = typeof e.data?.content === 'string' ? e.data.content : '';
      out.push({
        id: `ent_${e.eventSeq}_assistant`,
        type: 'LOCAL_SYSTEM_MESSAGE',
        timestamp,
        data: { content, agentSessionId },
        agentSessionId,
        workspaceSessionId: 'unknown',
      } as AppEvent);
      continue;
    }

    if (e.type === 'context_injected') {
      const content = toTextContent(e.data?.content);
      if (content.trim()) {
        out.push({
          id: `ent_${e.eventSeq}_system`,
          type: 'LOCAL_SYSTEM_MESSAGE',
          timestamp,
          data: { content, agentSessionId },
          agentSessionId,
          workspaceSessionId: 'unknown',
        } as AppEvent);
      }
      continue;
    }

    if (e.type === 'tool_use') {
      const toolCallId = typeof e.data.toolCallId === 'string' ? e.data.toolCallId : '';
      const name = typeof e.data.name === 'string' ? e.data.name : '';
      const input =
        e.data.input && typeof e.data.input === 'object' && !Array.isArray(e.data.input)
          ? (e.data.input as Record<string, unknown>)
          : {};

      out.push({
        id: `ent_${e.eventSeq}_tool_call`,
        type: 'SYSTEM_NOTIFICATION',
        timestamp,
        data: { message: `Tool call: ${name}`, level: 'info' as const },
        agentSessionId,
        workspaceSessionId: 'unknown',
      } as AppEvent);

      if ('result' in e.data && e.data.result) {
        const outcome = (e.data.result as { outcome?: unknown }).outcome;
        const status =
          outcome === 'denied'
            ? 'denied'
            : outcome === 'failed' || outcome === 'timeout'
              ? 'failed'
              : 'completed';

        const resultContent = toolResultToTextContent(e.data.result)
          .map((item) => item.text)
          .join('\n');

        out.push({
          id: `ent_${e.eventSeq}_tool_result`,
          type: 'SYSTEM_NOTIFICATION',
          timestamp,
          data: { message: `Tool result (${status}): ${resultContent}`, level: 'info' as const },
          agentSessionId,
          workspaceSessionId: 'unknown',
        } as AppEvent);
      }

      continue;
    }
  }

  return out;
}

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { agentId } = params as { agentId: string };

    if (!isAgentSessionId(agentId)) {
      return createErrorResponse('Invalid agent ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = await getSupervisor();
    const workspace = (await supervisor.listWorkspaceSessions()).find((ws) =>
      ws.agents.some((a) => a.sessionId === agentId)
    );

    if (!workspace) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const result = (await supervisor.agentRequest({
      workspaceSessionId: workspace.workspaceSessionId,
      sessionId: agentId,
      method: 'ent/session/events',
      requestParams: {
        limit: 5000,
      },
    })) as { events: DurableEvent[] };

    const events = durableEventsToAppEvents(
      agentId,
      Array.isArray(result.events) ? result.events : []
    );

    return createSuperjsonResponse(events, { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
