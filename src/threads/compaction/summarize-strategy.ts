// ABOUTME: AI-powered conversation summarization compaction strategy
// ABOUTME: Uses AI to create concise summaries of older conversation parts while preserving recent context

import type { ThreadEvent } from '~/threads/types';
import type { CompactionStrategy, CompactionContext } from '~/threads/compaction/types';

export class SummarizeCompactionStrategy implements CompactionStrategy {
  id = 'summarize';

  // Keep the most recent N events to preserve immediate context
  private readonly RECENT_EVENT_COUNT = 2; // Last 2 events (usually 1 exchange)

  async compact(events: ThreadEvent[], context: CompactionContext): Promise<ThreadEvent> {
    if (!context.provider) {
      throw new Error('SummarizeCompactionStrategy requires an AI provider');
    }

    if (events.length === 0) {
      return this.createCompactionEvent([], context, false, 0);
    }

    // Filter out COMPACTION events (they're metadata, not conversation content)
    const conversationEvents = events.filter((event) => event.type !== 'COMPACTION');

    if (conversationEvents.length === 0) {
      return this.createCompactionEvent([], context, false, 0);
    }

    // Separate old events (to summarize) from recent events (to preserve)
    const { oldEvents, recentEvents } = this.categorizeEventsByCount(conversationEvents);

    const compactedEvents: ThreadEvent[] = [];

    // Generate summary for old events if any exist
    if (oldEvents.length > 0) {
      const summary = await this.generateSummary(oldEvents, context);
      const summaryEvent = this.createSummaryEvent(summary, context.threadId);
      compactedEvents.push(summaryEvent);
    }

    // Add recent events unchanged
    compactedEvents.push(...recentEvents);

    return this.createCompactionEvent(
      compactedEvents,
      context,
      oldEvents.length > 0,
      events.length
    );
  }

  private categorizeEventsByCount(events: ThreadEvent[]) {
    // Only preserve recent events if we have enough events to make summarization worthwhile
    // If we have few events, summarize them all
    if (events.length <= this.RECENT_EVENT_COUNT + 1) {
      // Too few events - summarize everything
      return { oldEvents: events, recentEvents: [] };
    }

    // Keep the most recent events, summarize the rest
    const recentEvents = events.slice(-this.RECENT_EVENT_COUNT);
    const oldEvents = events.slice(0, -this.RECENT_EVENT_COUNT);

    return { oldEvents, recentEvents };
  }

  private async generateSummary(
    events: ThreadEvent[],
    context: CompactionContext
  ): Promise<string> {
    const conversationText = this.eventsToText(events);

    const summaryPrompt = `You are creating a summary of a coding conversation that will help you continue the conversation effectively. Include ALL important information needed to provide helpful assistance:

REQUIRED INFORMATION TO PRESERVE:
1. **Project Context**: What type of project/codebase is being worked on
2. **Technical Stack**: Languages, frameworks, tools mentioned  
3. **File Operations**: Files created, modified, or discussed
4. **Code Solutions**: Functions, classes, or algorithms implemented
5. **Dependencies**: Libraries, packages, or tools installed/configured
6. **Issues & Errors**: Problems encountered and their solutions
7. **User Preferences**: Coding style, patterns, or approaches the user prefers
8. **Current State**: What was accomplished and what's still needed
9. **Context Variables**: Important names, paths, or configuration values

Conversation to summarize:
${conversationText}

Provide a comprehensive summary that would allow you to continue helping this user effectively:`;

    const response = await context.provider!.createResponse(
      [{ role: 'user', content: summaryPrompt }],
      [], // No tools needed for summarization
      'default' // Use default model
    );

    return response.content;
  }

  private eventsToText(events: ThreadEvent[]): string {
    return events
      .map((event) => {
        switch (event.type) {
          case 'USER_MESSAGE':
            return `User: ${event.data}`;
          case 'AGENT_MESSAGE': {
            const agentData = typeof event.data === 'string' ? event.data : event.data.content;
            return `Assistant: ${agentData}`;
          }
          case 'TOOL_CALL':
            return `Tool called: ${event.data.name} with arguments: ${JSON.stringify(event.data.arguments)}`;
          case 'TOOL_RESULT': {
            const resultText = event.data.content
              .map((block: { type: string; text?: string }) =>
                block.type === 'text' && block.text ? block.text : '[non-text content]'
              )
              .join(' ');
            return `Tool result: ${resultText}`;
          }
          case 'LOCAL_SYSTEM_MESSAGE':
            return `System: ${event.data}`;
          default:
            return `[${event.type}]: ${JSON.stringify(event.data)}`;
        }
      })
      .join('\n');
  }

  private createSummaryEvent(summary: string, threadId: string): ThreadEvent {
    return {
      id: this.generateEventId(),
      threadId,
      type: 'LOCAL_SYSTEM_MESSAGE',
      timestamp: new Date(),
      data: `📝 Summary of previous conversation: ${summary}`,
    };
  }

  private createCompactionEvent(
    compactedEvents: ThreadEvent[],
    context: CompactionContext,
    summaryGenerated: boolean,
    originalEventCount: number
  ): ThreadEvent {
    return {
      id: this.generateEventId(),
      threadId: context.threadId,
      type: 'COMPACTION',
      timestamp: new Date(),
      data: {
        strategyId: this.id,
        originalEventCount,
        compactedEvents,
        metadata: {
          summaryGenerated,
          recentEventCount: this.RECENT_EVENT_COUNT,
          strategy: 'ai-powered-summarization',
        },
      },
    };
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
