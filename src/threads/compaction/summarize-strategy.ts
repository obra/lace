// ABOUTME: Basic summarization compaction strategy implementation
// ABOUTME: Groups old conversation segments and creates summary events

import { Thread, ThreadEvent } from '../types.js';
import { CompactionStrategy, CompactionConfig } from './types.js';

export class SummarizeStrategy implements CompactionStrategy {
  private config: CompactionConfig;

  constructor(config: CompactionConfig = {}) {
    this.config = {
      maxTokens: config.maxTokens || 8000,
      preserveRecentEvents: config.preserveRecentEvents || 10,
      preserveTaskEvents: config.preserveTaskEvents ?? true,
    };
  }

  shouldCompact(thread: Thread): boolean {
    const estimatedTokens = this.estimateTokens(thread.events);
    return estimatedTokens > this.config.maxTokens!;
  }

  compact(events: ThreadEvent[]): ThreadEvent[] {
    const totalEvents = events.length;
    const preserveCount = this.config.preserveRecentEvents!;
    
    // If we don't have enough events to warrant compaction, return as-is
    if (totalEvents <= preserveCount) {
      return [...events];
    }

    // Split events into compaction candidates and preserved events
    const eventsToCompact = events.slice(0, totalEvents - preserveCount);
    const preservedEvents = events.slice(totalEvents - preserveCount);

    // Group events for summarization (simple approach: group into chunks)
    const compactedEvents = this.createSummaryEvents(eventsToCompact);

    return [...compactedEvents, ...preservedEvents];
  }

  private createSummaryEvents(events: ThreadEvent[]): ThreadEvent[] {
    if (events.length === 0) return [];

    // Simple summarization: create one summary event for the compacted section
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    
    const summaryEvent: ThreadEvent = {
      id: `summary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      threadId: firstEvent.threadId,
      type: 'LOCAL_SYSTEM_MESSAGE',
      timestamp: lastEvent.timestamp,
      data: `📝 Summarized ${events.length} earlier messages from this conversation to save tokens.`,
    };

    return [summaryEvent];
  }

  private estimateTokens(events: ThreadEvent[]): number {
    let totalTokens = 0;

    for (const event of events) {
      const content = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
      // Rough approximation: 1 token ≈ 4 characters for English text
      totalTokens += Math.ceil(content.length / 4);
    }

    return totalTokens;
  }
}