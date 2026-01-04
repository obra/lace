// ABOUTME: Tests for AI-powered conversation summarization compaction strategy
// ABOUTME: Validates summarization logic and event replacement behavior

import { describe, it, expect, vi } from 'vitest';
import { SummarizeCompactionStrategy } from './summarize-strategy';
import type { LaceEvent } from '@lace/core/threads/types';
import type { CompactionContext, CompactionData } from './types';
import type { AIProvider } from '@lace/core/providers/base-provider';

describe('SummarizeCompactionStrategy', () => {
  it('summarizes older non-user events and preserves all user messages + recent events', async () => {
    const strategy = new SummarizeCompactionStrategy();

    const agent = {
      generateSummary: vi.fn().mockResolvedValue('Summary of the earlier work'),
    };

    const context: CompactionContext = {
      threadId: 'test-thread',
      agent,
    };

    const events: LaceEvent[] = [
      { type: 'USER_MESSAGE', data: 'User message 1', context: { threadId: context.threadId } },
      {
        type: 'AGENT_MESSAGE',
        data: { content: 'Agent message 1' },
        context: { threadId: context.threadId },
      },
      {
        type: 'TOOL_CALL',
        data: { id: 't1', name: 'bash', arguments: { command: 'echo hi' } },
        context: { threadId: context.threadId },
      },
      {
        type: 'TOOL_RESULT',
        data: { id: 't1', status: 'completed', content: [{ type: 'text', text: 'hi' }] },
        context: { threadId: context.threadId },
      },
      {
        type: 'AGENT_MESSAGE',
        data: { content: 'Agent message 2' },
        context: { threadId: context.threadId },
      },
      { type: 'USER_MESSAGE', data: 'User message 2', context: { threadId: context.threadId } },
      {
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: 'Recent system note',
        context: { threadId: context.threadId },
      },
      {
        type: 'AGENT_MESSAGE',
        data: { content: 'Recent agent message' },
        context: { threadId: context.threadId },
      },
    ];

    const result = await strategy.compact(events, context);

    const compactionData = result.compactionEvent.data as unknown as CompactionData;
    expect(compactionData.strategyId).toBe('summarize');
    expect(compactionData.originalEventCount).toBe(events.length);

    expect(result.compactedEvents[0].type).toBe('USER_MESSAGE');
    expect(result.compactedEvents[0].data).toContain(
      '[Earlier in our conversation: Summary of the earlier work]'
    );

    const compactedTypes = result.compactedEvents.map((e) => e.type);
    expect(compactedTypes).toEqual([
      'USER_MESSAGE', // summary wrapper
      'USER_MESSAGE', // user 1
      'USER_MESSAGE', // user 2
      'LOCAL_SYSTEM_MESSAGE', // recent non-user #1
      'AGENT_MESSAGE', // recent non-user #2
    ]);

    expect(agent.generateSummary).toHaveBeenCalledTimes(1);
  });

  it('can summarize using a provider when agent is not available', async () => {
    const strategy = new SummarizeCompactionStrategy();

    const provider = {
      createResponse: vi.fn().mockResolvedValue({ content: 'Provider summary', toolCalls: [] }),
    } as unknown as AIProvider;

    const context: CompactionContext = { threadId: 'test-thread', provider };

    const events: LaceEvent[] = [
      {
        type: 'AGENT_MESSAGE',
        data: { content: 'Old agent message' },
        context: { threadId: context.threadId },
      },
      {
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: 'Old system note',
        context: { threadId: context.threadId },
      },
      {
        type: 'AGENT_MESSAGE',
        data: { content: 'Recent agent message' },
        context: { threadId: context.threadId },
      },
    ];

    const result = await strategy.compact(events, context);
    expect(result.compactedEvents[0].type).toBe('USER_MESSAGE');
    expect(result.compactedEvents[0].data).toContain(
      '[Earlier in our conversation: Provider summary]'
    );
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
  });
});
