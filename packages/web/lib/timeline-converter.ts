// ABOUTME: Converts SessionEvent arrays to TimelineEntry format for design system
// ABOUTME: Handles event filtering, streaming token processing, and agent resolution
// TODO: This adapter exists because we have an impedance mismatch between SessionEvent and TimelineEntry.
// TODO: We should refactor to eliminate this conversion layer - either make TimelineEntry match SessionEvent
// TODO: or standardize on one event format throughout the system to avoid this translation step.

import type { AgentInfo } from '@/types/core';
import type { SessionEvent } from '@/types/web-sse';
import type { ToolCall } from '@/types/core';
import type { ThreadId } from '@/types/core';
import type { ToolResult } from '@/types/core';
import type { TimelineEntry } from '@/types/web-events';

export interface ConversionContext {
  agents: AgentInfo[];
  selectedAgent?: ThreadId;
}

const MAX_STREAMING_MESSAGES = 100;

export function convertSessionEventsToTimeline(
  events: SessionEvent[],
  context: ConversionContext
): TimelineEntry[] {
  // 1. Filter events by selected agent
  const filteredEvents = filterEventsByAgent(events, context.selectedAgent);

  // 2. Process streaming tokens (merge AGENT_TOKEN into AGENT_STREAMING)
  const processedEventsAfterStreaming = processStreamingTokens(filteredEvents);

  // 3. Process tool call aggregation (merge TOOL_CALL and TOOL_RESULT into single entries)
  const processedEvents = processToolCallAggregation(processedEventsAfterStreaming);

  // 4. Convert to TimelineEntry format
  return processedEvents.map((event, index) => convertEvent(event, index, context));
}

