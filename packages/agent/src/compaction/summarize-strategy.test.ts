// ABOUTME: Tests for AI-powered conversation summarization compaction strategy
// ABOUTME: Validates summarization logic, temporal ordering, and tool-pair adjacency

import { describe, it, expect, vi } from 'vitest';
import { SummarizeCompactionStrategy } from './summarize-strategy';
import type { LaceEvent } from '@lace/agent/threads/types';
import type { CompactionContext, CompactionData } from './types';
import type { AIProvider } from '@lace/agent/providers/base-provider';

function userMsg(text: string, threadId: string): LaceEvent {
  return { type: 'USER_MESSAGE', data: text, context: { threadId } };
}

function agentMsg(text: string, threadId: string): LaceEvent {
  return { type: 'AGENT_MESSAGE', data: { content: text }, context: { threadId } };
}

function toolCall(id: string, threadId: string): LaceEvent {
  return {
    type: 'TOOL_CALL',
    data: { id, name: 'bash', arguments: { command: 'echo hi' } },
    context: { threadId },
  };
}

function toolResult(id: string, threadId: string): LaceEvent {
  return {
    type: 'TOOL_RESULT',
    data: { id, status: 'completed', content: [{ type: 'text', text: 'ok' }] },
    context: { threadId },
  };
}

