// ABOUTME: Hook for processing LaceEvents and AppEvents for timeline display
// ABOUTME: Handles filtering, token aggregation, tool call/result pairing, and protocol events

import { useMemo } from 'react';
import type { LaceEvent, ThreadId, ToolCall, ToolResult } from '@lace/web/types/core';
import type { AppEvent, ProtocolEvent } from '@lace/web/types/app-events';
import { isProtocolEvent } from '@lace/web/types/app-events';
import type {
  TextDeltaUpdate,
  ToolUseUpdate,
  ErrorUpdate,
  ThinkingUpdate,
  SessionUpdate,
} from '@lace/web/types/protocol-events';

interface ProcessedToolEvent extends Omit<LaceEvent, 'type' | 'data'> {
  type: 'TOOL_AGGREGATED';
  data: {
    call: ToolCall;
    result?: ToolResult;
    toolName: string;
    toolId?: string;
    arguments?: unknown;
  };
}

interface ProcessedProtocolTextEvent {
  id: string;
  timestamp: Date;
  type: 'PROTOCOL_TEXT';
  data: {
    content: string;
    agentSessionId: string;
  };
}

interface ProcessedProtocolToolEvent {
  id: string;
  timestamp: Date;
  type: 'PROTOCOL_TOOL';
  data: {
    name: string;
    toolCallId: string;
    input?: unknown;
    status: 'pending' | 'completed';
    result?: unknown;
    agentSessionId: string;
  };
}

interface ProcessedProtocolErrorEvent {
  id: string;
  timestamp: Date;
  type: 'PROTOCOL_ERROR';
  data: {
    code: string;
    message: string;
    phase?: string;
    agentSessionId: string;
  };
}

interface ProcessedProtocolThinkingEvent {
  id: string;
  timestamp: Date;
  type: 'PROTOCOL_THINKING';
  data: {
    text: string;
    agentSessionId: string;
  };
}

export type ProcessedEvent =
  | LaceEvent
  | ProcessedToolEvent
  | ProcessedProtocolTextEvent
  | ProcessedProtocolToolEvent
  | ProcessedProtocolErrorEvent
  | ProcessedProtocolThinkingEvent;

const MAX_STREAMING_MESSAGES = 100;

export function useProcessedEvents(
  events: Array<LaceEvent | AppEvent>,
  selectedAgent?: ThreadId
): ProcessedEvent[] {
  return useMemo(() => {
    // 1. Separate protocol events from legacy lace events
    const laceEvents = events.filter((e) => !isProtocolEvent(e)) as LaceEvent[];
    const protocolEvents = events.filter((e) => isProtocolEvent(e)) as ProtocolEvent[];

    // 2. Process legacy LaceEvents
    const filtered = filterEventsByAgent(laceEvents, selectedAgent);
    const afterStreaming = processStreamingTokens(filtered);
    const processedLaceEvents = processToolCallAggregation(afterStreaming);

    // 3. Process protocol events
    const processedProtocolEvents = processProtocolEvents(protocolEvents);

    // 4. Merge both event streams and sort by timestamp
    const allEvents = [...processedLaceEvents, ...processedProtocolEvents];
    if (allEvents.length <= 1) return allEvents;

    return allEvents.sort((a, b) => {
      const aTime = (a.timestamp || new Date()).getTime();
      const bTime = (b.timestamp || new Date()).getTime();
      return aTime - bTime;
    });
  }, [events, selectedAgent]);
}

