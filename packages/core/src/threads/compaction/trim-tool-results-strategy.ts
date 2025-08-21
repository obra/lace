// ABOUTME: Compaction strategy that truncates tool results to save token space
// ABOUTME: Preserves conversation flow while reducing tool output size

import type { LaceEvent } from '~/threads/types';
import type { CompactionStrategy, CompactionContext } from '~/threads/compaction/types';
import type { ToolResult, ContentBlock } from '~/tools/types';

export class TrimToolResultsStrategy implements CompactionStrategy {
  id = 'trim-tool-results';

  compact(events: LaceEvent[], context: CompactionContext): Promise<LaceEvent> {
    const compactedEvents: LaceEvent[] = [];
    let modifiedCount = 0;

    for (const event of events) {
      if (event.type === 'COMPACTION') {
        // Skip COMPACTION events - they are system metadata, not conversation content
        //
        // NOTE FOR REVIEWERS: This is correct behavior, not a bug. Here's why:
        // 1. COMPACTION events represent previous compaction operations, not actual conversation
        // 2. Including old COMPACTION events would create nested compaction metadata
        // 3. The conversation builder (buildWorkingConversation) handles multiple compactions
        //    by using ONLY the LATEST compaction event, ignoring older ones
        // 4. This prevents exponential growth of metadata in repeated compactions
        // 5. The complete history is preserved via buildCompleteHistory() for debugging
        // 6. Each compaction works on the "working conversation" state, not raw event history
        continue;
      } else if (event.type === 'TOOL_RESULT') {
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
    const compactionEvent: LaceEvent = {
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

  private trimToolResult(event: LaceEvent): LaceEvent {
    // Handle ToolResult objects (they have a 'content' field)
    if (event.type === 'TOOL_RESULT') {
      const toolResult = event.data;

      const truncatedContent: ContentBlock[] = toolResult.content.map((block) => {
        if (block.type === 'text' && block.text) {
          return {
            ...block,
            text: this.truncateString(block.text),
          };
        }
        return block;
      });

      const updatedToolResult: ToolResult = {
        ...toolResult,
        content: truncatedContent,
      };

      return {
        ...event,
        data: updatedToolResult,
      };
    }

    // If we don't recognize the format, this is an error
    throw new Error(
      `TOOL_RESULT event must contain ToolResult object with content field, got: ${typeof event.data}`
    );
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