function filterEventsByAgent(events: SessionEvent[], selectedAgent?: ThreadId): SessionEvent[] {
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

function processStreamingTokens(events: SessionEvent[]): SessionEvent[] {
  const processed: SessionEvent[] = [];
  const streamingMessages = new Map<string, { content: string; timestamp: Date }>();

  for (const event of events) {
    if (event.type === 'AGENT_TOKEN') {
      // Accumulate tokens by threadId
      const key = event.threadId;
      const existing = streamingMessages.get(key);

      if (existing) {
        existing.content += event.data.token;
        existing.timestamp = event.timestamp;
      } else {
        streamingMessages.set(key, {
          content: event.data.token,
          timestamp: event.timestamp,
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
    const streamingEvent: SessionEvent = {
      type: 'AGENT_STREAMING',
      threadId: threadId as ThreadId,
      timestamp: timestamp,
      data: { content },
    };
    processed.push(streamingEvent);
  }

  // Sort by timestamp to maintain chronological order (optimized)
  if (processed.length <= 1) return processed;

  return processed.sort((a, b) => {
    // Optimize timestamp comparison - all timestamps are now strings
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return aTime - bTime;
  });
}

function processToolCallAggregation(events: SessionEvent[]): SessionEvent[] {
  const processed: SessionEvent[] = [];
  const pendingToolCalls = new Map<string, { call: SessionEvent; result?: SessionEvent }>();
  let toolCallCounter = 0; // Counter to ensure unique IDs for simultaneous calls

  for (const event of events) {
    if (event.type === 'TOOL_CALL') {
      // Extract tool call ID from the event data
      const eventData = event.data;
      const toolCallId =
        eventData?.id || `${event.threadId}-${event.timestamp}-${toolCallCounter++}`;
      pendingToolCalls.set(toolCallId, { call: event });
    } else if (event.type === 'TOOL_RESULT') {
      // Find matching tool call by ID or by proximity (most recent call on same thread)
      const eventData = event.data as unknown as { id?: string; toolCallId?: string };
      const toolCallId = eventData?.id || eventData?.toolCallId;

      let matchingCall = toolCallId ? pendingToolCalls.get(toolCallId) : null;

      // If no exact match, find the oldest tool call without a result on the same thread
      if (!matchingCall) {
        const threadCalls = Array.from(pendingToolCalls.entries())
          .filter(([_, data]) => data.call.threadId === event.threadId && !data.result)
          .sort(([_, a], [__, b]) => {
            const aTime = new Date(a.call.timestamp).getTime();
            const bTime = new Date(b.call.timestamp).getTime();
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
    // Create an aggregated tool event
    const callData = call.data as {
      toolName?: string;
      name?: string;
      id?: string;
      arguments?: unknown;
      input?: unknown;
      [key: string]: unknown;
    };

    const aggregatedEvent: SessionEvent = {
      type: 'TOOL_AGGREGATED',
      threadId: call.threadId,
      timestamp: call.timestamp,
      data: {
        call: call.data as ToolCall,
        result: result?.data as ToolResult | undefined,
        toolName: callData?.toolName || callData?.name || 'unknown',
        toolId: callData?.id,
        arguments: callData?.arguments || callData?.input,
      },
    };

    processed.push(aggregatedEvent);
  }

  // Sort by timestamp to maintain chronological order (optimized)
  if (processed.length <= 1) return processed;

  return processed.sort((a, b) => {
    // Optimize timestamp comparison - all timestamps are now strings
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return aTime - bTime;
  });
}

function convertEvent(
  event: SessionEvent,
  index: number,
  context: ConversionContext
): TimelineEntry {
  const agent = getAgentName(event.threadId, context.agents);
  const timestamp = new Date(event.timestamp);
  const id = `${event.threadId}-${timestamp.getTime()}-${index}`;

  switch (event.type) {
    case 'USER_MESSAGE':
      return {
        id,
        type: 'human',
        content: event.data.content,
        timestamp,
      };

    case 'AGENT_MESSAGE':
    case 'AGENT_STREAMING':
      return {
        id,
        type: 'ai',
        content: event.data.content,
        timestamp,
        agent: agent,
      };

    case 'TOOL_CALL':
      const toolCallData = event.data;
      return {
        id,
        type: 'tool',
        content: `Tool: ${toolCallData.name}`,
        tool: toolCallData.name,
        timestamp,
        agent: agent,
        metadata: {
          arguments: toolCallData.arguments,
          isToolCall: true,
        },
      };

    case 'TOOL_RESULT':
      // Pass through raw ToolResult object for rich UI handling
      return {
        id,
        type: 'tool',
        content: 'Tool Result',
        result: event.data,
        timestamp,
        agent: agent,
      };

    case 'TOOL_AGGREGATED':
      const toolData = event.data as {
        toolName?: string;
        toolId?: string;
        arguments?: unknown;
        call?: unknown;
        result?: ToolResult;
      };
      return {
        id,
        type: 'tool',
        content: `${toolData.toolName || 'Unknown Tool'}`,
        tool: toolData.toolName,
        result: toolData.result,
        timestamp,
        agent: agent,
        // Add extra metadata for rich rendering - match ToolAggregatedEventData structure
        metadata: {
          call: toolData.call as ToolCall,
          result: toolData.result,
          toolName: toolData.toolName || 'Unknown Tool',
          toolId: toolData.toolId,
          arguments: toolData.arguments,
        },
      };

    case 'LOCAL_SYSTEM_MESSAGE':
      return {
        id,
        type: 'admin',
        content: event.data.content,
        timestamp,
      };

    case 'SYSTEM_PROMPT':
      return {
        id,
        type: 'system-prompt',
        content: event.data.content,
        timestamp,
      };

    case 'USER_SYSTEM_PROMPT':
      return {
        id,
        type: 'user-system-prompt',
        content: event.data.content,
        timestamp,
      };

    default:
      // Fallback for unknown events - provide rich metadata for proper rendering
      const unknownEvent = event as {
        type: string;
        data?: unknown;
        threadId?: string;
        [key: string]: unknown;
      };
      return {
        id,
        type: 'unknown',
        eventType: unknownEvent.type,
        content:
          typeof unknownEvent.data === 'string'
            ? unknownEvent.data
            : JSON.stringify(unknownEvent.data, null, 2) ||
              `Unknown event of type: ${unknownEvent.type}`,
        timestamp,
        metadata: {
          originalType: unknownEvent.type,
          threadId: unknownEvent.threadId,
          // Include all event properties except the core ones we already handle
          ...Object.fromEntries(
            Object.entries(unknownEvent).filter(
              ([key]) => !['type', 'data', 'timestamp', 'threadId'].includes(key)
            )
          ),
        },
      };
  }
}

function getAgentName(threadId: ThreadId, agents: AgentInfo[]): string {
  const agent = agents.find((a) => a.threadId === threadId);
  if (agent) return agent.name;

  // Fallback: extract from threadId
  const parts = String(threadId).split('.');
  if (parts.length > 1) {
    const agentPart = parts.pop();
    // Handle both agent-X and X-agent patterns
    const cleanAgentPart = agentPart?.replace(/^agent-/, '')?.replace(/-agent$/, '') || 'unknown';
    return `Agent ${cleanAgentPart}`;
  }
  return 'Agent';
}
