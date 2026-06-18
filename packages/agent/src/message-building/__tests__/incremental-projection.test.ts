// ABOUTME: The correctness gate for the in-memory conversation projection:
// folding a tail of events incrementally into a cached projection MUST equal a
// full rebuild over the same events, at EVERY split point, across a corpus that
// exercises every rebuild-only concern (system-prompt last-wins, parallel-tool,
// thinking, context_injected merge, a context_compacted era + tail). The split-
// at-every-K differential is what proves the incremental boundary is order-
// independent — the same property the foldEvent fuzz proved, here for the FULL
// rebuild semantics.

import { describe, it, expect } from 'vitest';
import type { ParsedSessionEvent } from '@lace/agent/message-building/parsed-events';
import { buildProviderMessagesFromParsedEvents } from '@lace/agent/message-building/message-builder';
import {
  initialCachedProjection,
  foldTailIntoProjection,
} from '@lace/agent/message-building/incremental-projection';

function ev(eventSeq: number, type: string, data: Record<string, unknown>): ParsedSessionEvent {
  return { eventSeq, type, data };
}

// Corpus of event sequences, each a complete log prefix exercising one or more
// rebuild-only concerns. Seqs are monotonic within each sequence.
const CORPUS: ParsedSessionEvent[][] = [
  // 1. plain prompt/message
  [
    ev(1, 'system_prompt_set', { text: 'sys-a' }),
    ev(2, 'prompt', { content: [{ type: 'text', text: 'hello' }] }),
    ev(3, 'message', { content: [{ type: 'text', text: 'hi there' }] }),
    ev(4, 'turn_end', { stopReason: 'end_turn' }),
  ],
  // 2. single tool_use turn (assistant tool_use + user tool_result)
  [
    ev(1, 'system_prompt_set', { text: 'sys-b' }),
    ev(2, 'prompt', { content: [{ type: 'text', text: 'read a file' }] }),
    ev(3, 'tool_use', {
      toolCallId: 'tc1',
      name: 'file_read',
      input: { path: '/work/a.txt' },
      result: { outcome: 'completed', content: [{ type: 'text', text: 'A' }] },
    }),
    ev(4, 'message', { content: [{ type: 'text', text: 'done' }] }),
    ev(5, 'turn_end', { stopReason: 'end_turn' }),
  ],
  // 3. parallel-tool turn (two tool_use in one assistant batch)
  [
    ev(1, 'system_prompt_set', { text: 'sys-c' }),
    ev(2, 'prompt', { content: [{ type: 'text', text: 'read two' }] }),
    ev(3, 'tool_use', {
      toolCallId: 'tc1',
      name: 'file_read',
      input: { path: '/work/a.txt' },
      result: { outcome: 'completed', content: [{ type: 'text', text: 'A' }] },
    }),
    ev(4, 'tool_use', {
      toolCallId: 'tc2',
      name: 'file_read',
      input: { path: '/work/b.txt' },
      result: { outcome: 'completed', content: [{ type: 'text', text: 'B' }] },
    }),
    ev(5, 'message', { content: [{ type: 'text', text: 'both read' }] }),
    ev(6, 'turn_end', { stopReason: 'end_turn' }),
  ],
  // 4. thinking turn (message carries thinkingBlocks)
  [
    ev(1, 'system_prompt_set', { text: 'sys-d' }),
    ev(2, 'prompt', { content: [{ type: 'text', text: 'think' }] }),
    ev(3, 'message', {
      content: [{ type: 'text', text: 'pondered' }],
      thinkingBlocks: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }],
    }),
    ev(4, 'turn_end', { stopReason: 'end_turn' }),
  ],
  // 5. system_prompt_set then a later one (last-wins)
  [
    ev(1, 'system_prompt_set', { text: 'sys-first' }),
    ev(2, 'prompt', { content: [{ type: 'text', text: 'one' }] }),
    ev(3, 'message', { content: [{ type: 'text', text: 'r1' }] }),
    ev(4, 'system_prompt_set', { text: 'sys-second' }),
    ev(5, 'prompt', { content: [{ type: 'text', text: 'two' }] }),
    ev(6, 'message', { content: [{ type: 'text', text: 'r2' }] }),
  ],
  // 6. context_injected (text-merge after a tool_result user turn)
  [
    ev(1, 'system_prompt_set', { text: 'sys-e' }),
    ev(2, 'prompt', { content: [{ type: 'text', text: 'go' }] }),
    ev(3, 'tool_use', {
      toolCallId: 'tc1',
      name: 'bash',
      input: { command: 'ls' },
      result: { outcome: 'completed', content: [{ type: 'text', text: 'files' }] },
    }),
    ev(4, 'context_injected', { content: [{ type: 'text', text: 'reminder: stay focused' }] }),
    ev(5, 'message', { content: [{ type: 'text', text: 'ok' }] }),
    ev(6, 'turn_end', { stopReason: 'end_turn' }),
  ],
  // 7. context_compacted with preserved[], then a post-compaction tail
  [
    ev(1, 'system_prompt_set', { text: 'sys-f' }),
    ev(2, 'prompt', { content: [{ type: 'text', text: 'old' }] }),
    ev(3, 'message', { content: [{ type: 'text', text: 'old reply' }] }),
    ev(4, 'context_compacted', {
      preserved: [
        { role: 'user', content: 'summary of earlier' },
        { role: 'assistant', content: 'understood' },
      ],
    }),
    ev(5, 'system_prompt_set', { text: 'sys-f-rerendered' }),
    ev(6, 'prompt', { content: [{ type: 'text', text: 'new turn' }] }),
    ev(7, 'message', { content: [{ type: 'text', text: 'new reply' }] }),
    ev(8, 'turn_end', { stopReason: 'end_turn' }),
  ],
  // 8. compaction whose preserved carries an orphaned tool_use (dropOrphaned path)
  [
    ev(1, 'system_prompt_set', { text: 'sys-g' }),
    ev(2, 'context_compacted', {
      preserved: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: 'a',
          toolCalls: [{ id: 'orphan', name: 'bash', arguments: {} }],
        },
      ],
    }),
    ev(3, 'prompt', { content: [{ type: 'text', text: 'after' }] }),
    ev(4, 'message', { content: [{ type: 'text', text: 'fine' }] }),
  ],
];

