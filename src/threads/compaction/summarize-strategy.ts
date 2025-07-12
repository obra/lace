// ABOUTME: Enhanced summarization compaction strategy with intelligent event preservation
// ABOUTME: Groups old conversation segments, preserves important events, and creates detailed summaries

import { Thread, ThreadEvent } from '~/threads/types';
import { CompactionStrategy, CompactionConfig } from '~/threads/compaction/types';
import { logger } from '~/utils/logger';
import { AIProvider, ProviderMessage } from '~/providers/base-provider';
import { estimateTokens } from '~/utils/token-estimation';
import { ToolResult } from '~/tools/types';

export class SummarizeStrategy implements CompactionStrategy {
  private config: CompactionConfig;
  private provider?: AIProvider;

  constructor(config: CompactionConfig = {}, provider?: AIProvider) {
    this.config = {
      maxTokens: config.maxTokens || 8000,
      preserveRecentEvents: config.preserveRecentEvents || 10,
      preserveTaskEvents: config.preserveTaskEvents ?? true,
    };
    this.provider = provider;
  }

  async shouldCompact(thread: Thread): Promise<boolean> {
    // Use provider-aware token counting when available, fallback to estimation
    const estimatedTokens = await this.estimateThreadTokens(thread.events);
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
    const eventsToProcess = events.slice(0, totalEvents - preserveCount);
    const recentEvents = events.slice(totalEvents - preserveCount);

    // Categorize events for intelligent preservation
    const { importantEvents, summarizableEvents } = this.categorizeEvents(eventsToProcess);

    // Create summary for summarizable events
    const summaryEvents = this.createSummaryEvents(summarizableEvents);

    // Return: summary + important events + recent events
    return [...summaryEvents, ...importantEvents, ...recentEvents];
  }

  private categorizeEvents(events: ThreadEvent[]): {
    importantEvents: ThreadEvent[];
    summarizableEvents: ThreadEvent[];
  } {
    const importantEvents: ThreadEvent[] = [];
    const summarizableEvents: ThreadEvent[] = [];

    for (const event of events) {
      if (this.config.preserveTaskEvents && this.isImportantEvent(event)) {
        // Truncate tool results to save space while preserving structure
        if (event.type === 'TOOL_RESULT') {
          importantEvents.push(this.truncateToolResult(event));
        } else {
          importantEvents.push(event);
        }
      } else {
        summarizableEvents.push(event);
      }
    }

    return { importantEvents, summarizableEvents };
  }

  private isImportantEvent(event: ThreadEvent): boolean {
    // Always preserve system prompts
    if (event.type === 'SYSTEM_PROMPT' || event.type === 'USER_SYSTEM_PROMPT') {
      return true;
    }

    // ALWAYS preserve user and agent messages - these form the core conversation
    if (event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE') {
      return true;
    }

    // ALWAYS preserve tool calls - they're small and needed for atomic pairing
    if (event.type === 'TOOL_CALL') {
      return true;
    }

    // ALWAYS preserve tool results - we'll truncate them to save space
    if (event.type === 'TOOL_RESULT') {
      return true;
    }

    // Preserve messages with task-related keywords (for other event types)
    if (typeof event.data === 'string') {
      const taskKeywords = [
        'TODO',
        'TASK',
        'FIXME',
        'BUG',
        'ERROR',
        'IMPORTANT',
        'CRITICAL',
        'ACTION ITEM',
        'DECISION',
        'REQUIREMENT',
        'SPEC',
        'ISSUE',
      ];
      const content = event.data.toUpperCase();
      return taskKeywords.some((keyword) => content.includes(keyword));
    }

    // Preserve tool call data structures with errors
    if (typeof event.data === 'object' && event.data !== null) {
      const dataStr = JSON.stringify(event.data).toUpperCase();
      return dataStr.includes('ERROR') || dataStr.includes('FAILED');
    }

    return false;
  }

