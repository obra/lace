// ABOUTME: Hook for processing AppEvents for timeline display
// ABOUTME: Handles filtering, token aggregation, tool call/result pairing, and protocol events

import { useMemo } from 'react';
import type { ThreadId, ToolCall, ToolResult } from '@lace/web/types/core';
import type { AppEvent, PermissionRequestEvent, ProtocolEvent } from '@lace/web/types/app-events';
import { isPermissionRequestEvent, isProtocolEvent, isWebEvent } from '@lace/web/types/app-events';
import type { WebEventType } from '@lace/web/types/web-events';
import type {
  ErrorUpdate,
  PermissionRequest,
  TextDeltaUpdate,
  ToolUseUpdate,
  TurnEndUpdate,
  TurnStartUpdate,
} from '@lace/web/types/protocol-events';

// Internal event type for timeline processing
// This is a simplified version that only contains what we need for UI rendering
interface InternalTimelineEvent {
  id: string;
  timestamp: Date;
  type:
    | WebEventType
    | 'AGENT_MESSAGE'
    | 'AGENT_ERROR'
    | 'SYSTEM_PROMPT'
    | 'USER_SYSTEM_PROMPT'
    | 'COMPACTION'
    | 'COMPACTION_START'
    | 'COMPACTION_COMPLETE';
  data: unknown;
  transient?: boolean;
  visibleToModel?: boolean;
  context?: {
    threadId?: ThreadId;
    projectId?: string;
    sessionId?: string;
    taskId?: string;
  };
}

interface ProcessedToolEvent extends Omit<InternalTimelineEvent, 'type' | 'data'> {
  type: 'TOOL_AGGREGATED';
  data: {
    call: ToolCall;
    result?: ToolResult;
    toolName: string;
    toolId?: string;
    arguments?: unknown;
  };
}

export type ProcessedEvent = InternalTimelineEvent | ProcessedToolEvent;

/**
 * Helper to extract agent session ID from any ProcessedEvent type.
 * Returns undefined if the event doesn't have an agent session ID.
 */
export function getProcessedEventAgentId(event: ProcessedEvent): string | undefined {
  return event.context?.threadId;
}

export function useProcessedEvents(events: AppEvent[], selectedAgent?: ThreadId): ProcessedEvent[] {
  return useMemo(() => {
    // 1. Separate protocol events from web events
    // Web events are converted to InternalTimelineEvent for processing
    const webEvents = events.filter(isWebEvent);
    const protocolEvents = events.filter(isProtocolEvent);
    const permissionEvents = events.filter(isPermissionRequestEvent);

    // Convert web events to InternalTimelineEvent format for processing
    const timelineEvents: InternalTimelineEvent[] = webEvents
      .map((e) => {
        if (!isWebEvent(e)) return null as unknown as InternalTimelineEvent;
        return {
          id: e.id,
          timestamp: e.timestamp,
          type: e.type as InternalTimelineEvent['type'],
          data: e.data,
          context: { threadId: e.agentSessionId as ThreadId },
        };
      })
      .filter(Boolean);

    // 2. Process protocol events into the same timeline model
    const processedProtocolEvents = processProtocolEvents(protocolEvents, permissionEvents);

    // 3. Merge both event streams and sort by timestamp
    const allEvents = [...timelineEvents, ...processedProtocolEvents];
    if (allEvents.length <= 1) return allEvents;

    const sorted = allEvents.sort((a, b) => {
      const aTime = (a.timestamp || new Date()).getTime();
      const bTime = (b.timestamp || new Date()).getTime();
      return aTime - bTime;
    });

    return filterEventsByAgent(sorted, selectedAgent);
  }, [events, selectedAgent]);
}

function filterEventsByAgent(events: ProcessedEvent[], selectedAgent?: ThreadId): ProcessedEvent[] {
  if (!selectedAgent) {
    return events;
  }

  return events.filter((event) => {
    // Always show user messages and system messages
    if (event.type === 'USER_MESSAGE' || event.type === 'LOCAL_SYSTEM_MESSAGE') {
      return true;
    }

    // Show events from the selected agent's thread
    return event.context?.threadId === selectedAgent;
  });
}

