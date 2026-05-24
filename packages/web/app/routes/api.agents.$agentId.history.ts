// ABOUTME: API endpoint for loading conversation history for a supervisor-backed agent session
// ABOUTME: Converts Ent durable session events into AppEvent timeline events

import { isAgentSessionId, asAgentSessionId } from '@lace/web/lib/validation/session-id-validation';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import type { AppEvent, ProtocolEvent, ToolUseUpdate } from '@lace/web/types/app-events';
import { isWebEvent } from '@lace/web/types/app-events';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import type { Route } from './+types/api.agents.$agentId.history';
import type { SessionId } from '@lace/ent-protocol';

type DurableEvent = {
  eventSeq: number;
  timestamp: string;
  turnId?: string;
  turnSeq?: number;
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

function durableEventsToAppEvents(params: {
  agentSessionId: SessionId;
  workspaceSessionId: string;
  projectId?: string;
  events: DurableEvent[];
}): AppEvent[] {
  const out: AppEvent[] = [];
  const { agentSessionId, workspaceSessionId, projectId, events } = params;

  for (const e of events) {
    const timestamp = new Date(e.timestamp);

    if (e.type === 'prompt') {
      const content = toTextContent(e.data?.content);
      if (content.trim()) {
        out.push({
          id: `ent_${e.eventSeq}_user`,
          type: 'USER_MESSAGE',
          timestamp,
          data: content,
          agentSessionId,
          workspaceSessionId,
          ...(typeof projectId === 'string' ? { projectId } : {}),
        } as AppEvent);
      }
      continue;
    }

    if (e.type === 'message') {
      const content = toTextContent(e.data?.content);
      out.push({
        id: `ent_${e.eventSeq}_assistant`,
        type: 'AGENT_MESSAGE',
        timestamp,
        data: { content },
        agentSessionId,
        workspaceSessionId,
        ...(typeof projectId === 'string' ? { projectId } : {}),
      } as AppEvent);
      continue;
    }

    // Legacy sessions (pre-Phase 2) used context_injected for the foundational
    // system prompt. Keep this mapping so old sessions still show a SYSTEM_PROMPT
    // in the UI. New sessions use system_prompt_set, which is fetched separately
    // via ent/session/system_prompt and prepended by the loader.
    if (e.type === 'context_injected') {
      const content = toTextContent(e.data?.content);
      if (content.trim()) {
        out.push({
          id: `ent_${e.eventSeq}_system`,
          type: 'SYSTEM_PROMPT',
          timestamp,
          data: content,
          agentSessionId,
          workspaceSessionId,
          ...(typeof projectId === 'string' ? { projectId } : {}),
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

      // Determine status based on whether we have a result
      const hasResult = 'result' in e.data && e.data.result;
      let status: ToolUseUpdate['status'] = 'pending';
      if (hasResult) {
        const outcome = (e.data.result as { outcome?: unknown }).outcome;
        if (outcome === 'denied') {
          status = 'denied';
        } else if (outcome === 'failed') {
          status = 'failed';
        } else if (outcome === 'timeout') {
          status = 'timeout';
        } else if (outcome === 'cancelled') {
          status = 'cancelled';
        } else {
          status = 'completed';
        }
      }

      // Build the tool_use update with proper typing
      const toolUseUpdate: ToolUseUpdate & {
        sessionId: string;
        streamSeq: number;
        turnId: string;
        turnSeq: number;
      } = {
        sessionId: agentSessionId,
        streamSeq: e.eventSeq,
        turnId: 'historical',
        turnSeq: 0,
        type: 'tool_use',
        toolCallId,
        name,
        input,
        status,
        ...(hasResult ? { result: e.data.result as ToolUseUpdate['result'] } : {}),
      };

      // Build proper ProtocolEvent with tool_use update
      const toolEvent: ProtocolEvent = {
        id: `ent_${e.eventSeq}_tool`,
        timestamp,
        update: toolUseUpdate,
        workspaceSessionId,
        ...(typeof projectId === 'string' ? { projectId } : {}),
        agentSessionId,
      };

      out.push(toolEvent);
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

    // Fetch conversation events and system prompt in parallel.
    // system_prompt_set events are filtered from ent/session/events (they contain
    // secrets); use the dedicated ent/session/system_prompt endpoint instead.
    const [result, systemPromptResult] = await Promise.all([
      supervisor.agentRequest({
        workspaceSessionId: workspace.workspaceSessionId,
        sessionId: agentId,
        method: 'ent/session/events',
        requestParams: {
          limit: 5000,
        },
      }) as Promise<{ events: DurableEvent[] }>,
      supervisor.agentRequest({
        workspaceSessionId: workspace.workspaceSessionId,
        sessionId: agentId,
        method: 'ent/session/system_prompt',
        requestParams: {},
      }) as Promise<{ text: string }>,
    ]);

    const events = durableEventsToAppEvents({
      agentSessionId: asAgentSessionId(agentId),
      workspaceSessionId: workspace.workspaceSessionId,
      ...(typeof workspace.projectId === 'string' ? { projectId: workspace.projectId } : {}),
      events: Array.isArray(result.events) ? result.events : [],
    });

    // Prepend a synthetic SYSTEM_PROMPT event when the session has a
    // system_prompt_set event. For legacy sessions the event_injected handler
    // above already emits one; in that case systemPromptResult.text is '' and
    // we skip the prepend to avoid a duplicate.
    const systemPromptText = systemPromptResult.text;
    if (
      systemPromptText.trim() &&
      !events.some((e) => isWebEvent(e) && e.type === 'SYSTEM_PROMPT')
    ) {
      const syntheticSystemPrompt: AppEvent = {
        id: `${agentId}_system_prompt`,
        type: 'SYSTEM_PROMPT',
        timestamp: new Date(0),
        data: systemPromptText,
        agentSessionId: asAgentSessionId(agentId),
        workspaceSessionId: workspace.workspaceSessionId,
        ...(typeof workspace.projectId === 'string' ? { projectId: workspace.projectId } : {}),
      } as AppEvent;
      events.unshift(syntheticSystemPrompt);
    }

    return createSuperjsonResponse(events, { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
