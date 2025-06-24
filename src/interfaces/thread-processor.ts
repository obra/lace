// ABOUTME: Processes raw ThreadEvents into UI-optimized timeline format with performance optimizations
// ABOUTME: Split processing for cached thread events and frequent ephemeral message updates

import { ThreadEvent, ToolCallData, ToolResultData } from '../threads/types.js';
import sax from 'sax';
import { logger } from '../utils/logger.js';

export interface Timeline {
  items: TimelineItem[];
  metadata: {
    eventCount: number;
    messageCount: number;
    lastActivity: Date;
  };
}

export interface ProcessedThreads {
  mainTimeline: Timeline;
  delegateTimelines: Map<string, Timeline>;
}

export type TimelineItem =
  | { type: 'user_message'; content: string; timestamp: Date; id: string }
  | { type: 'agent_message'; content: string; timestamp: Date; id: string }
  | { type: 'thinking'; content: string; timestamp: Date; id: string }
  | {
      type: 'tool_execution';
      call: ToolCallData;
      result?: ToolResultData;
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

// Fast processing for streaming messages (can include thinking blocks from streaming)
export type EphemeralTimelineItems = (
  | Extract<TimelineItem, { type: 'ephemeral_message' }>
  | Extract<TimelineItem, { type: 'thinking' }>
)[];

export interface EphemeralMessage {
  type: 'user' | 'assistant' | 'system' | 'tool' | 'thinking';
  content: string;
  timestamp: Date;
}

export class ThreadProcessor {
  // Cache individual parsed events (expensive operations like thinking block extraction)
  private _eventCache = new Map<string, TimelineItem[]>();

  /**
   * Process multiple threads from mixed events into separate timelines (primary API)
   */
  processThreads(events: ThreadEvent[]): ProcessedThreads {
    logger.debug('ThreadProcessor.processThreads received events', {
      eventCount: events.length,
      events: events.map((e) => ({ type: e.type, threadId: e.threadId, id: e.id })),
    });

    // Group events by threadId
    const threadGroups = this._groupEventsByThread(events);
    logger.debug('Thread groups created', {
      groups: threadGroups.map((g) => ({ threadId: g.threadId, eventCount: g.events.length })),
    });

    // Separate main thread from delegates
    const mainThreadGroup = threadGroups.find((g) => !g.threadId.includes('.'));
    const mainEvents = mainThreadGroup?.events || [];
    const mainThreadId = mainThreadGroup?.threadId || 'main';
    const delegateGroups = threadGroups.filter((g) => g.threadId.includes('.'));

    logger.debug('Thread separation complete', {
      mainThreadId,
      mainEventCount: mainEvents.length,
      delegateThreads: delegateGroups.map((g) => ({
        threadId: g.threadId,
        eventCount: g.events.length,
      })),
    });

    // Process main thread with incremental caching
    const mainProcessedItems = this._processThreadIncremental(mainThreadId, mainEvents);
    const mainTimeline = this.buildTimeline(mainProcessedItems, []);

    // Process each delegate thread with incremental caching
    const delegateTimelines = new Map<string, Timeline>();
    for (const group of delegateGroups) {
      logger.debug('Processing delegate thread', {
        threadId: group.threadId,
        eventCount: group.events.length,
      });
      const processedItems = this._processThreadIncremental(group.threadId, group.events);
      const timeline = this.buildTimeline(processedItems, []);
      delegateTimelines.set(group.threadId, timeline);
      logger.debug('Delegate timeline created', {
        threadId: group.threadId,
        itemCount: timeline.items.length,
      });
    }

    logger.debug('processThreads complete', {
      mainTimelineItems: mainTimeline.items.length,
      delegateTimelineCount: delegateTimelines.size,
    });

    return {
      mainTimeline,
      delegateTimelines,
    };
  }

  /**
   * Process ephemeral messages (called frequently during streaming)
   * Extracts thinking blocks from streaming assistant messages
   */
  processEphemeralEvents(ephemeralMessages: EphemeralMessage[]): EphemeralTimelineItems {
    const items: EphemeralTimelineItems = [];

    for (const msg of ephemeralMessages) {
      if (msg.type === 'assistant' && msg.content) {
        // Extract thinking blocks from streaming assistant content
        const { content: cleanContent, thinkingBlocks } = this.extractThinkingBlocks(msg.content);

        // Add thinking blocks as separate items
        thinkingBlocks.forEach((thinkingContent, index) => {
          items.push({
            type: 'thinking' as const,
            content: thinkingContent,
            timestamp: new Date(msg.timestamp.getTime() + index), // Slight offset for ordering
            id: `${msg.timestamp.getTime()}_thinking_${index}`,
          });
        });

        // Add clean content if there's any
        if (cleanContent.trim()) {
          items.push({
            type: 'ephemeral_message' as const,
            messageType: msg.type,
            content: cleanContent,
            timestamp: new Date(msg.timestamp.getTime() + thinkingBlocks.length), // After thinking blocks
          });
        }
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
    // Deduplicate thinking blocks that appear in both sources
    const deduplicatedEvents = this._deduplicateThinkingBlocks(processedEvents);

    // Merge and sort chronologically
    const allItems: TimelineItem[] = [...deduplicatedEvents, ...ephemeralItems].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    // Calculate metadata
    const eventCount = deduplicatedEvents.length;
    const messageCount = deduplicatedEvents.filter(
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

  /**
   * Process events for backward compatibility with tests
   */
  processEvents(events: ThreadEvent[]): ProcessedThreadItems {
    // For backward compatibility, process as single thread
    const threadId = events[0]?.threadId || 'main';
    return this._processThreadIncremental(threadId, events);
  }

  /**
   * Process single thread for backward compatibility
   */
  processThread(events: ThreadEvent[], ephemeralMessages: EphemeralMessage[] = []): Timeline {
    const threadId = events[0]?.threadId || 'main';
    const processedEvents = this._processThreadIncremental(threadId, events);
    const ephemeralItems = this.processEphemeralEvents(ephemeralMessages);
    return this.buildTimeline(processedEvents, ephemeralItems);
  }

  private _processEventGroupWithState(
    events: ThreadEvent[],
    initialPendingToolCalls: Map<string, { event: ThreadEvent; call: ToolCallData }>
  ): {
    items: TimelineItem[];
    pendingToolCalls: Map<string, { event: ThreadEvent; call: ToolCallData }>;
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

          const rawContent = event.data as string;
          const { content: cleanContent, thinkingBlocks } = this.extractThinkingBlocks(rawContent);

          const eventItems: TimelineItem[] = [];

          // Add thinking blocks first (they come before the message)
          thinkingBlocks.forEach((thinking, index) => {
            eventItems.push({
              type: 'thinking',
              content: thinking,
              timestamp: new Date(event.timestamp.getTime() - (thinkingBlocks.length - index) * 10), // Slight offset for ordering
              id: `${event.id}_thinking_${index}`,
            });
          });

          // Add cleaned agent message
          if (cleanContent.trim()) {
            eventItems.push({
              type: 'agent_message',
              content: cleanContent,
              timestamp: event.timestamp,
              id: event.id,
            });
          }

          // Cache the processed items for this event
          this._eventCache.set(event.id, eventItems);
          items.push(...eventItems);
          break;
        }

        case 'THINKING': {
          // Check cache first
          const cachedThinking = this._eventCache.get(event.id);
          if (cachedThinking) {
            items.push(...cachedThinking);
            break;
          }

          const thinkingItem = {
            type: 'thinking' as const,
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
          };

          this._eventCache.set(event.id, [thinkingItem]);
          items.push(thinkingItem);
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
          const toolCallData = event.data as ToolCallData;
          logger.debug('Processing TOOL_CALL', {
            callId: toolCallData.callId,
            toolName: toolCallData.toolName,
          });
          pendingToolCalls.set(toolCallData.callId, { event, call: toolCallData });
          break;
        }

        case 'TOOL_RESULT': {
          const toolResultData = event.data as ToolResultData;
          const pendingCall = pendingToolCalls.get(toolResultData.callId);

          logger.debug('Processing TOOL_RESULT', {
            callId: toolResultData.callId,
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
              callId: toolResultData.callId,
            });
            pendingToolCalls.delete(toolResultData.callId);
          } else {
            // Orphaned result - treat as system message
            logger.warn('Orphaned tool result found', {
              callId: toolResultData.callId,
              availablePendingCallIds: Array.from(pendingToolCalls.keys()),
              output:
                typeof toolResultData.output === 'string'
                  ? toolResultData.output.slice(0, 100)
                  : 'non-string output',
            });
            items.push({
              type: 'system_message',
              content: `Tool result (orphaned): ${toolResultData.output}`,
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
        callId: call.callId,
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

  private extractThinkingBlocks(content: string): { content: string; thinkingBlocks: string[] } {
    const thinkingBlocks: string[] = [];
    let cleanContent = '';

    try {
      // Use SAX parser for consistent thinking block extraction
      const parser = sax.parser(false, { lowercase: true });
      let insideThinkTag = false;
      let thinkContent = '';
      let textBuffer = '';

      parser.onopentag = (tag) => {
        if (tag.name === 'think') {
          // Add any accumulated text before think tag
          cleanContent += textBuffer;
          textBuffer = '';
          insideThinkTag = true;
          thinkContent = '';
        }
        // Ignore root tag - it's just our wrapper
      };

      parser.ontext = (text) => {
        if (insideThinkTag) {
          thinkContent += text;
        } else {
          textBuffer += text;
        }
      };

      parser.onclosetag = (tagName) => {
        if (tagName === 'think' && insideThinkTag) {
          // Extract completed thinking block
          if (thinkContent.trim()) {
            thinkingBlocks.push(thinkContent.trim());
          }
          insideThinkTag = false;
          thinkContent = '';
        }
        // Ignore root tag - it's just our wrapper
      };

      parser.onerror = () => {
        // Parser error, fall back to regex
        throw new Error('SAX parser failed');
      };

      parser.onend = () => {
        // Add any remaining text
        cleanContent += textBuffer;

        // Handle incomplete thinking block (streaming edge case)
        if (insideThinkTag && thinkContent.trim()) {
          // For incomplete blocks, mark them as incomplete
          thinkingBlocks.push(`${thinkContent.trim()} [incomplete]`);
        }
      };

      // Parse the content - wrap in root element for well-formed XML
      parser.write(`<root>${content}</root>`).close();

      return { content: cleanContent.trim(), thinkingBlocks };
    } catch (error) {
      // If SAX parser fails, fall back to regex for robustness
      console.warn('SAX parser failed, falling back to regex:', error);
      const regex = /<think>([\s\S]*?)<\/think>/g;
      const blocks: string[] = [];
      let match;
      let clean = content;

      while ((match = regex.exec(content)) !== null) {
        blocks.push(match[1].trim());
      }

      clean = content.replace(regex, '').trim();
      return { content: clean, thinkingBlocks: blocks };
    }
  }

  /**
   * Deduplicate thinking blocks that appear in both THINKING events and extracted from AGENT_MESSAGE
   * Keeps the THINKING events (streaming source) over extracted blocks for chronological accuracy
   */
  private _deduplicateThinkingBlocks(items: ProcessedThreadItems): ProcessedThreadItems {
    const seenThinkingContent = new Set<string>();
    const deduplicatedItems: ProcessedThreadItems = [];

    // First pass: collect content from THINKING events (streaming source - preferred)
    for (const item of items) {
      if (item.type === 'thinking' && !item.id.includes('_thinking_')) {
        // This is from a THINKING ThreadEvent (streaming) - doesn't have _thinking_ pattern
        seenThinkingContent.add(item.content.trim());
        deduplicatedItems.push(item);
      }
    }

    // Second pass: add other items, skipping extracted thinking blocks that duplicate streaming ones
    for (const item of items) {
      if (item.type === 'thinking' && item.id.includes('_thinking_')) {
        // This is an extracted thinking block from AGENT_MESSAGE content
        if (!seenThinkingContent.has(item.content.trim())) {
          // Not a duplicate, add it
          deduplicatedItems.push(item);
        }
        // Skip duplicates - streaming version already added
      } else if (item.type !== 'thinking' || item.id.includes('_thinking_')) {
        // Not a thinking block, or is an extracted one (handled above), add non-thinking items
        deduplicatedItems.push(item);
      }
    }

    // Sort by timestamp to maintain chronological order
    return deduplicatedItems.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
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
