// ABOUTME: Converts SessionEvent arrays to TimelineEntry format for design system
// ABOUTME: Handles event filtering, streaming token processing, and agent resolution
// TODO: This adapter exists because we have an impedance mismatch between SessionEvent and TimelineEntry.
// TODO: We should refactor to eliminate this conversion layer - either make TimelineEntry match SessionEvent
// TODO: or standardize on one event format throughout the system to avoid this translation step.

import type { SessionEvent, Agent, ThreadId } from '@/types/api';
import type { TimelineEntry } from '@/types/design-system';

export interface ConversionContext {
  agents: Agent[];
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
  const processedEvents = processStreamingTokens(filteredEvents);

  // 3. Convert to TimelineEntry format
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
        existing.timestamp =
          event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);
      } else {
        streamingMessages.set(key, {
          content: event.data.token,
          timestamp: event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp),
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
      timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
      data: { content },
    };
    processed.push(streamingEvent);
  }

  // Sort by timestamp to maintain chronological order
  return processed.sort((a, b) => {
    const aTime =
      a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
    const bTime =
      b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
    return aTime - bTime;
  });
}

function convertEvent(
  event: SessionEvent,
  index: number,
  context: ConversionContext
): TimelineEntry {
  const agent = getAgentName(event.threadId, context.agents);
  const timestamp = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);
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
      return {
        id,
        type: 'tool',
        content: `Tool: ${event.data.toolName}`,
        tool: event.data.toolName,
        timestamp,
        agent: agent,
      };

    case 'TOOL_RESULT':
      return {
        id,
        type: 'tool',
        content: formatToolResult(event.data.result),
        result: formatToolResult(event.data.result),
        timestamp,
        agent: agent,
      };

    case 'THINKING':
      return {
        id,
        type: 'ai',
        content: `${agent} is thinking...`,
        timestamp,
        agent: agent,
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
        type: 'admin',
        content: `System prompt loaded`,
        timestamp,
      };

    case 'USER_SYSTEM_PROMPT':
      return {
        id,
        type: 'admin',
        content: `User instructions loaded`,
        timestamp,
      };

    default:
      // Fallback for unknown events
      return {
        id,
        type: 'admin',
        content: `Unknown event: ${(event as { type: string }).type}`,
        timestamp,
      };
  }
}

function getAgentName(threadId: ThreadId, agents: Agent[]): string {
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

function formatToolResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (result && typeof result === 'object') {
    return JSON.stringify(result, null, 2);
  }

  return String(result);
}
