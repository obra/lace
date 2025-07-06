// ABOUTME: O(1) incremental timeline processor for real-time event processing
// ABOUTME: Replaces ThreadProcessor to eliminate O(n) reprocessing performance issues

import { ThreadEvent } from '../threads/types.js';
import { ToolCall, ToolResult } from '../tools/types.js';
import { logger } from '../utils/logger.js';
import { Timeline, TimelineItem, TimelineProcessor } from './timeline-types.js';

interface PerformanceMetrics {
  totalAppendTime: number;
  appendCount: number;
  averageAppendTime: number;
  maxAppendTime: number;
  fastPathHits: number;
  slowPathHits: number;
}

export class StreamingTimelineProcessor implements TimelineProcessor {
  private _timeline: TimelineItem[] = [];
  private _pendingToolCalls = new Map<string, { event: ThreadEvent; call: ToolCall }>();
  private _eventCount = 0;
  private _version = 0; // Version counter for React updates
  private _changeCallback?: () => void; // Callback for React updates
  private _metrics: PerformanceMetrics = {
    totalAppendTime: 0,
    appendCount: 0,
    averageAppendTime: 0,
    maxAppendTime: 0,
    fastPathHits: 0,
    slowPathHits: 0,
  };

  /**
   * Append a single event for incremental processing (O(1))
   */
  appendEvent(event: ThreadEvent): void {
    const startTime = performance.now();

    logger.debug('StreamingTimelineProcessor.appendEvent', {
      eventType: event.type,
      eventId: event.id,
      threadId: event.threadId,
    });

    const newItems = this._processEvent(event);

    // For real-time events, insert in chronological order (O(1) for most cases)
    if (newItems.length > 0) {
      this._insertItemsInOrder(newItems);
      this._notifyChange(); // Notify React of timeline change
    }

    this._eventCount++;

    // Track performance metrics
    const endTime = performance.now();
    const appendTime = endTime - startTime;
    this._updateMetrics(appendTime);
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
    
    // Notify React of timeline change (only if we actually loaded events)
    if (events.length > 0) {
      this._notifyChange();
    }
  }

  /**
   * Get current timeline state
   */
  getTimeline(): Timeline {
    const messageCount = this._timeline.filter(
      (item) => item.type === 'user_message' || item.type === 'agent_message'
    ).length;

    const lastActivity =
      this._timeline.length > 0
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
    this._metrics = {
      totalAppendTime: 0,
      appendCount: 0,
      averageAppendTime: 0,
      maxAppendTime: 0,
      fastPathHits: 0,
      slowPathHits: 0,
    };
    this._notifyChange(); // Notify React of timeline reset
  }

  /**
   * Get current version for React dependency tracking
   */
  getVersion(): number {
    return this._version;
  }

  /**
   * Set callback for when timeline changes (for React updates)
   */
  setChangeCallback(callback: () => void): void {
    this._changeCallback = callback;
  }

  /**
   * Get performance metrics for monitoring
   */
  getMetrics(): PerformanceMetrics {
    return { ...this._metrics };
  }

  /**
   * Update performance metrics after append operation
   */
  private _updateMetrics(appendTime: number): void {
    this._metrics.totalAppendTime += appendTime;
    this._metrics.appendCount++;
    this._metrics.averageAppendTime = this._metrics.totalAppendTime / this._metrics.appendCount;
    this._metrics.maxAppendTime = Math.max(this._metrics.maxAppendTime, appendTime);
  }

  /**
   * Notify that timeline has changed (triggers React updates)
   */
  private _notifyChange(): void {
    this._version++;
    logger.debug('StreamingTimelineProcessor timeline changed', {
      version: this._version,
      itemCount: this._timeline.length,
      hasCallback: !!this._changeCallback,
    });
    if (this._changeCallback) {
      this._changeCallback();
    }
  }

  /**
   * Efficiently insert items maintaining chronological order (O(1) for ordered insertions)
   */
  private _insertItemsInOrder(newItems: TimelineItem[]): void {
    for (const item of newItems) {
      // Fast path: if timeline is empty or item belongs at the end (common case for real-time events)
      if (
        this._timeline.length === 0 ||
        item.timestamp.getTime() >= this._timeline[this._timeline.length - 1].timestamp.getTime()
      ) {
        this._timeline.push(item);
        this._metrics.fastPathHits++;
      } else {
        // Slow path: find insertion point (rare for real-time events)
        const insertIndex = this._findInsertionPoint(item.timestamp);
        this._timeline.splice(insertIndex, 0, item);
        this._metrics.slowPathHits++;
      }
    }
  }

  /**
   * Binary search to find insertion point for out-of-order events
   */
  private _findInsertionPoint(timestamp: Date): number {
    let left = 0;
    let right = this._timeline.length;
    const targetTime = timestamp.getTime();

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this._timeline[mid].timestamp.getTime() <= targetTime) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  /**
   * Process a single event into timeline items
   */
  private _processEvent(event: ThreadEvent): TimelineItem[] {
    switch (event.type) {
      case 'USER_MESSAGE': {
        return [
          {
            type: 'user_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
          },
        ];
      }

      case 'AGENT_MESSAGE': {
        return [
          {
            type: 'agent_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
          },
        ];
      }

      case 'LOCAL_SYSTEM_MESSAGE': {
        return [
          {
            type: 'system_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
            originalEventType: 'LOCAL_SYSTEM_MESSAGE',
          },
        ];
      }

      case 'SYSTEM_PROMPT': {
        return [
          {
            type: 'system_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
            originalEventType: 'SYSTEM_PROMPT',
          },
        ];
      }

      case 'USER_SYSTEM_PROMPT': {
        return [
          {
            type: 'system_message',
            content: event.data as string,
            timestamp: event.timestamp,
            id: event.id,
            originalEventType: 'USER_SYSTEM_PROMPT',
          },
        ];
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
          return [
            {
              type: 'tool_execution',
              call: pendingCall.call,
              result: toolResultData,
              timestamp: pendingCall.event.timestamp,
              callId: resultId,
            },
          ];
        } else {
          // Orphaned result - treat as system message
          logger.warn('Orphaned tool result found', {
            callId: resultId,
            output: toolResultData.content?.[0]?.text
              ? toolResultData.content?.[0]?.text?.slice(0, 100)
              : 'non-text output',
          });

          const resultText = toolResultData.content?.[0]?.text || '[non-text result]';
          return [
            {
              type: 'system_message',
              content: `Tool result (orphaned): ${resultText}`,
              timestamp: event.timestamp,
              id: event.id,
            },
          ];
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