function toDisplayText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toAppToolResultForToolUse(params: {
  toolCallId: string;
  status: ToolUseUpdate['status'];
  wireResult?: ToolUseUpdate['result'];
  permissionRequest?: PermissionRequest;
}): ToolResult {
  const baseMetadata: Record<string, unknown> = {
    toolCallId: params.toolCallId,
    ...(params.permissionRequest ? { permissionRequest: params.permissionRequest } : {}),
  };

  if (params.status === 'awaiting_permission') {
    return {
      id: params.toolCallId,
      status: 'pending',
      content: [{ type: 'text', text: 'Awaiting permission…' }],
      metadata: baseMetadata,
    };
  }

  if (params.status === 'pending' || params.status === 'running') {
    return {
      id: params.toolCallId,
      status: 'pending',
      content: [
        { type: 'text', text: params.status === 'running' ? 'Running tool…' : 'Starting…' },
      ],
      metadata: baseMetadata,
    };
  }

  if (!params.wireResult) {
    const status: ToolResult['status'] =
      params.status === 'denied'
        ? 'denied'
        : params.status === 'cancelled'
          ? 'aborted'
          : params.status === 'failed' || params.status === 'timeout'
            ? 'failed'
            : 'completed';

    return {
      id: params.toolCallId,
      status,
      content: [{ type: 'text', text: 'Tool completed (no output).' }],
      metadata: baseMetadata,
    };
  }

  const outcome = params.wireResult.outcome;
  const status: ToolResult['status'] =
    outcome === 'completed'
      ? 'completed'
      : outcome === 'denied'
        ? 'denied'
        : outcome === 'cancelled'
          ? 'aborted'
          : outcome === 'failed' || outcome === 'timeout'
            ? 'failed'
            : 'completed';

  const blocks: ToolResult['content'] = [];
  for (const item of params.wireResult.content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text') {
      blocks.push({ type: 'text', text: item.text });
    } else if (item.type === 'json') {
      blocks.push({ type: 'text', text: toDisplayText(item.data) });
    } else if (item.type === 'error') {
      const prefix = item.code ? `${item.code}: ` : '';
      blocks.push({ type: 'text', text: `${prefix}${item.message}`.trim() });
    } else if (item.type === 'image') {
      blocks.push({ type: 'image', data: item.data });
    }
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: 'Tool completed (no output).' });
  }

  const metadata: Record<string, unknown> = {
    ...baseMetadata,
    ...(params.wireResult.meta ?? {}),
    ...(outcome === 'timeout' ? { outcome: 'timeout' } : {}),
  };

  return {
    id: params.toolCallId,
    status,
    content: blocks,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function textFromTurnEndContent(content: TurnEndUpdate['content']): string {
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'tool_result') {
      parts.push(block.content);
    }
  }
  return parts.join('');
}

