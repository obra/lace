// ABOUTME: AI-powered conversation summarization compaction strategy
// ABOUTME: Uses AI to create concise summaries of older conversation parts while preserving recent context

import type { LaceEvent } from '@lace/agent/threads/types';
import type { CompactionStrategy, CompactionContext, CompactionResult } from './types';
import { generateEventId } from '@lace/agent/utils/generate-event-id';
import type { ToolCall, ToolResult } from '@lace/agent/tools/types';

export class SummarizeCompactionStrategy implements CompactionStrategy {
  id = 'summarize';

  // Keep the most recent N events verbatim to preserve immediate context.
  //
  // Why 8: a typical mid-conversation tail ends in something like
  // (USER_MESSAGE, TOOL_CALL, TOOL_RESULT, TOOL_CALL, TOOL_RESULT, USER_MESSAGE).
  // With N=2 the user's most recent verbatim request was lost into the summary
  // text. 8 covers the focus exchange plus one or two surrounding turns while
  // still leaving plenty of token-budget headroom (see the budget sanity test
  // in summarize-strategy.test.ts).
  //
  // Why an event count rather than a token budget: the strategy is
  // provider-agnostic and runs without a tokenizer in scope. A char/token
  // budget would require either threading a tokenizer through CompactionContext
  // or picking a per-provider heuristic — neither is small. The fixed count is
  // bounded above by the per-event size budget verified in the sanity test.
  private readonly RECENT_EVENT_COUNT = 8;

  async compact(events: LaceEvent[], context: CompactionContext): Promise<CompactionResult> {
    if (!context.agent && !context.provider) {
      throw new Error('SummarizeCompactionStrategy requires an Agent instance or AI provider');
    }

    if (events.length === 0) {
      return this.createCompactionResult([], context, undefined, 0);
    }

    // Filter out COMPACTION events (they're metadata, not conversation content)
    const conversationEvents = events.filter((event) => event.type !== 'COMPACTION');

    if (conversationEvents.length === 0) {
      return this.createCompactionResult([], context, undefined, 0);
    }

    // Pick the boundary in original temporal order, then snap leftward so the
    // boundary never cuts an assistant(tool_use) → user(tool_result) pair.
    const { oldEvents, recentEvents } = this.splitAtSnappedBoundary(conversationEvents);

    const compactedEvents: LaceEvent[] = [];

    // Generate summary for old events if any exist
    let summary: string | undefined;
    if (oldEvents.length > 0) {
      summary = await this.generateSummaryInConversation(oldEvents, recentEvents, context);

      // Create summary as a USER_MESSAGE event
      compactedEvents.push({
        type: 'USER_MESSAGE',
        data: `[Earlier in our conversation: ${summary}]`,
        context: { threadId: context.threadId },
      });
    }

    // Add recent events in their ORIGINAL temporal order. Do NOT segregate by
    // role — re-ordering destroys tool_use/tool_result adjacency.
    compactedEvents.push(...recentEvents);

    return this.createCompactionResult(compactedEvents, context, summary, events.length);
  }

  /**
   * Choose the boundary between old (summarized) and recent (preserved as-is)
   * events. Starts from `events.length - RECENT_EVENT_COUNT` and walks leftward
   * while any TOOL_RESULT in the recent slice has its matching TOOL_CALL in the
   * old slice — that would produce an orphan tool_result that Anthropic rejects.
   *
   * If the entire conversation fits inside the verbatim window, skip
   * summarization altogether: keep every event in the recent tail and emit no
   * summary wrapper. The alternative ("summarize everything") replaces the
   * conversation with a model-generated blob and loses the user's actual
   * messages — exactly the failure mode PRI-1719 was filed to prevent.
   */
  private splitAtSnappedBoundary(events: LaceEvent[]): {
    oldEvents: LaceEvent[];
    recentEvents: LaceEvent[];
  } {
    if (events.length <= this.RECENT_EVENT_COUNT) {
      return { oldEvents: [], recentEvents: events };
    }

    let boundary = events.length - this.RECENT_EVENT_COUNT;

    while (boundary > 0) {
      const oldCallIds = new Set<string>();
      for (let i = 0; i < boundary; i++) {
        const e = events[i]!;
        if (e.type === 'TOOL_CALL') {
          const id = (e.data as ToolCall).id;
          if (id) oldCallIds.add(id);
        }
      }

      let hasOrphan = false;
      for (let i = boundary; i < events.length; i++) {
        const e = events[i]!;
        if (e.type === 'TOOL_RESULT') {
          const id = (e.data as ToolResult).id;
          if (id && oldCallIds.has(id)) {
            hasOrphan = true;
            break;
          }
        }
      }

      if (!hasOrphan) break;
      boundary -= 1;
    }

    return {
      oldEvents: events.slice(0, boundary),
      recentEvents: events.slice(boundary),
    };
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

  private createCompactionResult(
    compactedEvents: LaceEvent[],
    context: CompactionContext,
    summary: string | undefined,
    originalEventCount: number
  ): CompactionResult {
    const compactionEvent: LaceEvent = {
      id: generateEventId(),
      type: 'COMPACTION',
      timestamp: new Date(),
      context: { threadId: context.threadId },
      data: {
        strategyId: this.id,
        originalEventCount,
        compactedEventCount: compactedEvents.length,
        metadata: {
          summary,
          recentEventCount: this.RECENT_EVENT_COUNT,
          strategy: 'ai-powered-summarization',
          preservedUserMessages: compactedEvents.filter((e) => e.type === 'USER_MESSAGE').length,
        },
      },
    };

    return {
      compactionEvent,
      compactedEvents,
    };
  }
}