describe('SummarizeCompactionStrategy', () => {
  it('preserves the recent tail in original temporal order (no user/non-user split)', async () => {
    const strategy = new SummarizeCompactionStrategy();

    const agent = {
      generateSummary: vi.fn().mockResolvedValue('Summary of the earlier work'),
    };

    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    // 8 events: older portion will be summarized, recent tail must keep order.
    const events: LaceEvent[] = [
      userMsg('User message 1', threadId),
      agentMsg('Agent message 1', threadId),
      toolCall('t1', threadId),
      toolResult('t1', threadId),
      agentMsg('Agent message 2', threadId),
      userMsg('User message 2', threadId),
      { type: 'LOCAL_SYSTEM_MESSAGE', data: 'Recent system note', context: { threadId } },
      agentMsg('Recent agent message', threadId),
    ];

    const result = await strategy.compact(events, context);

    const compactionData = result.compactionEvent.data as unknown as CompactionData;
    expect(compactionData.strategyId).toBe('summarize');
    expect(compactionData.originalEventCount).toBe(events.length);

    // First emitted event is the summary wrapper as a USER_MESSAGE.
    expect(result.compactedEvents[0].type).toBe('USER_MESSAGE');
    expect(result.compactedEvents[0].data).toContain(
      '[Earlier in our conversation: Summary of the earlier work]'
    );

    // The remaining events are the recent tail, IN ORIGINAL ORDER.
    // With RECENT_EVENT_COUNT=2, the recent tail is the last 2 events.
    expect(result.compactedEvents.slice(1).map((e) => e.type)).toEqual([
      'LOCAL_SYSTEM_MESSAGE',
      'AGENT_MESSAGE',
    ]);
  });

  it('snaps the boundary so a tool_use/tool_result pair stays together', async () => {
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    // If the naive boundary (last 2 events) would put the TOOL_RESULT in recent
    // and its TOOL_CALL in old, the boundary must shift left to keep them together.
    const events: LaceEvent[] = [
      userMsg('one', threadId),
      agentMsg('a1', threadId),
      userMsg('two', threadId),
      agentMsg('a2', threadId),
      toolCall('paired-1', threadId), // would be in OLD with naive boundary
      toolResult('paired-1', threadId), // would be in RECENT with naive boundary (orphan!)
    ];

    const result = await strategy.compact(events, context);

    const tail = result.compactedEvents.slice(1);
    // After the snap, the TOOL_CALL and its TOOL_RESULT should both be in the tail.
    const tailTypes = tail.map((e) => e.type);
    expect(tailTypes).toContain('TOOL_CALL');
    expect(tailTypes).toContain('TOOL_RESULT');

    // The TOOL_RESULT must come after the TOOL_CALL in the tail.
    const callIdx = tailTypes.indexOf('TOOL_CALL');
    const resultIdx = tailTypes.indexOf('TOOL_RESULT');
    expect(resultIdx).toBeGreaterThan(callIdx);
    expect(resultIdx).toBe(callIdx + 1);
  });

  it('does not generate orphan tool_results in the recent tail (regression for Ada)', async () => {
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    // Ada-shape: the naive recent-2 boundary cuts BETWEEN a tool_use and its tool_result.
    // Old user/non-user split algorithm: nonUserEvents=[a1,tc-c,tr-c,m3], recentEvents=[tr-c,m3]
    // → tail emitted as [u1, u2, u3, tr-c, m3]: tr-c is orphaned (tc-c got summarized).
    const events: LaceEvent[] = [
      userMsg('u1', threadId),
      agentMsg('a1', threadId),
      userMsg('u2', threadId),
      toolCall('tc-c', threadId),
      userMsg('u3', threadId),
      toolResult('tc-c', threadId),
      agentMsg('m3', threadId),
    ];

    const result = await strategy.compact(events, context);

    const tail = result.compactedEvents.slice(1); // skip summary wrapper

    // For every TOOL_RESULT in the tail, the matching TOOL_CALL must also be in the tail.
    const tailToolCallIds = new Set(
      tail
        .filter((e) => e.type === 'TOOL_CALL')
        .map((e) => (e.data as { id: string }).id)
    );
    for (const e of tail) {
      if (e.type === 'TOOL_RESULT') {
        const id = (e.data as { id: string }).id;
        expect(tailToolCallIds.has(id)).toBe(true);
      }
    }
  });

  it('summary text is generated from the dropped (older) events', async () => {
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('SUMMARY-TEXT') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    const events: LaceEvent[] = [
      userMsg('one', threadId),
      agentMsg('a1', threadId),
      userMsg('two', threadId),
      agentMsg('a2', threadId),
      agentMsg('recent-1', threadId),
      agentMsg('recent-2', threadId),
    ];

    const result = await strategy.compact(events, context);

    expect(agent.generateSummary).toHaveBeenCalledTimes(1);
    const summaryRequest = agent.generateSummary.mock.calls[0]![0] as string;
    expect(summaryRequest).toContain('User: one');
    expect(summaryRequest).toContain('User: two');

    expect((result.compactedEvents[0].data as string)).toContain('SUMMARY-TEXT');
  });

  it('does not introduce orphans when recent tail starts with a chain of tool_uses without results', async () => {
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    // Conversation ends with two tool_uses whose results haven't arrived yet —
    // a real shape when the user is reviewing tool results or the turn was interrupted.
    const events: LaceEvent[] = [
      userMsg('one', threadId),
      agentMsg('a1', threadId),
      userMsg('two', threadId),
      agentMsg('a2', threadId),
      toolCall('open-1', threadId),
      toolCall('open-2', threadId),
    ];

    const result = await strategy.compact(events, context);

    const tail = result.compactedEvents.slice(1);
    // No TOOL_RESULTs at all, so no orphan possible.
    expect(tail.some((e) => e.type === 'TOOL_RESULT')).toBe(false);
    // The trailing tool_calls survive.
    const tailToolCallIds = tail
      .filter((e) => e.type === 'TOOL_CALL')
      .map((e) => (e.data as { id: string }).id);
    expect(tailToolCallIds).toContain('open-2');
  });

  it('can summarize using a provider when agent is not available', async () => {
    const strategy = new SummarizeCompactionStrategy();

    const provider = {
      createResponse: vi.fn().mockResolvedValue({ content: 'Provider summary', toolCalls: [] }),
    } as unknown as AIProvider;

    const context: CompactionContext = { threadId: 'test-thread', provider };

    const events: LaceEvent[] = [
      agentMsg('Old agent message', 'test-thread'),
      { type: 'LOCAL_SYSTEM_MESSAGE', data: 'Old system note', context: { threadId: 'test-thread' } },
      agentMsg('Recent agent message', 'test-thread'),
    ];

    const result = await strategy.compact(events, context);
    expect(result.compactedEvents[0].type).toBe('USER_MESSAGE');
    expect(result.compactedEvents[0].data).toContain(
      '[Earlier in our conversation: Provider summary]'
    );
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
  });
});
