// ABOUTME: Processes raw ThreadEvents into UI-optimized timeline format with performance optimizations
// ABOUTME: Split processing for cached thread events and frequent ephemeral message updates

import { ThreadEvent } from '../threads/types.js';
import { ToolCall, ToolResult } from '../tools/types.js';
import { logger } from '../utils/logger.js';

export interface Timeline {
  items: TimelineItem[];
  metadata: {
    eventCount: number;
    messageCount: number;
    lastActivity: Date;
  };
}

export type TimelineItem =
  | { type: 'user_message'; content: string; timestamp: Date; id: string }
  | { type: 'agent_message'; content: string; timestamp: Date; id: string }
  | {
      type: 'tool_execution';
      call: ToolCall;
      result?: ToolResult;
      timestamp: Date;
      callId: string;
    }
  | {
      type: 'system_message';
      content: string;
      timestamp: Date;
      id: string;
      originalEventType?: string;
    }
  | { type: 'ephemeral_message'; messageType: string; content: string; timestamp: Date };

// Cached processed events (from persisted ThreadEvents)
export type ProcessedThreadItems = Exclude<TimelineItem, { type: 'ephemeral_message' }>[];

// Fast processing for streaming messages
export type EphemeralTimelineItems = Extract<TimelineItem, { type: 'ephemeral_message' }>[];

export interface EphemeralMessage {
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
}

export class ThreadProcessor {
  // Cache individual parsed events
  private _eventCache = new Map<string, TimelineItem[]>();

  /**
   * Process main thread from mixed events, ignoring delegate threads
   */
  processThreads(events: ThreadEvent[]): Timeline {
    logger.debug('ThreadProcessor.processThreads received events', {
      eventCount: events.length,
      events: events.map((e) => ({ type: e.type, threadId: e.threadId, id: e.id })),
    });

    // Group events by threadId and get main thread only
    const threadGroups = this._groupEventsByThread(events);

    // If all events are from a single thread (e.g., processing delegate thread in isolation),
    // treat that thread as the "main" thread for this processing context
    let mainThreadGroup = threadGroups.find((g) => !g.threadId.includes('.'));
    if (!mainThreadGroup && threadGroups.length === 1) {
      mainThreadGroup = threadGroups[0]; // Single thread (delegate) becomes "main" in this context
    }

    const mainEvents = mainThreadGroup?.events || [];
    const mainThreadId = mainThreadGroup?.threadId || 'main';

    // Process main thread with incremental caching
    const mainProcessedItems = this._processThreadIncremental(mainThreadId, mainEvents);
    return this.buildTimeline(mainProcessedItems, []);
  }

  /**
   * Process ephemeral messages (called frequently during streaming)
   * Processes streaming assistant messages
   */
  processEphemeralEvents(ephemeralMessages: EphemeralMessage[]): EphemeralTimelineItems {
    const items: EphemeralTimelineItems = [];

    for (const msg of ephemeralMessages) {
      if (msg.type === 'assistant' && msg.content) {
        // Keep full assistant content intact
        items.push({
          type: 'ephemeral_message' as const,
          messageType: msg.type,
          content: msg.content, // Full content
          timestamp: msg.timestamp,
        });
      } else {
        // Non-assistant messages or messages without content - pass through unchanged
        items.push({
          type: 'ephemeral_message' as const,
          messageType: msg.type,
          content: msg.content,
          timestamp: msg.timestamp,
        });
      }
    }

    return items;
  }

  /**
   * Build final timeline by merging processed events with ephemeral items
   */
  buildTimeline(
    processedEvents: ProcessedThreadItems,
    ephemeralItems: EphemeralTimelineItems
  ): Timeline {
    // Merge and sort chronologically
    const allItems: TimelineItem[] = [...processedEvents, ...ephemeralItems].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    // Calculate metadata
    const eventCount = processedEvents.length;
    const messageCount = processedEvents.filter(
      (item) => item.type === 'user_message' || item.type === 'agent_message'
    ).length;

    const lastActivity =
      allItems.length > 0
        ? new Date(Math.max(...allItems.map((item) => item.timestamp.getTime())))
        : new Date();

    return {
      items: allItems,
      metadata: {
        eventCount,
        messageCount,
        lastActivity,
      },
    };
  }

