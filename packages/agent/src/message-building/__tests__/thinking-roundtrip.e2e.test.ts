// ABOUTME: End-to-end test for thinking-block round-tripping: a persisted
// ABOUTME: 'message' event carrying thinkingBlocks rebuilds into a ProviderMessage
// ABOUTME: whose toolCalls coalesce onto the same message, and convertToAnthropicFormat
// ABOUTME: replays the thinking blocks (with signature) before text/tool_use. Covers
// ABOUTME: the normal turn, the tool-only (empty-text) turn, and the compacted tail.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProviderMessagesFromDurableEvents } from '../message-builder';
import { convertToAnthropicFormat } from '../../providers/format-converters';

function writeEvents(dir: string, events: unknown[]): void {
  writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

let seq = 0;
function ev(type: string, data: Record<string, unknown>): Record<string, unknown> {
  seq += 1;
  return { type, eventSeq: seq, timestamp: new Date(seq * 1000).toISOString(), data };
}

const THINKING = [
  { type: 'thinking', thinking: 'reasoning chain', signature: 'sig-xyz' },
  { type: 'redacted_thinking', data: 'enc' },
];

describe('thinking-block round-trip (persist → rebuild → convert)', () => {
  let tempDir: string;

  beforeEach(() => {
    seq = 0;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-thinking-rt-'));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('replays thinking before text and tool_use on a normal assistant turn', () => {
    writeEvents(tempDir, [
      ev('prompt', { content: [{ type: 'text', text: 'do it' }] }),
      ev('message', { content: [{ type: 'text', text: 'on it' }], thinkingBlocks: THINKING }),
      ev('tool_use', {
        toolCallId: 'tc_1',
        name: 'bash',
        input: { command: 'echo hi' },
        result: { status: 'completed', content: [{ type: 'text', text: 'hi' }] },
      }),
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // The assistant message carries thinkingBlocks AND the coalesced tool call.
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.thinkingBlocks).toEqual(THINKING);
    expect(assistant?.toolCalls?.[0]?.id).toBe('tc_1');

    const converted = convertToAnthropicFormat(messages);
    const asst = converted.find((m) => m.role === 'assistant');
    const content = asst!.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({
      type: 'thinking',
      thinking: 'reasoning chain',
      signature: 'sig-xyz',
    });
    expect(content[1]).toEqual({ type: 'redacted_thinking', data: 'enc' });
    expect(content[2]).toEqual({ type: 'text', text: 'on it' });
    expect(content[3]).toHaveProperty('type', 'tool_use');
  });

  it('round-trips thinking on a tool-only turn (empty assistant text)', () => {
    writeEvents(tempDir, [
      ev('prompt', { content: [{ type: 'text', text: 'go' }] }),
      // No text — the runner still writes the message event because thinking is present.
      ev('message', { content: [], thinkingBlocks: THINKING }),
      ev('tool_use', {
        toolCallId: 'tc_2',
        name: 'bash',
        input: { command: 'ls' },
        result: { status: 'completed', content: [{ type: 'text', text: 'ok' }] },
      }),
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.thinkingBlocks).toEqual(THINKING);
    expect(assistant?.toolCalls?.[0]?.id).toBe('tc_2');

    const converted = convertToAnthropicFormat(messages);
    const asst = converted.find((m) => m.role === 'assistant');
    const content = asst!.content as Array<Record<string, unknown>>;
    // [thinking, redacted_thinking, tool_use] — no text block.
    expect(content[0]).toHaveProperty('type', 'thinking');
    expect(content[1]).toHaveProperty('type', 'redacted_thinking');
    expect(content[2]).toHaveProperty('type', 'tool_use');
  });

  it('preserves thinking through a compacted tail', () => {
    const event = ev('context_compacted', {
      summary: 'earlier stuff',
      preserved: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'sure', thinkingBlocks: THINKING },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc_3', name: 'bash', arguments: { command: 'pwd' } }],
        },
      ],
    });

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);
    const withThinking = messages.find((m) => m.thinkingBlocks);
    expect(withThinking?.thinkingBlocks).toEqual(THINKING);
  });
});