  private createSummaryEvents(events: ThreadEvent[]): ThreadEvent[] {
    if (events.length === 0) return [];

    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    const originalTokens = this.fallbackTokenEstimation(events);

    // Create detailed summary with metrics
    const summaryContent = this.createDetailedSummary(events, originalTokens);

    const summaryEvent: ThreadEvent = {
      id: `summary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      threadId: firstEvent.threadId,
      type: 'LOCAL_SYSTEM_MESSAGE',
      timestamp: lastEvent.timestamp,
      data: summaryContent,
    };

    // Log compaction metrics - estimate summary tokens only once
    const summaryTokens = this.fallbackTokenEstimation([summaryEvent]);
    const compressionRatio =
      summaryTokens > 0 ? (originalTokens / summaryTokens).toFixed(2) : 'N/A';

    logger.info('Thread compaction summary created', {
      originalEvents: events.length,
      originalTokens,
      summaryTokens,
      compressionRatio,
      tokensSaved: originalTokens - summaryTokens,
    });

    return [summaryEvent];
  }

  private createDetailedSummary(events: ThreadEvent[], originalTokens: number): string {
    const toolCalls = events.filter((e) => e.type === 'TOOL_CALL');
    const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
    const otherEvents = events.filter((e) => e.type !== 'TOOL_CALL' && e.type !== 'TOOL_RESULT');

    let summary = `🗜️ **Compaction Summary** (${events.length} events, ~${originalTokens} tokens compressed)\n\n`;

    // Add time range
    if (events.length > 0) {
      const timeRange = this.formatTimeRange(
        events[0].timestamp,
        events[events.length - 1].timestamp
      );
      summary += `⏱️ **Period**: ${timeRange}\n`;
    }

    if (toolCalls.length > 0) {
      summary += `🔧 **Tool Operations**: ${toolCalls.length} calls with ${toolResults.length} results compressed\n`;

      // List unique tools used
      const toolNames = new Set(
        toolCalls.map((e) => {
          if (typeof e.data === 'object' && e.data && 'name' in e.data) {
            return (e.data as { name: string }).name;
          }
          return 'unknown';
        })
      );
      if (toolNames.size > 0) {
        summary += `   Tools used: ${Array.from(toolNames).join(', ')}\n`;
      }
    }

    if (otherEvents.length > 0) {
      const eventTypes = new Set(otherEvents.map((e) => e.type));
      summary += `📊 **Other Events**: ${otherEvents.length} events (${Array.from(eventTypes).join(', ')})\n`;
    }

    summary += `\n✨ **Note**: All user and agent messages preserved; only tool outputs and metadata compressed`;

    return summary;
  }

  // Enhanced token estimation that uses provider capabilities when available
  private async estimateThreadTokens(events: ThreadEvent[]): Promise<number> {
    if (this.provider) {
      try {
        // Build conversation from events to get accurate provider token count
        const conversation = this.buildConversationFromEvents(events);
        const providerCount = await this.provider.countTokens(conversation, []);

        if (providerCount !== null) {
          return providerCount;
        }
      } catch (error) {
        // Fall back to estimation if provider counting fails
        logger.debug('Provider token counting failed, using fallback', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.fallbackTokenEstimation(events);
  }

  private fallbackTokenEstimation(events: ThreadEvent[]): number {
    let totalTokens = 0;

    for (const event of events) {
      const content = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
      // Use the centralized estimation utility
      totalTokens += estimateTokens(content);
    }

    return totalTokens;
  }

  private formatTimeRange(start: Date, end: Date): string {
    const startTime = start instanceof Date ? start : new Date(start);
    const endTime = end instanceof Date ? end : new Date(end);
    const diffMs = endTime.getTime() - startTime.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 1) {
      return 'less than a minute';
    } else if (diffMins < 60) {
      return `${diffMins} minutes`;
    } else if (diffMins < 1440) {
      const hours = Math.round(diffMins / 60);
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      const days = Math.round(diffMins / 1440);
      return `${days} day${days > 1 ? 's' : ''}`;
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  private truncateToolResult(event: ThreadEvent): ThreadEvent {
    if (event.type !== 'TOOL_RESULT') return event;

    // Handle string data directly
    if (typeof event.data === 'string') {
      const lines = event.data.split('\n');
      if (lines.length <= 3) {
        return event; // No need to truncate
      }

      const truncatedLines = lines.slice(0, 3);
      truncatedLines.push('[results truncated to save space.]');
      const truncatedContent = truncatedLines.join('\n');

      return {
        ...event,
        data: truncatedContent,
      };
    }

    // Handle ToolResult data with ContentBlock[]
    if (typeof event.data === 'object' && event.data && 'content' in event.data) {
      const toolResult = event.data;
      const contentBlocks = toolResult.content;

      if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
        return event; // Return as-is if no content blocks
      }

      // Concatenate all text content from content blocks
      const fullText = contentBlocks
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('\n');

      const lines = fullText.split('\n');
      if (lines.length <= 3) {
        return event; // No need to truncate
      }

      const truncatedLines = lines.slice(0, 3);
      truncatedLines.push('[results truncated to save space.]');
      const truncatedContent = truncatedLines.join('\n');

      // Create new ToolResult with truncated content
      const truncatedToolResult: ToolResult = {
        ...toolResult,
        content: [
          {
            type: 'text',
            text: truncatedContent,
          },
        ],
      };

      return {
        ...event,
        data: truncatedToolResult,
      };
    }

    return event; // Return as-is if we can't handle the data format
  }

  // Build conversation from events (simplified version of Agent's method)
  private buildConversationFromEvents(events: ThreadEvent[]): ProviderMessage[] {
    const messages: ProviderMessage[] = [];

    for (const event of events) {
      if (event.type === 'USER_MESSAGE') {
        messages.push({
          role: 'user',
          content: event.data as string,
        });
      } else if (event.type === 'AGENT_MESSAGE') {
        messages.push({
          role: 'assistant',
          content: event.data as string,
        });
      } else if (event.type === 'TOOL_CALL') {
        // Tool calls are handled as part of assistant messages in the full implementation
        // For token estimation purposes, we can skip them as they're typically included in the assistant message
        continue;
      } else if (event.type === 'TOOL_RESULT') {
        // Tool results are handled as user messages in the full implementation
        // For token estimation purposes, we can skip them or include them as user messages
        let content = '';
        if (typeof event.data === 'string') {
          content = event.data;
        } else if (typeof event.data === 'object' && event.data && 'content' in event.data) {
          const toolResult = event.data;
          // Extract text from ContentBlock[]
          content = toolResult.content
            .filter((block) => block.type === 'text' && block.text)
            .map((block) => block.text)
            .join('\n');
        }

        if (content) {
          messages.push({
            role: 'user',
            content,
          });
        }
      }
      // Skip other event types for token estimation purposes
    }

    return messages;
  }
}
