// ABOUTME: Pins that the message shape the runner SENDS for a parallel-tool turn
// equals the shape rebuilt from the durable events for the same turn. They differ
// today (the cache break this step fixes); this test is RED until the reducer and
// the runner emit the one canonical shape.
import { describe, it, expect } from 'vitest';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The live shape the runner produces for a 2-call turn (assistant text + 2 calls,
// then one user per result). Mirror runner.ts:981-992 + 1041-1044 exactly.
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
  // it.fails: PASSES while the assertion below fails — pins the known cache break.
  // Task 5 flips this to a plain it(...) once the reducer + runner are unified.
  it.fails('runner-sent messages match the rebuild from durable events', () => {
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
