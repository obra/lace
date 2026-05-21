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

    // 12 events: older portion will be summarized, recent 8-event tail must keep order.
    const events: LaceEvent[] = [
      userMsg('User message 1', threadId),
      agentMsg('Agent message 1', threadId),
      userMsg('User message 2', threadId),
      agentMsg('Agent message 2', threadId),
      // Below here are the events expected to end up in the recent tail (last 8).
      userMsg('User message 3', threadId),
      agentMsg('Agent message 3', threadId),
      toolCall('t1', threadId),
      toolResult('t1', threadId),
      agentMsg('Agent message 4', threadId),
      userMsg('User message 4', threadId),
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
    // With RECENT_EVENT_COUNT=8, the recent tail is the last 8 events.
    expect(result.compactedEvents.slice(1).map((e) => e.type)).toEqual([
      'USER_MESSAGE',
      'AGENT_MESSAGE',
      'TOOL_CALL',
      'TOOL_RESULT',
      'AGENT_MESSAGE',
      'USER_MESSAGE',
      'LOCAL_SYSTEM_MESSAGE',
      'AGENT_MESSAGE',
    ]);
  });

  it('snaps the boundary so a tool_use/tool_result pair stays together', async () => {
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    // With RECENT_EVENT_COUNT=8 the naive boundary lands at events.length-8.
    // Here that splits paired-1's tool_use (in OLD) from its tool_result (in
    // RECENT); the snap-left logic must shift the boundary to pull both into
    // the tail.
    const events: LaceEvent[] = [
      userMsg('one', threadId),
      // Naive boundary (events.length-8 = 2) lands between these two events —
      // splitting the pair. Snap-left must shift it to index 1.
      toolCall('paired-1', threadId),
      toolResult('paired-1', threadId),
      agentMsg('a1', threadId),
      userMsg('two', threadId),
      agentMsg('a2', threadId),
      userMsg('three', threadId),
      agentMsg('a3', threadId),
      userMsg('four', threadId),
      agentMsg('a4', threadId),
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

    // Ada-shape: the naive recent-N boundary cuts BETWEEN a tool_use and its
    // tool_result. The snap-left logic must shift the boundary so the
    // tool_result is never emitted without its tool_use.
    const events: LaceEvent[] = [
      userMsg('u0', threadId),
      agentMsg('a0', threadId),
      toolCall('tc-c', threadId), // would be in OLD with naive boundary
      // -- naive boundary lands here (events.length-8 = 3) --
      userMsg('u1', threadId),
      userMsg('u2', threadId),
      agentMsg('a1', threadId),
      userMsg('u3', threadId),
      toolResult('tc-c', threadId), // would be in RECENT with naive boundary — orphan!
      agentMsg('m3', threadId),
      userMsg('u4', threadId),
      agentMsg('a2', threadId),
    ];

    const result = await strategy.compact(events, context);

    const tail = result.compactedEvents.slice(1); // skip summary wrapper

    // For every TOOL_RESULT in the tail, the matching TOOL_CALL must also be in the tail.
    const tailToolCallIds = new Set(
      tail.filter((e) => e.type === 'TOOL_CALL').map((e) => (e.data as { id: string }).id)
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

    // 12 events so that, with RECENT_EVENT_COUNT=8, events [0..3] land in OLD
    // and the 'one'/'two' user messages we assert on get summarized.
    const events: LaceEvent[] = [
      userMsg('one', threadId),
      agentMsg('a1', threadId),
      userMsg('two', threadId),
      agentMsg('a2', threadId),
      // -- naive boundary lands here (events.length-8 = 4) --
      agentMsg('recent-1', threadId),
      agentMsg('recent-2', threadId),
      agentMsg('recent-3', threadId),
      agentMsg('recent-4', threadId),
      agentMsg('recent-5', threadId),
      agentMsg('recent-6', threadId),
      agentMsg('recent-7', threadId),
      agentMsg('recent-8', threadId),
    ];

    const result = await strategy.compact(events, context);

    expect(agent.generateSummary).toHaveBeenCalledTimes(1);
    const summaryRequest = agent.generateSummary.mock.calls[0]![0] as string;
    expect(summaryRequest).toContain('User: one');
    expect(summaryRequest).toContain('User: two');

    expect(result.compactedEvents[0].data as string).toContain('SUMMARY-TEXT');
  });

  it('does not introduce orphans when recent tail starts with a chain of tool_uses without results', async () => {
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    // Conversation ends with two tool_uses whose results haven't arrived yet —
    // a real shape when the user is reviewing tool results or the turn was interrupted.
    const events: LaceEvent[] = [
      userMsg('u0', threadId),
      agentMsg('a0', threadId),
      userMsg('one', threadId),
      // -- naive boundary lands here (events.length-8 = 3) --
      agentMsg('a1', threadId),
      userMsg('two', threadId),
      agentMsg('a2', threadId),
      userMsg('three', threadId),
      agentMsg('a3', threadId),
      userMsg('four', threadId),
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

  it('preserves the most recent USER_MESSAGE and the preceding tool pairs verbatim (PRI-1719)', async () => {
    // After PRI-1712 the new algorithm only preserves RECENT_EVENT_COUNT events
    // verbatim. With the bumped count (>= 8) a typical mid-back-and-forth tail
    // ending in (USER_MESSAGE, TOOL_CALL, TOOL_RESULT, TOOL_CALL, TOOL_RESULT,
    // USER_MESSAGE) must survive intact: the last user request must NOT be lost
    // into the summary text, and each tool_call must stay adjacent to its
    // tool_result.
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    const events: LaceEvent[] = [
      userMsg('u0', threadId),
      agentMsg('a0', threadId),
      userMsg('u1', threadId),
      agentMsg('a1', threadId),
      userMsg('u2', threadId),
      agentMsg('a2', threadId),
      // -- naive boundary lands at events.length-8 = 6 --
      userMsg('penultimate', threadId),
      agentMsg('a3', threadId),
      userMsg('user request before the tool calls', threadId),
      toolCall('p1', threadId),
      toolResult('p1', threadId),
      toolCall('p2', threadId),
      toolResult('p2', threadId),
      userMsg('LAST USER REQUEST', threadId),
    ];

    const result = await strategy.compact(events, context);

    const tail = result.compactedEvents.slice(1);

    // The most recent USER_MESSAGE survives verbatim as the tail's last event.
    const lastTail = tail[tail.length - 1]!;
    expect(lastTail.type).toBe('USER_MESSAGE');
    expect(lastTail.data).toBe('LAST USER REQUEST');

    // The full focus shape from the brief is present at the tail of the tail.
    const tailTypes = tail.map((e) => e.type);
    expect(tailTypes.slice(-6)).toEqual([
      'USER_MESSAGE',
      'TOOL_CALL',
      'TOOL_RESULT',
      'TOOL_CALL',
      'TOOL_RESULT',
      'USER_MESSAGE',
    ]);

    // Each TOOL_RESULT sits immediately after its matching TOOL_CALL.
    for (let i = 0; i < tail.length; i++) {
      const e = tail[i]!;
      if (e.type !== 'TOOL_RESULT') continue;
      const id = (e.data as { id: string }).id;
      const prev = tail[i - 1];
      expect(prev).toBeDefined();
      expect(prev!.type).toBe('TOOL_CALL');
      expect((prev!.data as { id: string }).id).toBe(id);
    }

    // The last verbatim user request must NOT have been folded into the
    // "Older Conversation to Summarize" section of the summary prompt —
    // that is the exact failure mode PRI-1719 was filed to prevent.
    expect(agent.generateSummary).toHaveBeenCalledTimes(1);
    const summaryRequest = agent.generateSummary.mock.calls[0]![0] as string;
    const olderSection = summaryRequest
      .split('## Older Conversation to Summarize')[1]!
      .split('## Recent Context')[0]!;
    expect(olderSection).not.toContain('LAST USER REQUEST');
  });

  it('keeps a worst-case 8-event tail under a reasonable char budget (sanity check)', async () => {
    // Order-of-magnitude check: a worst-case-ish 8-event tail, where every
    // event carries ~8KB of text (realistic upper bound for a hefty
    // tool_result with a long file read or grep dump), still fits inside the
    // documented budget. We use serialized character length as a proxy for
    // tokens.
    //
    // Budget: 80KB ≈ ~20K tokens (rough 4-chars-per-token approximation),
    // which still leaves the rest of a 200K-token context window for the
    // summary wrapper and system prompt. The synthetic tail below produces
    // ~56KB — ~70% of the budget — so this assertion would actually fail if
    // the strategy accidentally duplicated events or kept materially more
    // than 8 in the tail.
    const TAIL_CHAR_BUDGET = 80 * 1024;
    const BULK = 'x'.repeat(8 * 1024);

    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    const events: LaceEvent[] = [
      userMsg('older 1', threadId),
      agentMsg('older 2', threadId),
      userMsg('older 3', threadId),
      agentMsg('older 4', threadId),
      // The 8-event tail, each event ~2KB:
      userMsg(`user ${BULK}`, threadId),
      agentMsg(`agent ${BULK}`, threadId),
      toolCall('tc-1', threadId),
      {
        type: 'TOOL_RESULT',
        data: { id: 'tc-1', status: 'completed', content: [{ type: 'text', text: BULK }] },
        context: { threadId },
      },
      agentMsg(`agent ${BULK}`, threadId),
      toolCall('tc-2', threadId),
      {
        type: 'TOOL_RESULT',
        data: { id: 'tc-2', status: 'completed', content: [{ type: 'text', text: BULK }] },
        context: { threadId },
      },
      userMsg(`user ${BULK}`, threadId),
    ];

    const result = await strategy.compact(events, context);

    const tail = result.compactedEvents.slice(1);
    expect(tail).toHaveLength(8);

    const tailChars = tail.reduce((acc, e) => acc + JSON.stringify(e.data).length, 0);
    expect(tailChars).toBeLessThan(TAIL_CHAR_BUDGET);
  });

  it('keeps short conversations entirely verbatim — never replaces a small conversation with just a summary blob', async () => {
    // Regression guard for adversarial finding F1: the previous early-return
    // guard short-circuited any conversation with <= RECENT_EVENT_COUNT+1
    // events into "summarize everything, emit no recent tail". When the
    // constant moved from 2 to 8 that swallowed conversations up to 9 events
    // long, leaving the user with a synthetic summary wrapper and zero
    // verbatim history — the exact failure mode PRI-1719 was filed to fix,
    // just at a different size. A short conversation should keep all of its
    // events verbatim and produce no summary call.
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    const events: LaceEvent[] = [
      userMsg('one', threadId),
      agentMsg('a1', threadId),
      userMsg('two', threadId),
      agentMsg('a2', threadId),
      userMsg('three', threadId),
      agentMsg('a3', threadId),
      userMsg('four', threadId),
      userMsg('LAST USER REQUEST', threadId),
    ];

    const result = await strategy.compact(events, context);

    // No summary call was made: the conversation is short enough to keep
    // entirely verbatim.
    expect(agent.generateSummary).not.toHaveBeenCalled();

    // No synthetic "[Earlier in our conversation: …]" wrapper was inserted.
    expect(result.compactedEvents.map((e) => e.data)).not.toContain(
      expect.stringMatching(/^\[Earlier in our conversation:/)
    );

    // Every original event survives verbatim, in order.
    expect(result.compactedEvents).toHaveLength(events.length);
    expect(result.compactedEvents.map((e) => e.type)).toEqual(events.map((e) => e.type));
    const last = result.compactedEvents[result.compactedEvents.length - 1]!;
    expect(last.type).toBe('USER_MESSAGE');
    expect(last.data).toBe('LAST USER REQUEST');
  });

  it('snaps the boundary across multiple tool_use/tool_result pairs straddling the naive cut', async () => {
    // Regression coverage for adversarial finding F5: under the larger
    // RECENT_EVENT_COUNT window, the snap-left logic from PRI-1712 must still
    // walk past arbitrarily many bad boundaries. Here three tool_use events
    // and three tool_results straddle the naive boundary, so the snap has to
    // decrement the boundary three times to clear every orphan.
    const strategy = new SummarizeCompactionStrategy();
    const agent = { generateSummary: vi.fn().mockResolvedValue('summary') };
    const threadId = 'test-thread';
    const context: CompactionContext = { threadId, agent };

    const events: LaceEvent[] = [
      userMsg('one', threadId),
      agentMsg('a0', threadId),
      toolCall('a', threadId),
      toolCall('b', threadId),
      toolCall('c', threadId),
      // -- naive boundary lands here (events.length-8 = 5) --
      toolResult('a', threadId),
      toolResult('b', threadId),
      toolResult('c', threadId),
      agentMsg('a1', threadId),
      userMsg('two', threadId),
      agentMsg('a2', threadId),
      userMsg('three', threadId),
      agentMsg('a3', threadId),
    ];

    const result = await strategy.compact(events, context);

    const tail = result.compactedEvents.slice(1);
    // All three tool_calls and their tool_results must end up in the tail —
    // the snap-left loop has to step from boundary=5 down to boundary=2.
    const tailToolCallIds = new Set(
      tail.filter((e) => e.type === 'TOOL_CALL').map((e) => (e.data as { id: string }).id)
    );
    expect(tailToolCallIds).toEqual(new Set(['a', 'b', 'c']));
    for (const e of tail) {
      if (e.type === 'TOOL_RESULT') {
        const id = (e.data as { id: string }).id;
        expect(tailToolCallIds.has(id)).toBe(true);
      }
    }
  });

  it('can summarize using a provider when agent is not available', async () => {
    const strategy = new SummarizeCompactionStrategy();

    const provider = {
      createResponse: vi.fn().mockResolvedValue({ content: 'Provider summary', toolCalls: [] }),
    } as unknown as AIProvider;

    const context: CompactionContext = { threadId: 'test-thread', provider };

    // Enough events to actually exercise the split path — short conversations
    // are kept verbatim and would never invoke the provider.
    const threadId = 'test-thread';
    const events: LaceEvent[] = [
      agentMsg('Old agent message 1', threadId),
      userMsg('Old user message 1', threadId),
      agentMsg('Old agent message 2', threadId),
      userMsg('Old user message 2', threadId),
      // -- naive boundary lands at events.length-8 = 2 --
      agentMsg('Recent agent message 1', threadId),
      userMsg('Recent user message 1', threadId),
      agentMsg('Recent agent message 2', threadId),
      userMsg('Recent user message 2', threadId),
      agentMsg('Recent agent message 3', threadId),
      { type: 'LOCAL_SYSTEM_MESSAGE', data: 'Recent system note', context: { threadId } },
    ];

    const result = await strategy.compact(events, context);
    expect(result.compactedEvents[0].type).toBe('USER_MESSAGE');
    expect(result.compactedEvents[0].data).toContain(
      '[Earlier in our conversation: Provider summary]'
    );
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
  });
});