  private _processEventGroupWithState(
    events: ThreadEvent[],
    initialPendingToolCalls: Map<string, { event: ThreadEvent; call: ToolCall }>
  ): {
    items: TimelineItem[];
    pendingToolCalls: Map<string, { event: ThreadEvent; call: ToolCall }>;
  } {
    const items: TimelineItem[] = [];
    const pendingToolCalls = new Map(initialPendingToolCalls);

    logger.debug('Processing event group with state', {
      eventCount: events.length,
      initialPendingCallCount: initialPendingToolCalls.size,
      initialPendingCallIds: Array.from(initialPendingToolCalls.keys()),
    });

    for (const event of events) {
      switch (event.type) {
        case 'USER_MESSAGE': {
          items.push({
            type: 'user_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
          });
          break;
        }

        case 'AGENT_MESSAGE': {
          // Check cache first for this event
          const cached = this._eventCache.get(event.id);
          if (cached) {
            items.push(...cached);
            break;
          }

          // Create single agent message item with full content
          const eventItems: TimelineItem[] = [
            {
              type: 'agent_message',
              content: event.data as string, // Full content
              timestamp: event.timestamp,
              id: event.id,
            },
          ];

          // Cache the processed items for this event
          this._eventCache.set(event.id, eventItems);
          items.push(...eventItems);
          break;
        }

        case 'LOCAL_SYSTEM_MESSAGE': {
          items.push({
            type: 'system_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
            originalEventType: 'LOCAL_SYSTEM_MESSAGE',
          });
          break;
        }

        case 'SYSTEM_PROMPT': {
          items.push({
            type: 'system_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
            originalEventType: 'SYSTEM_PROMPT',
          });
          break;
        }

        case 'USER_SYSTEM_PROMPT': {
          items.push({
            type: 'system_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
            originalEventType: 'USER_SYSTEM_PROMPT',
          });
          break;
        }

        case 'TOOL_CALL': {
          const toolCallData = event.data as ToolCall;
          logger.debug('Processing TOOL_CALL', {
            callId: toolCallData.id,
            toolName: toolCallData.name,
          });
          pendingToolCalls.set(toolCallData.id, { event, call: toolCallData });
          break;
        }

        case 'TOOL_RESULT': {
          const toolResultData = event.data as ToolResult;
          const resultId = toolResultData.id || '';
          const pendingCall = pendingToolCalls.get(resultId);

          logger.debug('Processing TOOL_RESULT', {
            callId: resultId,
            foundPendingCall: !!pendingCall,
            pendingCallIds: Array.from(pendingToolCalls.keys()),
          });

          if (pendingCall) {
            // Add combined tool execution
            items.push({
              type: 'tool_execution',
              call: pendingCall.call,
              result: toolResultData,
              timestamp: pendingCall.event.timestamp,
              callId: resultId,
            });
            pendingToolCalls.delete(resultId);
          } else {
            // Orphaned result - treat as system message
            logger.warn('Orphaned tool result found', {
              callId: resultId,
              availablePendingCallIds: Array.from(pendingToolCalls.keys()),
              output: toolResultData.content?.[0]?.text
                ? toolResultData.content?.[0]?.text?.slice(0, 100)
                : 'non-text output',
            });
            const resultText = toolResultData.content?.[0]?.text || '[non-text result]';
            items.push({
              type: 'system_message',
              content: `Tool result (orphaned): ${resultText}`,
              timestamp: event.timestamp,
              id: event.id,
            });
          }
          break;
        }
      }
    }

    // Add any pending tool calls without results
    for (const { event, call } of pendingToolCalls.values()) {
      items.push({
        type: 'tool_execution',
        call,
        result: undefined,
        timestamp: event.timestamp,
        callId: call.id,
      });
    }

    return {
      items: items.filter((item) => item.type !== 'ephemeral_message'),
      pendingToolCalls,
    };
  }

  private _processEventGroup(events: ThreadEvent[]): TimelineItem[] {
    const { items } = this._processEventGroupWithState(events, new Map());
    return items;
  }

  /**
   * Process events for a specific thread (fresh thread organization, cached event parsing)
   */
  private _processThreadIncremental(threadId: string, events: ThreadEvent[]): ProcessedThreadItems {
    // Always do fresh thread organization and tool pairing to avoid duplication
    // But cache individual event parsing (the expensive part)
    const { items } = this._processEventGroupWithState(events, new Map());
    return items.filter((item) => item.type !== 'ephemeral_message') as ProcessedThreadItems;
  }

  /**
   * Clear cache (useful for testing or manual cache invalidation)
   */

  clearCache(): void {
    this._eventCache.clear();
  }

  /**
   * Check if setA is a superset of setB (contains all elements of setB)
   */
  private _isSuperset(setA: Set<string>, setB: Set<string>): boolean {
    for (const elem of setB) {
      if (!setA.has(elem)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Group all events by threadId (not just consecutive)
   */
  private _groupEventsByThread(
    events: ThreadEvent[]
  ): Array<{ threadId: string; events: ThreadEvent[] }> {
    const groupMap = new Map<string, ThreadEvent[]>();

    // Group all events by threadId
    for (const event of events) {
      if (!groupMap.has(event.threadId)) {
        groupMap.set(event.threadId, []);
      }
      groupMap.get(event.threadId)!.push(event);
    }

    // Convert to array format and sort each group by timestamp
    const groups: Array<{ threadId: string; events: ThreadEvent[] }> = [];
    for (const [threadId, events] of groupMap.entries()) {
      groups.push({
        threadId,
        events: events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
      });
    }

    // Sort groups by timestamp of first event in each group
    return groups.sort((a, b) => a.events[0].timestamp.getTime() - b.events[0].timestamp.getTime());
  }
}
