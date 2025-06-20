// ABOUTME: Processes raw ThreadEvents into UI-optimized timeline format with performance optimizations
// ABOUTME: Split processing for cached thread events and frequent ephemeral message updates

import { ThreadEvent, ToolCallData, ToolResultData } from '../threads/types.js';
import sax from 'sax';

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
  | { type: 'thinking'; content: string; timestamp: Date; id: string }
  | {
      type: 'tool_execution';
      call: ToolCallData;
      result?: ToolResultData;
      timestamp: Date;
      callId: string;
    }
  | { type: 'system_message'; content: string; timestamp: Date; id: string }
  | { type: 'ephemeral_message'; messageType: string; content: string; timestamp: Date };

// Cached processed events (from persisted ThreadEvents)
export type ProcessedThreadItems = Exclude<TimelineItem, { type: 'ephemeral_message' }>[];

// Fast processing for streaming messages
export type EphemeralTimelineItems = Extract<TimelineItem, { type: 'ephemeral_message' }>[];

export interface EphemeralMessage {
  type: 'user' | 'assistant' | 'system' | 'tool' | 'thinking';
  content: string;
  timestamp: Date;
}

export class ThreadProcessor {
  // Cache for processed thread events - only recompute when events change
  private _cachedProcessedItems: ProcessedThreadItems | null = null;
  private _cachedEventsHash: string | null = null;

  /**
   * Process persisted ThreadEvents into timeline items (cacheable)
   * Only call when thread events actually change
   */
  processEvents(events: ThreadEvent[]): ProcessedThreadItems {
    // Check if we can use cached results
    const eventsHash = this._hashEvents(events);
    if (this._cachedEventsHash === eventsHash && this._cachedProcessedItems) {
      return this._cachedProcessedItems;
    }

    // Process events and cache result
    const processedItems = this._processThreadEvents(events);
    this._cachedProcessedItems = processedItems;
    this._cachedEventsHash = eventsHash;

    return processedItems;
  }

  /**
   * Process ephemeral messages (called frequently during streaming)
   */
  processEphemeralEvents(ephemeralMessages: EphemeralMessage[]): EphemeralTimelineItems {
    return ephemeralMessages.map((msg) => ({
      type: 'ephemeral_message' as const,
      messageType: msg.type,
      content: msg.content,
      timestamp: msg.timestamp,
    }));
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

  /**
   * Convenience method for full processing (when caching not needed)
   */
  processThread(events: ThreadEvent[], ephemeralMessages: EphemeralMessage[] = []): Timeline {
    const processedEvents = this.processEvents(events);
    const ephemeralItems = this.processEphemeralEvents(ephemeralMessages);
    return this.buildTimeline(processedEvents, ephemeralItems);
  }

  private _processThreadEvents(events: ThreadEvent[]): ProcessedThreadItems {
    const items: TimelineItem[] = [];
    const pendingToolCalls = new Map<string, { event: ThreadEvent; call: ToolCallData }>();

    for (const event of events) {
      switch (event.type) {
        case 'USER_MESSAGE':
          items.push({
            type: 'user_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
          });
          break;

        case 'AGENT_MESSAGE': {
          const rawContent = event.data as string;
          const { content: cleanContent, thinkingBlocks } = this.extractThinkingBlocks(rawContent);

          // Add thinking blocks first (they come before the message)
          thinkingBlocks.forEach((thinking, index) => {
            items.push({
              type: 'thinking',
              content: thinking,
              timestamp: new Date(event.timestamp.getTime() - (thinkingBlocks.length - index) * 10), // Slight offset for ordering
              id: `${event.id}_thinking_${index}`,
            });
          });

          // Add cleaned agent message
          if (cleanContent.trim()) {
            items.push({
              type: 'agent_message',
              content: cleanContent,
              timestamp: event.timestamp,
              id: event.id,
            });
          }
          break;
        }

        case 'THINKING':
          items.push({
            type: 'thinking',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
          });
          break;

        case 'LOCAL_SYSTEM_MESSAGE':
          items.push({
            type: 'system_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
          });
          break;

        case 'TOOL_CALL': {
          const toolCallData = event.data as ToolCallData;
          pendingToolCalls.set(toolCallData.callId, { event, call: toolCallData });
          break;
        }

        case 'TOOL_RESULT': {
          const toolResultData = event.data as ToolResultData;
          const pendingCall = pendingToolCalls.get(toolResultData.callId);

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

    return items as ProcessedThreadItems;
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
   * Create hash of events for caching comparison
   */
  private _hashEvents(events: ThreadEvent[]): string {
    // Simple hash based on event count and last event timestamp
    // More sophisticated hashing could be added if needed
    if (events.length === 0) return 'empty';

    const lastEvent = events[events.length - 1];
    return `${events.length}-${lastEvent.timestamp.getTime()}-${lastEvent.id}`;
  }

  /**
   * Clear cache (useful for testing or manual cache invalidation)
   */
  clearCache(): void {
    this._cachedProcessedItems = null;
    this._cachedEventsHash = null;
  }
}
