// ABOUTME: Hook for processing LaceEvents for timeline display
// ABOUTME: Handles filtering, token aggregation, and tool call/result pairing

import { useMemo } from 'react';
import type { LaceEvent, ThreadId, ToolCall, ToolResult } from '@/types/core';

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

export type ProcessedEvent = LaceEvent | ProcessedToolEvent;

const MAX_STREAMING_MESSAGES = 100;

export function useProcessedEvents(
  events: LaceEvent[],
  selectedAgent?: ThreadId
): ProcessedEvent[] {
  return useMemo(() => {
    // 1. Filter events by selected agent
    const filtered = filterEventsByAgent(events, selectedAgent);

    // 2. Process streaming tokens (merge AGENT_TOKEN into AGENT_STREAMING)
    const afterStreaming = processStreamingTokens(filtered);

    // 3. Process tool call aggregation (merge TOOL_CALL and TOOL_RESULT)
    const processed = processToolCallAggregation(afterStreaming);

    return processed;
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
    return event.threadId === selectedAgent;
  });
}

function processStreamingTokens(events: LaceEvent[]): LaceEvent[] {
  const processed: LaceEvent[] = [];
  const streamingMessages = new Map<string, { content: string; timestamp: Date }>();

  for (const event of events) {
    if (event.type === 'AGENT_TOKEN') {
      // Accumulate tokens by threadId
      const key = event.threadId;
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
      streamingMessages.delete(event.threadId);
      processed.push(event);
    } else {
      // Regular event, keep as-is
      processed.push(event);
    }
  }

  // Add remaining streaming messages as AGENT_STREAMING events
  for (const [threadId, { content, timestamp }] of streamingMessages.entries()) {
    const streamingEvent: LaceEvent = {
      type: 'AGENT_STREAMING',
      threadId: threadId as ThreadId,
      timestamp: timestamp,
      data: { content },
      transient: true,
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
        event.data.id || `${event.threadId}-${event.timestamp}-${toolCallCounter++}`;
      pendingToolCalls.set(toolCallId, { call: event });
    } else if (event.type === 'TOOL_RESULT') {
      // Find matching tool call by ID
      const toolCallId = (event.data as any)?.toolCallId || (event.data as any)?.id;

      let matchingCall = toolCallId ? pendingToolCalls.get(toolCallId) : null;

      // If no exact match, find the oldest tool call without a result on the same thread
      if (!matchingCall) {
        const threadCalls = Array.from(pendingToolCalls.entries())
          .filter(([_, data]) => data.call.threadId === event.threadId && !data.result)
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
      threadId: call.threadId,
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