function filterEventsByAgent(events: LaceEvent[], selectedAgent?: ThreadId): LaceEvent[] {
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

function processStreamingTokens(events: LaceEvent[]): LaceEvent[] {
  const processed: LaceEvent[] = [];
  const streamingMessages = new Map<string, { content: string; timestamp: Date }>();

  for (const event of events) {
    if (event.type === 'USER_MESSAGE') {
      // New user message starts a new turn - clear any pending streaming for this thread
      // This prevents tokens from different turns being combined
      const threadId = event.context?.threadId || '';
      streamingMessages.delete(threadId);
      processed.push(event);
    } else if (event.type === 'AGENT_TOKEN') {
      // Accumulate tokens by threadId
      const key = event.context?.threadId || '';
      const existing = streamingMessages.get(key);

      if (existing) {
        existing.content += event.data.token;
        existing.timestamp = event.timestamp || new Date();
      } else {
        streamingMessages.set(key, {
          content: event.data.token,
          timestamp: event.timestamp || new Date(),
        });
      }

      // Prevent unbounded growth
      if (streamingMessages.size > MAX_STREAMING_MESSAGES) {
        const oldestKey = streamingMessages.keys().next().value;
        if (oldestKey) {
          streamingMessages.delete(oldestKey);
        }
      }
    } else if (event.type === 'AGENT_MESSAGE') {
      // Complete message received, remove streaming version if exists
      streamingMessages.delete(event.context?.threadId || '');
      processed.push(event);
    } else {
      // Regular event, keep as-is
      processed.push(event);
    }
  }

  // Add remaining streaming messages as AGENT_STREAMING events
  for (const [threadId, { content, timestamp }] of streamingMessages.entries()) {
    // Use stable ID based on threadId only - content changes shouldn't create new events
    // This ensures React treats streaming updates as updates to the same element
    const streamingEvent: LaceEvent = {
      id: `streaming_${threadId}`,
      type: 'AGENT_STREAMING',
      timestamp: timestamp,
      data: { content },
      transient: true,
      context: { threadId: threadId as ThreadId },
    };
    processed.push(streamingEvent);
  }

  // Sort by timestamp to maintain chronological order
  if (processed.length <= 1) return processed;

  return processed.sort((a, b) => {
    const aTime = (a.timestamp || new Date()).getTime();
    const bTime = (b.timestamp || new Date()).getTime();
    return aTime - bTime;
  });
}

function processToolCallAggregation(events: LaceEvent[]): ProcessedEvent[] {
  const processed: ProcessedEvent[] = [];
  const pendingToolCalls = new Map<string, { call: LaceEvent; result?: LaceEvent }>();
  let toolCallCounter = 0;

  for (const event of events) {
    if (event.type === 'TOOL_CALL') {
      // Extract tool call ID from the event data
      const toolCallId =
        event.data.id || `${event.context?.threadId}-${event.timestamp}-${toolCallCounter++}`;
      pendingToolCalls.set(toolCallId, { call: event });
    } else if (event.type === 'TOOL_RESULT') {
      // Find matching tool call by ID - ToolResult has an id field
      const toolResult = event.data as ToolResult;
      const toolCallId = toolResult.id;

      let matchingCall = toolCallId ? pendingToolCalls.get(toolCallId) : null;

      // If no exact match, find the oldest tool call without a result on the same thread
      if (!matchingCall) {
        const threadCalls = Array.from(pendingToolCalls.entries())
          .filter(
            ([_, data]) => data.call.context?.threadId === event.context?.threadId && !data.result
          )
          .sort(([_, a], [__, b]) => {
            const aTime = (a.call.timestamp || new Date()).getTime();
            const bTime = (b.call.timestamp || new Date()).getTime();
            return aTime - bTime; // Oldest first (FIFO matching)
          });

        if (threadCalls.length > 0) {
          const [callId, callData] = threadCalls[0];
          matchingCall = callData;
          pendingToolCalls.set(callId, { ...callData, result: event });
        }
      } else if (toolCallId) {
        pendingToolCalls.set(toolCallId, { ...matchingCall, result: event });
      }
    } else {
      // Non-tool event, add as-is
      processed.push(event);
    }
  }

  // Add aggregated tool calls to processed events
  for (const { call, result } of pendingToolCalls.values()) {
    if (call.type !== 'TOOL_CALL') continue;

    const callData = call.data;
    const aggregatedEvent: ProcessedToolEvent = {
      id: call.id,
      timestamp: call.timestamp,
      type: 'TOOL_AGGREGATED',
      data: {
        call: callData,
        result: result?.type === 'TOOL_RESULT' ? result.data : undefined,
        toolName: callData.name || 'unknown',
        toolId: callData.id,
        arguments: callData.arguments,
      },
      transient: call.transient,
      context: call.context,
      // Preserve visibleToModel from either the call or result (use call's value if both exist)
      visibleToModel: call.visibleToModel ?? result?.visibleToModel,
    };

    processed.push(aggregatedEvent);
  }

  // Sort by timestamp to maintain chronological order
  if (processed.length <= 1) return processed;

  return processed.sort((a, b) => {
    const aTime = (a.timestamp || new Date()).getTime();
    const bTime = (b.timestamp || new Date()).getTime();
    return aTime - bTime;
  });
}

function processProtocolEvents(events: ProtocolEvent[]): ProcessedEvent[] {
  const processed: ProcessedEvent[] = [];
  const textDeltaMap = new Map<string, { content: string; latestId: string; timestamp: Date }>();
  const toolUseMap = new Map<string, { pending?: ProtocolEvent; completed?: ProtocolEvent }>();

  for (const event of events) {
    const { update, id, timestamp, agentSessionId } = event;

    if (update.type === 'text_delta') {
      const textDelta = update as TextDeltaUpdate;
      const key = agentSessionId;
      const existing = textDeltaMap.get(key);

      if (existing) {
        existing.content += textDelta.text;
        existing.latestId = id;
        existing.timestamp = timestamp;
      } else {
        textDeltaMap.set(key, {
          content: textDelta.text,
          latestId: id,
          timestamp,
        });
      }
    } else if (update.type === 'tool_use') {
      const toolUse = update as ToolUseUpdate;
      const key = toolUse.toolCallId;
      const existing = toolUseMap.get(key) ?? {};

      if (toolUse.status === 'pending') {
        existing.pending = event;
      } else if (toolUse.status === 'completed') {
        existing.completed = event;
      }

      toolUseMap.set(key, existing);
    } else if (update.type === 'error') {
      const errorUpdate = update as ErrorUpdate;
      const errorEvent: ProcessedProtocolErrorEvent = {
        id,
        timestamp,
        type: 'PROTOCOL_ERROR',
        data: {
          code: errorUpdate.code,
          message: errorUpdate.message,
          phase: errorUpdate.phase,
          agentSessionId,
        },
      };
      processed.push(errorEvent);
    } else if (update.type === 'thinking') {
      const thinkingUpdate = update as ThinkingUpdate;
      const thinkingEvent: ProcessedProtocolThinkingEvent = {
        id,
        timestamp,
        type: 'PROTOCOL_THINKING',
        data: {
          text: thinkingUpdate.text,
          agentSessionId,
        },
      };
      processed.push(thinkingEvent);
    }
  }

  // Convert aggregated text deltas to events
  for (const [agentSessionId, { content, latestId, timestamp }] of textDeltaMap) {
    const textEvent: ProcessedProtocolTextEvent = {
      id: latestId,
      timestamp,
      type: 'PROTOCOL_TEXT',
      data: {
        content,
        agentSessionId,
      },
    };
    processed.push(textEvent);
  }

  // Convert aggregated tool uses to events
  for (const [toolCallId, { pending, completed }] of toolUseMap) {
    const sourceEvent = completed ?? pending;
    if (!sourceEvent) continue;

    const toolUpdate = sourceEvent.update as ToolUseUpdate;
    const pendingUpdate = pending?.update as ToolUseUpdate | undefined;
    const completedUpdate = completed?.update as ToolUseUpdate | undefined;

    const toolEvent: ProcessedProtocolToolEvent = {
      id: sourceEvent.id,
      timestamp: sourceEvent.timestamp,
      type: 'PROTOCOL_TOOL',
      data: {
        name: toolUpdate.name ?? 'unknown',
        toolCallId,
        input: pendingUpdate?.input,
        status: completed ? 'completed' : 'pending',
        result: completedUpdate?.result,
        agentSessionId: sourceEvent.agentSessionId,
      },
    };
    processed.push(toolEvent);
  }

  return processed;
}
