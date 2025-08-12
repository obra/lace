// ABOUTME: AI-powered conversation summarization compaction strategy
// ABOUTME: Uses AI to create concise summaries of older conversation parts while preserving recent context

import type { LaceEvent } from '~/threads/types';
import type { CompactionStrategy, CompactionContext } from '~/threads/compaction/types';

export class SummarizeCompactionStrategy implements CompactionStrategy {
  id = 'summarize';

  // Keep the most recent N events to preserve immediate context
  private readonly RECENT_EVENT_COUNT = 2; // Last 2 events (usually 1 exchange)

  async compact(events: LaceEvent[], context: CompactionContext): Promise<LaceEvent> {
    if (!context.agent && !context.provider) {
      throw new Error('SummarizeCompactionStrategy requires an Agent instance or AI provider');
    }

    if (events.length === 0) {
      return this.createCompactionEvent([], context, undefined, 0);
    }

    // Filter out COMPACTION events (they're metadata, not conversation content)
    const conversationEvents = events.filter((event) => event.type !== 'COMPACTION');

    if (conversationEvents.length === 0) {
      return this.createCompactionEvent([], context, undefined, 0);
    }

    // Separate events into categories
    const allUserMessages = conversationEvents.filter((e) => e.type === 'USER_MESSAGE');
    const nonUserEvents = conversationEvents.filter((e) => e.type !== 'USER_MESSAGE');

    // Determine which non-user events to summarize vs preserve
    const { oldEvents, recentEvents } = this.categorizeEventsByCount(nonUserEvents);

    const compactedEvents: LaceEvent[] = [];

    // Generate summary for old non-user events if any exist
    let summary: string | undefined;
    if (oldEvents.length > 0) {
      summary = await this.generateSummaryInConversation(oldEvents, recentEvents, context);
    }

    // Preserve ALL user messages (they provide essential context)
    compactedEvents.push(...allUserMessages);

    // Add recent non-user events unchanged
    compactedEvents.push(...recentEvents);

    return this.createCompactionEvent(compactedEvents, context, summary, events.length);
  }

  private categorizeEventsByCount(events: LaceEvent[]) {
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

  private async generateSummaryInConversation(
    oldEvents: LaceEvent[],
    recentEvents: LaceEvent[],
    context: CompactionContext
  ): Promise<string> {
    const summaryRequest = this.createSummaryRequest(oldEvents, recentEvents);

    if (context.agent) {
      // Use the agent's full conversation context for better summaries
      const agent = context.agent;
      // Pass all events up to the compaction point for context
      return agent.generateSummary(summaryRequest, [...oldEvents, ...recentEvents]);
    } else if (context.provider) {
      // Fallback to provider-only summarization (sidebar approach)
      const response = await context.provider.createResponse(
        [{ role: 'user', content: summaryRequest }],
        [],
        'default'
      );
      return response.content;
    }

    throw new Error('No agent or provider available for summarization');
  }

  private createSummaryRequest(oldEvents: LaceEvent[], recentEvents: LaceEvent[]): string {
    const oldConversation = this.eventsToText(oldEvents);
    const recentContext = recentEvents.length > 0 ? this.eventsToText(recentEvents) : '';

    return `[SYSTEM: Conversation Compaction Required]

I need you to summarize the older parts of our conversation to reduce context size while preserving all important information. This summary will replace the older messages.

## Older Conversation to Summarize
${oldConversation}

${
  recentContext
    ? `## Recent Context (for reference, will be preserved as-is)
${recentContext}

`
    : ''
}## Summary Instructions

Create a comprehensive summary that captures ALL critical information from the older conversation. Structure your summary with these sections:

1. **User's Request**: What I originally asked for and what problem I'm solving
2. **Current Status**: What's been completed and what remains
3. **Technical Context**: Project type, tech stack, file structure, dependencies
4. **Changes Made**: Files created/modified with descriptions
5. **Issues & Solutions**: Problems encountered and how they were resolved
6. **Important State**: Variable names, IDs, partial implementations, next steps
7. **Working Context**: Current branch, uncommitted changes, pending decisions

Be thorough but concise. Focus on actionable information that enables you to continue helping me effectively. Remember: anything not in your summary will be lost.

Provide ONLY the summary, no preamble or explanation.`;
  }

  private eventsToText(events: LaceEvent[]): string {
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

  // Removed createSummaryEvent - summary is now part of COMPACTION event data

  private createCompactionEvent(
    compactedEvents: LaceEvent[],
    context: CompactionContext,
    summary: string | undefined,
    originalEventCount: number
  ): LaceEvent {
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
          summary,
          recentEventCount: this.RECENT_EVENT_COUNT,
          strategy: 'ai-powered-summarization',
          preservedUserMessages: compactedEvents.filter((e) => e.type === 'USER_MESSAGE').length,
        },
      },
    };
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
