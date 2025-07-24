// ABOUTME: Compaction strategy that truncates tool results to save token space
// ABOUTME: Preserves conversation flow while reducing tool output size

import type { ThreadEvent } from '~/threads/types';
import type { CompactionStrategy, CompactionContext } from '~/threads/compaction/types';

export class TrimToolResultsStrategy implements CompactionStrategy {
  id = 'trim-tool-results';

  compact(events: ThreadEvent[], context: CompactionContext): Promise<ThreadEvent> {
    const compactedEvents: ThreadEvent[] = [];
    let modifiedCount = 0;

    for (const event of events) {
      if (event.type === 'TOOL_RESULT') {
        // Trim tool result content
        const trimmedEvent = this.trimToolResult(event);
        compactedEvents.push(trimmedEvent);
        if (trimmedEvent.data !== event.data) {
          modifiedCount++;
        }
      } else {
        // Keep other events unchanged
        compactedEvents.push(event);
      }
    }

    // Create the compaction event with data in the data field
    const compactionEvent: ThreadEvent = {
      id: this.generateEventId(),
      threadId: context.threadId,
      type: 'COMPACTION',
      timestamp: new Date(),
      data: {
        strategyId: this.id,
        originalEventCount: events.length,
        compactedEvents,
        metadata: {
          toolResultsModified: modifiedCount,
          maxLines: 3,
          truncationMessage: '[results truncated to save space.]',
        },
      },
    };

    return Promise.resolve(compactionEvent);
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private trimToolResult(event: ThreadEvent): ThreadEvent {
    if (typeof event.data === 'string') {
      return {
        ...event,
        data: this.truncateString(event.data),
      };
    }

    // Handle ToolResult objects (they have a 'content' field)
    if (event.data && typeof event.data === 'object' && 'content' in event.data) {
      const toolResult = event.data as {
        content: Array<{ type: string; text?: string }>;
        [key: string]: unknown;
      };

      const truncatedContent = toolResult.content.map((block) => {
        if (block.type === 'text' && block.text) {
          return {
            ...block,
            text: this.truncateString(block.text),
          };
        }
        return block;
      });

      return {
        ...event,
        data: {
          ...toolResult,
          content: truncatedContent,
        },
      };
    }

    // If we don't recognize the format, return unchanged
    return event;
  }

  private truncateString(text: string): string {
    const lines = text.split('\n');
    if (lines.length <= 3) {
      return text; // No truncation needed
    }

    const truncatedLines = lines.slice(0, 3);
    truncatedLines.push('[results truncated to save space.]');
    return truncatedLines.join('\n');
  }
}
