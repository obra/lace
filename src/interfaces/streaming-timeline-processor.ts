// ABOUTME: O(1) incremental timeline processor for real-time event processing  
// ABOUTME: Replaces ThreadProcessor to eliminate O(n) reprocessing performance issues

import { ThreadEvent } from '../threads/types.js';
import { ToolCall, ToolResult } from '../tools/types.js';
import { logger } from '../utils/logger.js';
import { Timeline, TimelineItem, TimelineProcessor } from './timeline-types.js';

export class StreamingTimelineProcessor implements TimelineProcessor {
  private _timeline: TimelineItem[] = [];
  private _pendingToolCalls = new Map<string, { event: ThreadEvent; call: ToolCall }>();
  private _eventCount = 0;

  /**
   * Append a single event for incremental processing (O(1))
   */
  appendEvent(event: ThreadEvent): void {
    logger.debug('StreamingTimelineProcessor.appendEvent', {
      eventType: event.type,
      eventId: event.id,
      threadId: event.threadId,
    });

    const newItems = this._processEvent(event);
    this._timeline.push(...newItems);
    this._eventCount++;

    // Sort timeline to maintain chronological order
    this._timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Load events in bulk for session resumption (O(n), one time only)
   */
  loadEvents(events: ThreadEvent[]): void {
    logger.debug('StreamingTimelineProcessor.loadEvents', {
      eventCount: events.length,
    });

    this.reset();
    
    // Process events in chronological order
    const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    for (const event of sortedEvents) {
      const newItems = this._processEvent(event);
      this._timeline.push(...newItems);
      this._eventCount++;
    }

    // Add any pending tool calls without results
    for (const { event, call } of this._pendingToolCalls.values()) {
      this._timeline.push({
        type: 'tool_execution',
        call,
        result: undefined,
        timestamp: event.timestamp,
        callId: call.id,
      });
    }

    // Final sort to ensure chronological order
    this._timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get current timeline state
   */
  getTimeline(): Timeline {
    const messageCount = this._timeline.filter(
      (item) => item.type === 'user_message' || item.type === 'agent_message'
    ).length;

    const lastActivity = this._timeline.length > 0
      ? new Date(Math.max(...this._timeline.map((item) => item.timestamp.getTime())))
      : new Date();

    return {
      items: [...this._timeline], // Return copy to prevent external mutation
      metadata: {
        eventCount: this._eventCount,
        messageCount,
        lastActivity,
      },
    };
  }

  /**
   * Reset processor state
   */
  reset(): void {
    this._timeline = [];
    this._pendingToolCalls.clear();
    this._eventCount = 0;
  }

  /**
   * Process a single event into timeline items
   */
  private _processEvent(event: ThreadEvent): TimelineItem[] {
    switch (event.type) {
      case 'USER_MESSAGE': {
        return [{
          type: 'user_message',
          content: event.data as string,
          timestamp: event.timestamp,
          id: event.id,
        }];
      }

      case 'AGENT_MESSAGE': {
        return [{
          type: 'agent_message',
          content: event.data as string,
          timestamp: event.timestamp,
          id: event.id,
        }];
      }

      case 'LOCAL_SYSTEM_MESSAGE': {
        return [{
          type: 'system_message',
          content: event.data as string,
          timestamp: event.timestamp,
          id: event.id,
          originalEventType: 'LOCAL_SYSTEM_MESSAGE',
        }];
      }

      case 'SYSTEM_PROMPT': {
        return [{
          type: 'system_message',
          content: event.data as string,
          timestamp: event.timestamp,
          id: event.id,
          originalEventType: 'SYSTEM_PROMPT',
        }];
      }

      case 'USER_SYSTEM_PROMPT': {
        return [{
          type: 'system_message',
          content: event.data as string,
          timestamp: event.timestamp,
          id: event.id,
          originalEventType: 'USER_SYSTEM_PROMPT',
        }];
      }

      case 'TOOL_CALL': {
        const toolCallData = event.data as ToolCall;
        logger.debug('Processing TOOL_CALL', {
          callId: toolCallData.id,
          toolName: toolCallData.name,
        });
        
        // Store pending tool call
        this._pendingToolCalls.set(toolCallData.id, { event, call: toolCallData });
        return []; // No timeline item yet, waiting for result
      }

      case 'TOOL_RESULT': {
        const toolResultData = event.data as ToolResult;
        const resultId = toolResultData.id || '';
        const pendingCall = this._pendingToolCalls.get(resultId);

        logger.debug('Processing TOOL_RESULT', {
          callId: resultId,
          foundPendingCall: !!pendingCall,
        });

        if (pendingCall) {
          // Remove from pending and create combined tool execution
          this._pendingToolCalls.delete(resultId);
          return [{
            type: 'tool_execution',
            call: pendingCall.call,
            result: toolResultData,
            timestamp: pendingCall.event.timestamp,
            callId: resultId,
          }];
        } else {
          // Orphaned result - treat as system message
          logger.warn('Orphaned tool result found', {
            callId: resultId,
            output: toolResultData.content?.[0]?.text
              ? toolResultData.content?.[0]?.text?.slice(0, 100)
              : 'non-text output',
          });
          
          const resultText = toolResultData.content?.[0]?.text || '[non-text result]';
          return [{
            type: 'system_message',
            content: `Tool result (orphaned): ${resultText}`,
            timestamp: event.timestamp,
            id: event.id,
          }];
        }
      }

      default:
        logger.warn('Unknown event type in StreamingTimelineProcessor', {
          eventType: event.type,
          eventId: event.id,
        });
        return [];
    }
  }
}