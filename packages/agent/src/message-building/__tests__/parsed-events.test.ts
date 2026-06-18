// ABOUTME: Tests for readParsedSessionEvents — read + parse + sort the durable log once.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readParsedSessionEvents } from '@lace/agent/message-building/parsed-events';
import {
  buildProviderMessagesFromParsedEvents,
  buildProviderMessagesFromDurableEvents,
} from '@lace/agent/message-building/message-builder';
import {
  deriveFilesReadFromParsedEvents,
  deriveFilesReadFromDurableEvents,
} from '@lace/agent/storage/files-from-events';
import {
  findLastTurnEndSeqFromParsedEvents,
  findLastTurnEndEventSeq,
} from '@lace/agent/storage/event-log';

describe('readParsedSessionEvents', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-pe-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads, parses, and sorts events by eventSeq from the legacy log', () => {
    // Intentionally out of order on disk; a malformed line must be skipped.
    const lines = [
      JSON.stringify({ eventSeq: 2, timestamp: 't', type: 'message', data: { content: 'b' } }),
      'not json',
      JSON.stringify({ eventSeq: 1, timestamp: 't', type: 'prompt', data: { content: 'a' } }),
    ];
    writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf8');

    const events = readParsedSessionEvents(dir);
    expect(events.map((e) => e.eventSeq)).toEqual([1, 2]);
    expect(events.map((e) => e.type)).toEqual(['prompt', 'message']);
    expect(events[0].data).toEqual({ content: 'a' });
  });

  it('returns [] for an empty/missing log', () => {
    expect(readParsedSessionEvents(dir)).toEqual([]);
  });

  it('pure derivers equal their I/O counterparts on the same log', () => {
    const cwd = '/work';
    const lines = [
      JSON.stringify({
        eventSeq: 1,
        timestamp: 't',
        type: 'system_prompt_set',
        data: { text: 'sys' },
      }),
      JSON.stringify({
        eventSeq: 2,
        timestamp: 't',
        type: 'prompt',
        data: { content: [{ type: 'text', text: 'hi' }] },
      }),
      JSON.stringify({
        eventSeq: 3,
        timestamp: 't',
        type: 'message',
        data: {
          content: [{ type: 'text', text: 'hello' }],
          thinkingBlocks: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }],
        },
      }),
      JSON.stringify({
        eventSeq: 4,
        timestamp: 't',
        type: 'tool_use',
        data: {
          toolCallId: 'tc1',
          name: 'file_read',
          input: { path: 'src/a.ts' },
          result: { outcome: 'completed', content: [{ type: 'text', text: 'file body' }] },
        },
      }),
      JSON.stringify({
        eventSeq: 5,
        timestamp: 't',
        type: 'tool_use',
        data: {
          toolCallId: 'tc2',
          name: 'bash',
          input: { command: 'ls' },
          result: { outcome: 'completed', content: [{ type: 'text', text: 'output' }] },
        },
      }),
      JSON.stringify({
        eventSeq: 6,
        timestamp: 't',
        type: 'turn_end',
        data: { stopReason: 'end_turn' },
      }),
      JSON.stringify({
        eventSeq: 7,
        timestamp: 't',
        type: 'prompt',
        data: { content: [{ type: 'text', text: 'again' }] },
      }),
      JSON.stringify({
        eventSeq: 8,
        timestamp: 't',
        type: 'turn_end',
        data: { stopReason: 'end_turn' },
      }),
    ];
    writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf8');

    const events = readParsedSessionEvents(dir);

    expect(JSON.stringify(buildProviderMessagesFromParsedEvents(events))).toBe(
      JSON.stringify(buildProviderMessagesFromDurableEvents(dir))
    );

    const filesPure = deriveFilesReadFromParsedEvents(events, cwd);
    expect([...filesPure]).toEqual([...deriveFilesReadFromDurableEvents(dir, cwd)]);
    // Fixture must exercise a NON-EMPTY files-read set.
    expect(filesPure.size).toBeGreaterThan(0);

    expect(findLastTurnEndSeqFromParsedEvents(events)).toBe(findLastTurnEndEventSeq(dir));
  });
});