function processProtocolEvents(
  events: ProtocolEvent[],
  permissionEvents: PermissionRequestEvent[]
): ProcessedEvent[] {
  const processed: ProcessedEvent[] = [];

  const permissionByToolCallId = new Map<string, PermissionRequest>();
  for (const evt of permissionEvents) {
    permissionByToolCallId.set(evt.request.toolCallId, evt.request);
  }

  const currentTurnIdByAgent = new Map<string, string>();
  const derivedTurnIdByAgent = new Map<string, string>();

  const assistantByTurnKey = new Map<
    string,
    { id: string; timestamp: Date; content: string; transient: boolean; threadId: ThreadId }
  >();

  const toolByCallId = new Map<
    string,
    {
      id: string;
      timestamp: Date;
      call: ToolCall;
      result?: ToolResult;
      toolName: string;
      toolId?: string;
      arguments?: unknown;
      context: InternalTimelineEvent['context'];
    }
  >();

  const sorted = [...events].sort((a, b) => {
    const aSeq = (a.update as { streamSeq?: number }).streamSeq ?? 0;
    const bSeq = (b.update as { streamSeq?: number }).streamSeq ?? 0;
    return aSeq - bSeq;
  });

  for (const event of sorted) {
    const { update, id, timestamp, agentSessionId } = event;
    const threadId = agentSessionId as ThreadId;

    if (update.type === 'turn_start') {
      const turnStart = update as TurnStartUpdate;
      if (turnStart.turnId) {
        currentTurnIdByAgent.set(agentSessionId, turnStart.turnId);
        derivedTurnIdByAgent.delete(agentSessionId);
      }
      continue;
    }

    if (update.type === 'turn_end') {
      const turnEnd = update as TurnEndUpdate;
      const effectiveTurnId =
        turnEnd.turnId ??
        currentTurnIdByAgent.get(agentSessionId) ??
        derivedTurnIdByAgent.get(agentSessionId);
      if (effectiveTurnId) {
        const key = `${agentSessionId}:${effectiveTurnId}`;
        const existing = assistantByTurnKey.get(key);
        const turnText = textFromTurnEndContent(turnEnd.content);
        const stableId = existing?.id ?? `turn_${agentSessionId}_${effectiveTurnId}`;

        assistantByTurnKey.set(key, {
          id: stableId,
          timestamp: existing?.timestamp ?? timestamp,
          content: turnText || existing?.content || '',
          transient: false,
          threadId,
        });
      }

      currentTurnIdByAgent.delete(agentSessionId);
      derivedTurnIdByAgent.delete(agentSessionId);
      continue;
    }

    if (update.type === 'text_delta') {
      const textDelta = update as TextDeltaUpdate;
      let effectiveTurnId = textDelta.turnId ?? currentTurnIdByAgent.get(agentSessionId);

      if (!effectiveTurnId) {
        effectiveTurnId = derivedTurnIdByAgent.get(agentSessionId);
      }

      if (!effectiveTurnId) {
        const streamSeq = (textDelta as { streamSeq?: number }).streamSeq ?? 0;
        effectiveTurnId = `derived_${agentSessionId}_${streamSeq}`;
        derivedTurnIdByAgent.set(agentSessionId, effectiveTurnId);
      }

      const key = `${agentSessionId}:${effectiveTurnId}`;
      const existing = assistantByTurnKey.get(key);
      const stableId = existing?.id ?? `turn_${agentSessionId}_${effectiveTurnId}`;

      assistantByTurnKey.set(key, {
        id: stableId,
        timestamp: existing?.timestamp ?? timestamp,
        content: (existing?.content ?? '') + textDelta.text,
        transient: true,
        threadId,
      });
      continue;
    }

    if (update.type === 'tool_use') {
      const toolUse = update as ToolUseUpdate;
      const key = toolUse.toolCallId;
      const existing = toolByCallId.get(key);
      const permissionRequest = permissionByToolCallId.get(key);

      const call: ToolCall = {
        id: key,
        name: toolUse.name,
        arguments: toolUse.input,
      };

      const result = toAppToolResultForToolUse({
        toolCallId: key,
        status: toolUse.status,
        wireResult: toolUse.result,
        permissionRequest,
      });

      toolByCallId.set(key, {
        id: existing?.id ?? `tool_${key}`,
        timestamp: existing?.timestamp ?? timestamp,
        call,
        result,
        toolName: toolUse.name,
        toolId: key,
        arguments: toolUse.input,
        context: { threadId },
      });
      continue;
    }

    if (update.type === 'error') {
      const errorUpdate = update as ErrorUpdate;
      const errorEvent: InternalTimelineEvent = {
        id,
        timestamp,
        type: 'AGENT_ERROR',
        data: {
          errorType: errorUpdate.code,
          message: errorUpdate.message,
          isRetryable: false,
          context: { phase: errorUpdate.phase ?? 'unknown' },
        },
        context: { threadId },
      };
      processed.push(errorEvent);
      continue;
    }
  }

  for (const { id, timestamp, content, transient, threadId } of assistantByTurnKey.values()) {
    processed.push({
      id,
      timestamp,
      type: 'AGENT_MESSAGE',
      data: { content },
      transient,
      context: { threadId },
    });
  }

  for (const tool of toolByCallId.values()) {
    processed.push({
      id: tool.id,
      timestamp: tool.timestamp,
      type: 'TOOL_AGGREGATED',
      data: {
        call: tool.call,
        result: tool.result,
        toolName: tool.toolName,
        toolId: tool.toolId,
        arguments: tool.arguments,
      },
      context: tool.context,
    });
  }

  return processed;
}
