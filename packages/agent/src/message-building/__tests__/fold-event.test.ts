// ABOUTME: Unit tests for the pure foldEvent reducer — proves the canonical
// parallel-tool shape (one assistant with all tool_use, one user with all
// tool_result) and that an incremental fold equals a batch fold (seeded fuzz).
import { describe, it, expect } from 'vitest';
import {
  foldEvent,
  foldEvents,
  initialFoldState,
  type FoldEventInput,
} from '@lace/agent/message-building/fold-event';

const toolEvent = (id: string, v: string): FoldEventInput => ({
  type: 'tool_use' as const,
  data: {
    toolCallId: id,
    name: 'echo',
    input: { v },
    result: { outcome: 'completed', content: [{ type: 'text', text: v }] },
  },
});

describe('foldEvent canonical tool-batch shape', () => {
  it('two parallel calls fold into one assistant(2 calls) + one user(2 results)', () => {
    const events: FoldEventInput[] = [
      { type: 'message' as const, data: { content: 'doing two things' } },
      toolEvent('c1', 'a'),
      toolEvent('c2', 'b'),
    ];
    const { messages } = foldEvents(events);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'assistant', content: 'doing two things' });
    expect(messages[0]!.toolCalls?.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(messages[1]).toMatchObject({ role: 'user', content: '' });
    expect(messages[1]!.toolResults?.map((r) => r.id)).toEqual(['c1', 'c2']);
  });

  it('a single call+result folds into one assistant(1 call) + one user(1 result)', () => {
    const events: FoldEventInput[] = [
      { type: 'message' as const, data: { content: 'just one' } },
      toolEvent('c1', 'a'),
    ];
    const { messages } = foldEvents(events);
    expect(messages.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(messages[0]!.toolCalls?.map((c) => c.id)).toEqual(['c1']);
    expect(messages[1]!.toolResults?.map((r) => r.id)).toEqual(['c1']);
  });

  it('a message between two tool batches starts a fresh batch', () => {
    const events: FoldEventInput[] = [
      { type: 'message' as const, data: { content: 'first' } },
      toolEvent('c1', 'a'),
      { type: 'message' as const, data: { content: 'second' } },
      toolEvent('c2', 'b'),
    ];
    const { messages } = foldEvents(events);
    // assistant(first,c1), user(r1), assistant(second,c2), user(r2)
    expect(messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user']);
    expect(messages[0]!.toolCalls?.map((c) => c.id)).toEqual(['c1']);
    expect(messages[2]!.toolCalls?.map((c) => c.id)).toEqual(['c2']);
  });

  it('a prompt between two tool batches starts a fresh batch', () => {
    const events: FoldEventInput[] = [
      { type: 'message' as const, data: { content: 'first' } },
      toolEvent('c1', 'a'),
      { type: 'prompt' as const, data: { content: [{ type: 'text', text: 'next' }] } },
      { type: 'message' as const, data: { content: 'second' } },
      toolEvent('c2', 'b'),
    ];
    const { messages } = foldEvents(events);
    expect(messages.map((m) => m.role)).toEqual(['assistant', 'user', 'user', 'assistant', 'user']);
    expect(messages[0]!.toolCalls?.map((c) => c.id)).toEqual(['c1']);
    expect(messages[3]!.toolCalls?.map((c) => c.id)).toEqual(['c2']);
  });

  it('thinking blocks ride the assistant message', () => {
    const thinkingBlocks = [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }];
    const events: FoldEventInput[] = [
      { type: 'message' as const, data: { content: 'with thoughts', thinkingBlocks } },
      toolEvent('c1', 'a'),
    ];
    const { messages } = foldEvents(events);
    expect(messages[0]!.thinkingBlocks).toEqual(thinkingBlocks);
    expect(messages[0]!.toolCalls?.map((c) => c.id)).toEqual(['c1']);
  });

  it('keeps prompt content VERBATIM (image blocks not dropped)', () => {
    const content = [
      { type: 'text', text: 'see this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'xxx' } },
    ];
    const { messages } = foldEvents([{ type: 'prompt' as const, data: { content } }]);
    expect(messages[0]!.content).toEqual(content);
  });

  it('incremental fold equals batch fold', () => {
    const events: FoldEventInput[] = [
      { type: 'message' as const, data: { content: 'x' } },
      toolEvent('c1', 'a'),
      toolEvent('c2', 'b'),
      { type: 'prompt' as const, data: { content: [{ type: 'text', text: 'next' }] } },
    ];
    let s = initialFoldState();
    for (const e of events) s = foldEvent(s, e);
    expect(JSON.stringify(s.messages)).toBe(JSON.stringify(foldEvents(events).messages));
  });
});

describe('foldEvent incremental == batch (seeded fuzz)', () => {
  // Deterministic LCG (Numerical Recipes constants) — no Math.random so the
  // generated sequences are reproducible across runs.
  function makeRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function randomSequence(rng: () => number, length: number): FoldEventInput[] {
    const events: FoldEventInput[] = [];
    let callCounter = 0;
    for (let i = 0; i < length; i++) {
      const pick = rng();
      if (pick < 0.3) {
        events.push({ type: 'message', data: { content: `msg-${i}` } });
      } else if (pick < 0.5) {
        events.push({ type: 'prompt', data: { content: [{ type: 'text', text: `p-${i}` }] } });
      } else {
        // A tool batch of 1-4 calls, each with or without a result.
        const batchSize = 1 + Math.floor(rng() * 4);
        for (let b = 0; b < batchSize; b++) {
          const id = `c${callCounter++}`;
          const hasResult = rng() < 0.8;
          if (hasResult) {
            events.push(toolEvent(id, `v${id}`));
          } else {
            events.push({
              type: 'tool_use',
              data: { toolCallId: id, name: 'echo', input: { v: id } },
            });
          }
        }
      }
    }
    return events;
  }

  it('foldEvents(seq) equals folding one-by-one for many seeded sequences', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = makeRng(seed);
      const length = 5 + Math.floor(rng() * 20);
      const seq = randomSequence(rng, length);

      let s = initialFoldState();
      for (const e of seq) s = foldEvent(s, e);

      expect(JSON.stringify(s.messages)).toBe(JSON.stringify(foldEvents(seq).messages));
    }
  });
});
