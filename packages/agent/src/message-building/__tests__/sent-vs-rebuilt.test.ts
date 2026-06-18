// ABOUTME: Pins that the message shape the runner SENDS for a parallel-tool turn
// equals the shape rebuilt from the durable events for the same turn. The rebuild
// now folds via foldEvent into the canonical one-assistant/one-user shape, so the
// two match — closing the cache break this step fixes.
import { describe, it, expect } from 'vitest';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The live shape the runner produces for a 2-call turn: one assistant carrying
// both calls, then one user carrying both results (the canonical parallel-tool
// shape). Mirror the runner's tool loop exactly.
function liveShape() {
  return [
    {
      role: 'assistant',
      content: 'doing two things',
      toolCalls: [
        { id: 'c1', name: 'echo', arguments: { v: 'a' } },
        { id: 'c2', name: 'echo', arguments: { v: 'b' } },
      ],
    },
    {
      role: 'user',
      content: '',
      toolResults: [
        { id: 'c1', content: [{ type: 'text', text: 'a' }], status: 'completed' },
        { id: 'c2', content: [{ type: 'text', text: 'b' }], status: 'completed' },
      ],
    },
  ];
}

describe('sent shape equals rebuilt shape for a parallel-tool turn', () => {
  // Both paths now fold to the canonical parallel-tool shape (one assistant with
  // all calls, one user with all results): the rebuild via foldEvent and the
  // runner's live tail, which accumulates a batch's results into one user
  // message. Sent == rebuilt — the cache break is closed.
  it('runner-sent messages match the rebuild from durable events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lace-svr-'));
    try {
      const events = [
        {
          eventSeq: 1,
          timestamp: '2026-06-18T00:00:00Z',
          type: 'system_prompt_set',
          data: { type: 'system_prompt_set', text: 'sys' },
        },
        {
          eventSeq: 2,
          timestamp: '2026-06-18T00:00:01Z',
          type: 'prompt',
          data: { content: [{ type: 'text', text: 'do two things' }] },
        },
        {
          eventSeq: 3,
          timestamp: '2026-06-18T00:00:02Z',
          type: 'message',
          data: { content: 'doing two things' },
        },
        {
          eventSeq: 4,
          timestamp: '2026-06-18T00:00:03Z',
          type: 'tool_use',
          data: {
            toolCallId: 'c1',
            name: 'echo',
            kind: 'read',
            input: { v: 'a' },
            result: { outcome: 'completed', content: [{ type: 'text', text: 'a' }] },
          },
        },
        {
          eventSeq: 5,
          timestamp: '2026-06-18T00:00:04Z',
          type: 'tool_use',
          data: {
            toolCallId: 'c2',
            name: 'echo',
            kind: 'read',
            input: { v: 'b' },
            result: { outcome: 'completed', content: [{ type: 'text', text: 'b' }] },
          },
        },
      ];
      writeFileSync(
        join(dir, 'events.jsonl'),
        events.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf8'
      );

      const { messages: rebuilt } = buildProviderMessagesFromDurableEvents(dir);
      // Compare the assistant+tool portion (drop the prompt user message at index 0).
      const rebuiltTail = rebuilt.slice(1);
      expect(JSON.stringify(rebuiltTail)).toBe(JSON.stringify(liveShape()));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
