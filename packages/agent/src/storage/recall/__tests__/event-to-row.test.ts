// ABOUTME: Tests for event-to-row.ts — DurableEvent -> RecallRow translation
// ABOUTME: One test per indexed kind; parametrized null check for non-indexed kinds

import { describe, expect, it } from 'vitest';
import type { TypedDurableEvent } from '../../event-types';
import { eventToRow, type RowContext } from '../event-to-row';

const CTX: RowContext = { sessionId: 'sess_x', persona: 'ada' };

function ev(
  data: TypedDurableEvent['data'],
  eventSeq = 1,
  timestamp = '2026-05-23T00:00:00Z'
): TypedDurableEvent {
  return { eventSeq, timestamp, type: data.type, data };
}

describe('eventToRow', () => {
  describe('indexed kinds', () => {
    it('maps prompt -> user_message with concatenated text blocks', () => {
      const event = ev({
        type: 'prompt',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: 'world' },
        ],
      });
      const row = eventToRow(event, CTX);
      expect(row).toEqual({
        event_id: 'sess_x:1',
        session_id: 'sess_x',
        ts: '2026-05-23T00:00:00Z',
        persona: 'ada',
        kind: 'user_message',
        content: 'hello\nworld',
      });
    });

    it('renders image blocks in prompt as [image: <mime>]', () => {
      const event = ev({
        type: 'prompt',
        content: [
          { type: 'text', text: 'see this' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AAA' },
          },
        ],
      });
      const row = eventToRow(event, CTX);
      expect(row?.kind).toBe('user_message');
      expect(row?.content).toBe('see this\n[image: image/png]');
    });

    it('maps message -> assistant_text with array content', () => {
      const event = ev({
        type: 'message',
        content: [
          { type: 'text', text: 'response a' },
          { type: 'text', text: 'response b' },
        ],
      });
      const row = eventToRow(event, CTX);
      expect(row?.kind).toBe('assistant_text');
      expect(row?.content).toBe('response a\nresponse b');
    });

    it('maps message -> assistant_text with plain-string content', () => {
      const event = ev({ type: 'message', content: 'plain text body' });
      const row = eventToRow(event, CTX);
      expect(row?.kind).toBe('assistant_text');
      expect(row?.content).toBe('plain text body');
    });

    it('maps tool_use -> tool_call with name, input, and extracted result text', () => {
      const event = ev({
        type: 'tool_use',
        toolCallId: 'tc_1',
        name: 'shell',
        input: { command: 'ls' },
        result: {
          content: [{ type: 'text', text: 'file1\nfile2' }],
          status: 'completed',
        },
      });
      const row = eventToRow(event, CTX);
      expect(row?.kind).toBe('tool_call');
      expect(row?.content).toBe('tool=shell\ninput={"command":"ls"}\nresult=file1\nfile2');
    });

    it('omits the result line when tool_use.result is undefined', () => {
      const event = ev({
        type: 'tool_use',
        toolCallId: 'tc_1',
        name: 'shell',
        input: { command: 'ls' },
      });
      const row = eventToRow(event, CTX);
      expect(row?.kind).toBe('tool_call');
      expect(row?.content).toBe('tool=shell\ninput={"command":"ls"}');
    });

    it('joins multi-block tool_use result text with newlines', () => {
      const event = ev({
        type: 'tool_use',
        toolCallId: 'tc_1',
        name: 'fetch',
        input: { url: 'https://example.com' },
        result: {
          content: [
            { type: 'text', text: 'part1' },
            { type: 'text', text: 'part2' },
          ],
          status: 'completed',
        },
      });
      const row = eventToRow(event, CTX);
      expect(row?.content).toBe(
        'tool=fetch\ninput={"url":"https://example.com"}\nresult=part1\npart2'
      );
    });

    it('maps context_injected -> notification with extracted text', () => {
      const event = ev({
        type: 'context_injected',
        content: [{ type: 'text', text: 'system note' }],
      });
      const row = eventToRow(event, CTX);
      expect(row?.kind).toBe('notification');
      expect(row?.content).toBe('system note');
    });

    it('maps context_compacted -> system using data.summary when present', () => {
      const event = ev({
        type: 'context_compacted',
        strategy: 'summarize',
        preserved: [],
        summary: 'compaction summary text',
      });
      const row = eventToRow(event, CTX);
      expect(row?.kind).toBe('system');
      expect(row?.content).toBe('compaction summary text');
    });

    it('maps context_compacted -> system with [compaction: <strategy>] when summary absent', () => {
      const event = ev({
        type: 'context_compacted',
        strategy: 'summarize',
        preserved: [],
      });
      const row = eventToRow(event, CTX);
      expect(row?.kind).toBe('system');
      expect(row?.content).toBe('[compaction: summarize]');
    });

    it('forms event_id from sessionId and eventSeq', () => {
      const event = ev({ type: 'message', content: 'x' }, 42);
      const row = eventToRow(event, CTX);
      expect(row?.event_id).toBe('sess_x:42');
    });

    it('propagates ctx.persona as the persona field', () => {
      const event = ev({ type: 'message', content: 'x' });
      const row = eventToRow(event, { sessionId: 'sess_y', persona: 'bea' });
      expect(row?.persona).toBe('bea');
      expect(row?.session_id).toBe('sess_y');
    });

    it('preserves null persona', () => {
      const event = ev({ type: 'message', content: 'x' });
      const row = eventToRow(event, { sessionId: 'sess_y', persona: null });
      expect(row?.persona).toBeNull();
    });
  });

  describe('non-indexed kinds', () => {
    const nonIndexed: Array<TypedDurableEvent['data']> = [
      { type: 'turn_start' },
      { type: 'turn_end', stopReason: 'end_turn' },
      { type: 'job_started', jobId: 'j1', jobType: 'shell' },
      { type: 'job_finished', jobId: 'j1', outcome: 'completed' },
      { type: 'job_update', jobId: 'j1', update: {} },
      { type: 'job_session_assigned', jobId: 'j1', subagentSessionId: 'sub_1' },
      {
        type: 'permission_requested',
        toolCallId: 'tc',
        turnSeq: 0,
        tool: 'shell',
        resource: 'rm',
        options: [],
        requestedAt: '2026-05-23T00:00:00Z',
        input: {},
      },
      { type: 'permission_decided', toolCallId: 'tc', turnSeq: 0 },
      { type: 'permission_cancelled', toolCallId: 'tc', turnSeq: 0, reason: 'x' },
      { type: 'checkpoint_created', checkpointId: 'cp1' },
      { type: 'files_rewound', checkpointId: 'cp1', filesRestored: [] },
    ];

    it.each(nonIndexed.map((data) => [data.type, data]))('returns null for %s', (_type, data) => {
      const event = ev(data);
      expect(eventToRow(event, CTX)).toBeNull();
    });
  });
});