function assertIncrementalEqualsFull(events: ParsedSessionEvent[]): void {
  const full = buildProviderMessagesFromParsedEvents(events);
  for (let k = 0; k <= events.length; k++) {
    let proj = initialCachedProjection();
    proj = foldTailIntoProjection(proj, events.slice(0, k));
    proj = foldTailIntoProjection(proj, events.slice(k));
    expect(JSON.stringify({ messages: proj.messages, systemPrompt: proj.systemPrompt })).toBe(
      JSON.stringify({ messages: full.messages, systemPrompt: full.systemPrompt })
    );
  }
}

describe('foldTailIntoProjection', () => {
  it('incremental fold (any split) equals full rebuild — across the corpus', () => {
    for (const events of CORPUS) assertIncrementalEqualsFull(events);
  });

  it('tracks filesRead and lastTurnEndSeq incrementally, matching the full derivers', () => {
    const events = CORPUS[1]!; // single file_read + turn_end
    let proj = initialCachedProjection('/work');
    proj = foldTailIntoProjection(proj, events.slice(0, 3));
    proj = foldTailIntoProjection(proj, events.slice(3));
    expect([...proj.filesRead]).toEqual(['/work/a.txt']);
    expect(proj.lastTurnEndSeq).toBe(5);
  });

  it('advances headSeq to next-seq-to-fold (lastFoldedSeq + 1)', () => {
    const events = CORPUS[0]!;
    let proj = initialCachedProjection();
    proj = foldTailIntoProjection(proj, events);
    // last event seq is 4, so the next seq to fold is 5
    expect(proj.headSeq).toBe(5);
  });

  it('folding an empty tail is a no-op (headSeq unchanged)', () => {
    const events = CORPUS[0]!;
    let proj = initialCachedProjection();
    proj = foldTailIntoProjection(proj, events);
    const before = JSON.stringify({
      messages: proj.messages,
      systemPrompt: proj.systemPrompt,
      headSeq: proj.headSeq,
      lastTurnEndSeq: proj.lastTurnEndSeq,
    });
    proj = foldTailIntoProjection(proj, []);
    const after = JSON.stringify({
      messages: proj.messages,
      systemPrompt: proj.systemPrompt,
      headSeq: proj.headSeq,
      lastTurnEndSeq: proj.lastTurnEndSeq,
    });
    expect(after).toBe(before);
  });
});
