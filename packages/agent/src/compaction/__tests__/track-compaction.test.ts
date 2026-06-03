// ABOUTME: Tests for track-based compaction — demux, salience, render, orchestrator
// ABOUTME: Pure-function tests over synthetic TypedDurableEvent[] fixtures

import { describe, it, expect } from 'vitest';
import {
  buildTurnToTrackMap,
  groupEarlierEventsByTrack,
  kernelAttributor,
  salienceForTrack,
  compact,
  splitAtTailBoundary,
  UNTRACKED,
} from '../track-compaction';
import { demuxByTrack } from '../toolkit';
import type { CompactionContext } from '../types';
import type { DurableEventData, TypedDurableEvent } from '@lace/agent/storage/event-types';
import type { AIProvider } from '@lace/agent/providers/base-provider';

const event = (
  seq: number,
  type: DurableEventData['type'],
  data: Record<string, unknown>,
  turnId?: string
): TypedDurableEvent => ({
  eventSeq: seq,
  timestamp: `2026-05-24T00:00:${String(seq).padStart(2, '0')}Z`,
  ...(turnId ? { turnId } : {}),
  type,
  data: { type, ...data } as TypedDurableEvent['data'],
});

describe('buildTurnToTrackMap', () => {
  it('maps turnId to the track of the immediately preceding prompt', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'hi' }], track: 'slack:A' }),
      event(2, 'turn_start', {}, 'turn_X'),
      event(3, 'message', { content: 'reply' }, 'turn_X'),
      event(4, 'turn_end', { stopReason: 'end_turn' }, 'turn_X'),
    ];
    const map = buildTurnToTrackMap(events);
    expect(map.get('turn_X')).toBe('slack:A');
  });

  it('defaults missing track to untracked', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'hi' }] }),
      event(2, 'turn_start', {}, 'turn_X'),
    ];
    expect(buildTurnToTrackMap(events).get('turn_X')).toBe('untracked');
  });

  it('uses the closest preceding prompt across multiple turns', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      event(2, 'turn_start', {}, 'turn_1'),
      event(3, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
      event(4, 'prompt', { content: [], track: 'slack:B' }),
      event(5, 'turn_start', {}, 'turn_2'),
      event(6, 'turn_end', { stopReason: 'end_turn' }, 'turn_2'),
    ];
    const map = buildTurnToTrackMap(events);
    expect(map.get('turn_1')).toBe('slack:A');
    expect(map.get('turn_2')).toBe('slack:B');
  });
});

describe('groupEarlierEventsByTrack', () => {
  it('groups in-turn events by the turn-track and mid-turn injects by their own track', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      event(2, 'turn_start', {}, 'turn_1'),
      event(3, 'tool_use', { toolCallId: 't1', name: 'bash', input: {} }, 'turn_1'),
      event(4, 'context_injected', { content: [], track: 'alarm:X' }), // mid-turn (no turnId)
      event(5, 'message', { content: 'ok' }, 'turn_1'),
      event(6, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
    ];
    const turnToTrack = new Map([['turn_1', 'slack:A']]);
    const groups = groupEarlierEventsByTrack(events, turnToTrack);
    expect(groups.get('slack:A')?.map((e) => e.eventSeq)).toEqual([1, 2, 3, 5, 6]);
    expect(groups.get('alarm:X')?.map((e) => e.eventSeq)).toEqual([4]);
  });

  it('top-level events without turnId use their own track', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [], track: 'system:bootstrap' }),
      event(2, 'context_injected', { content: [], track: 'reminder:R' }),
    ];
    const groups = groupEarlierEventsByTrack(events, new Map());
    expect(groups.get('system:bootstrap')?.map((e) => e.eventSeq)).toEqual([1]);
    expect(groups.get('reminder:R')?.map((e) => e.eventSeq)).toEqual([2]);
  });

  it('filters out context_compacted events', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_compacted', { strategy: 'old', preserved: [] }),
      event(2, 'prompt', { content: [], track: 'slack:A' }),
    ];
    const groups = groupEarlierEventsByTrack(events, new Map());
    expect(groups.get('untracked')).toBeUndefined();
    expect(groups.get('slack:A')?.map((e) => e.eventSeq)).toEqual([2]);
  });

  it('routes top-level job_started and job_finished to job:<jobId> track', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'job_started', { jobId: 'job_abc', jobType: 'delegate', description: 'IP check' }),
      event(2, 'job_finished', { jobId: 'job_abc', outcome: 'completed' }),
    ];
    const groups = groupEarlierEventsByTrack(events, new Map());
    expect(groups.get('job:job_abc')?.map((e) => e.eventSeq)).toEqual([1, 2]);
    // Must NOT fall through to untracked
    expect(groups.get(UNTRACKED)).toBeUndefined();
  });
});

describe('salienceForTrack', () => {
  it('alarm tracks drop entirely (return null)', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', {
        content: [{ type: 'text', text: '<notification kind="alarm-fired">...' }],
        track: 'alarm:foo',
      }),
    ];
    expect(salienceForTrack('alarm:foo', events)).toBeNull();
  });

  it('reminder tracks drop entirely', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [], track: 'reminder:r1' }),
    ];
    expect(salienceForTrack('reminder:r1', events)).toBeNull();
  });

  it('system:bootstrap drops entirely', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [], track: 'system:bootstrap' }),
    ];
    expect(salienceForTrack('system:bootstrap', events)).toBeNull();
  });

  it('system:idle-errors emits count-only', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [], track: 'system:idle-errors' }),
      event(2, 'context_injected', { content: [], track: 'system:idle-errors' }),
      event(3, 'context_injected', { content: [], track: 'system:idle-errors' }),
    ];
    const block = salienceForTrack('system:idle-errors', events);
    expect(block?.body).toMatch(/3 idle-error reports/i);
  });

  it('slack tracks extract inbound text from prompts and outbound from slack_send_message tool_use', () => {
    const events: TypedDurableEvent[] = [
      event(
        1,
        'prompt',
        {
          content: [
            {
              type: 'text',
              text: '<messages source="slack" channel="&lt;#C1|test&gt;" thread_ts="1.0" reply=\'slack_send_message(channel="C1", thread_ts="1.0")\'><current count="1"><slack_message ref="slack:T:C1|test/1.0@1.0" from="@U1|test">hello</slack_message></current></messages>',
            },
          ],
          track: 'slack:T:C1:1.0',
        },
        undefined
      ),
      event(2, 'turn_start', {}, 'turn_1'),
      event(
        3,
        'tool_use',
        {
          toolCallId: 't1',
          name: 'slack/send_message',
          input: { channel: 'C1', text: 'hi back' },
        },
        'turn_1'
      ),
      event(4, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
    ];
    const block = salienceForTrack('slack:T:C1:1.0', events);
    expect(block?.body).toContain('<slack-thread ref="slack:T0FIXTURE:C1|test/1.0"');
    expect(block?.body).toContain('from="@U1|test"');
    expect(block?.body).toContain('>hello</slack_message>');
    expect(block?.body).toContain('from="me"');
    expect(block?.body).toContain('>hi back</slack_message>');
  });

  it('slack tracks dedupe consecutive identical inbound messages within a speaker block', () => {
    // Two consecutive prompts with the same actor+text — should appear only once,
    // as adjacent-only deduplication merges them in the speaker block.
    const sameMessage =
      '<messages source="slack" channel="&lt;#C1|test&gt;" thread_ts="1.0" reply=\'slack_send_message(channel="C1", thread_ts="1.0")\'><current count="1"><slack_message ref="slack:T:C1|test/1.0@1.0" from="@U1|test">hello</slack_message></current></messages>';
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', {
        content: [{ type: 'text', text: sameMessage }],
        track: 'slack:T:C1:1.0',
      }),
      event(2, 'prompt', {
        content: [{ type: 'text', text: sameMessage }],
        track: 'slack:T:C1:1.0',
      }),
    ];
    const block = salienceForTrack('slack:T:C1:1.0', events);
    const body = block?.body ?? '';
    // The message appears exactly once (dedupe within speaker block)
    const msgOccurrences = body.split('>hello</slack_message>').length - 1;
    expect(msgOccurrences).toBe(1);
    // The actor token appears exactly once (grouped into one speaker block)
    const actorOccurrences = body.split('from="@U1|test"').length - 1;
    expect(actorOccurrences).toBe(1);
  });

  it('slack tracks interleave inbound and outbound chronologically', () => {
    // Alternating prompt/tool_use produces alternating <slack_message> elements, not
    // all-inbound-then-all-outbound.
    const makeEnvelope = (msg: string) =>
      `<messages source="slack" channel="&lt;#C1|test&gt;" thread_ts="1.0" reply='slack_send_message(channel="C1", thread_ts="1.0")'><current count="1"><slack_message ref="slack:T:C1|test/1.0@1.0" from="@U1|test">${msg}</slack_message></current></messages>`;
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', {
        content: [{ type: 'text', text: makeEnvelope('hi') }],
        track: 'slack:T:C1:1.0',
      }),
      event(2, 'turn_start', {}, 'turn_1'),
      event(
        3,
        'tool_use',
        { toolCallId: 't1', name: 'slack/send_message', input: { channel: 'C1', text: 'reply1' } },
        'turn_1'
      ),
      event(4, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
      event(5, 'prompt', {
        content: [{ type: 'text', text: makeEnvelope('bye') }],
        track: 'slack:T:C1:1.0',
      }),
      event(6, 'turn_start', {}, 'turn_2'),
      event(
        7,
        'tool_use',
        { toolCallId: 't2', name: 'slack/send_message', input: { channel: 'C1', text: 'reply2' } },
        'turn_2'
      ),
      event(8, 'turn_end', { stopReason: 'end_turn' }, 'turn_2'),
    ];
    const block = salienceForTrack('slack:T:C1:1.0', events);
    const body = block?.body ?? '';
    // Alternating blocks: U1 → me → U1 → me
    // Each inbound actor token appears twice (once per inbound group)
    const inActorOccurrences = body.split('from="@U1|test"').length - 1;
    const outActorOccurrences = body.split('from="me"').length - 1;
    expect(inActorOccurrences).toBe(2);
    expect(outActorOccurrences).toBe(2);
    // Messages appear in chronological order: hi before reply1 before bye before reply2
    const hiIdx = body.indexOf('>hi<');
    const reply1Idx = body.indexOf('>reply1<');
    const byeIdx = body.indexOf('>bye<');
    const reply2Idx = body.indexOf('>reply2<');
    expect(hiIdx).toBeLessThan(reply1Idx);
    expect(reply1Idx).toBeLessThan(byeIdx);
    expect(byeIdx).toBeLessThan(reply2Idx);
  });

  it('slack tracks render actor token directly from from= attribute', () => {
    // The actor token is taken verbatim from from="@U2|name" — no display_name
    // attribute needed, no [u/UID] fallback format.
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', {
        content: [
          {
            type: 'text',
            text: '<messages source="slack" channel="&lt;#C1|test&gt;" thread_ts="1.0" reply=\'slack_send_message(channel="C1", thread_ts="1.0")\'><current count="1"><slack_message ref="slack:T:C1|test/1.0@1.0" from="@U2|alice">no name needed</slack_message></current></messages>',
          },
        ],
        track: 'slack:T:C1:1.0',
      }),
    ];
    const block = salienceForTrack('slack:T:C1:1.0', events);
    const body = block?.body ?? '';
    expect(body).toContain('from="@U2|alice"');
    expect(body).not.toContain('null');
    expect(body).toContain('>no name needed</slack_message>');
  });

  it('job tracks emit "delegated X → outcome" using job_started/job_finished', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'job_started', {
        jobId: 'job_a',
        jobType: 'delegate',
        description: 'IP check',
      }),
      event(2, 'job_finished', { jobId: 'job_a', outcome: 'completed' }),
    ];
    const block = salienceForTrack('job:job_a', events);
    expect(block?.body).toMatch(/IP check.*completed/);
  });

  it('untracked falls back to a generic prose extraction', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'a legacy prompt' }] }),
      event(2, 'turn_start', {}, 'turn_1'),
      event(3, 'message', { content: 'an assistant reply' }, 'turn_1'),
      event(4, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
    ];
    const block = salienceForTrack('untracked', events);
    expect(block?.body).toContain('a legacy prompt');
    expect(block?.body).toContain('an assistant reply');
  });

  it('untracked context_injected events appear as Note: lines in prose', () => {
    // Legacy/non-stamped context_injected events (no track field) end up in the
    // untracked bucket. They must appear in the prose output, not be silently dropped.
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', {
        content: [{ type: 'text', text: 'alarm fired: stand-up now' }],
      }),
      event(2, 'prompt', { content: [{ type: 'text', text: 'ack' }] }),
    ];
    const block = salienceForTrack('untracked', events);
    expect(block?.body).toContain('Note: alarm fired: stand-up now');
    expect(block?.body).toContain('User: ack');
  });
});

const turnEnd = (seq: number, turnId: string): TypedDurableEvent =>
  event(seq, 'turn_end', { stopReason: 'end_turn' }, turnId);
const turnStart = (seq: number, turnId: string): TypedDurableEvent =>
  event(seq, 'turn_start', {}, turnId);

describe('splitAtTailBoundary', () => {
  it('keeps last 10 turns verbatim', () => {
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let t = 0; t < 12; t++) {
      events.push(event(seq++, 'prompt', { content: [], track: `slack:T${t}` }));
      events.push(turnStart(seq++, `turn_${t}`));
      events.push(turnEnd(seq++, `turn_${t}`));
    }
    const { earlier, tail } = splitAtTailBoundary(events, 10);
    // 12 turns × 3 events = 36; last 10 turns = events 7..36 (3 × 10 = 30 events tail).
    expect(tail.length).toBe(30);
    expect(earlier.length).toBe(6);
  });

  it('places boundary at prompt of (tailTurns+1)-th-from-end turn', () => {
    // Two-turn fixture. With tail=1, boundary lands at the prompt before turn_2,
    // so turn_1 (all 5 events) goes to earlier and turn_2 (3 events) goes to tail.
    // This confirms the turn-boundary semantics: a tool_use and its result both
    // live on turn_1, so they end up together in earlier — no snap needed.
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      turnStart(2, 'turn_1'),
      event(3, 'tool_use', { toolCallId: 't1', name: 'bash', input: {} }, 'turn_1'),
      event(
        4,
        'message',
        { content: [{ type: 'tool_result', toolCallId: 't1', content: 'ok' }] },
        'turn_1'
      ),
      turnEnd(5, 'turn_1'),
      event(6, 'prompt', { content: [], track: 'slack:B' }),
      turnStart(7, 'turn_2'),
      turnEnd(8, 'turn_2'),
    ];
    const { earlier, tail } = splitAtTailBoundary(events, 1);
    // turn_2 is 3 events (prompt + turn_start + turn_end).
    expect(tail.length).toBe(3);
    expect(earlier.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns all-as-earlier when tailTurns is 0', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      turnStart(2, 'turn_1'),
      turnEnd(3, 'turn_1'),
    ];
    const { earlier, tail } = splitAtTailBoundary(events, 0);
    expect(earlier.length).toBe(3);
    expect(tail.length).toBe(0);
  });

  it('bails out (all-as-tail) when target turn_end has no turnId', () => {
    // turn_end with undefined turnId (e.g. crash-recovery synthesized)
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      turnStart(2, 'turn_1'),
      turnEnd(3, 'turn_1'),
      event(4, 'prompt', { content: [], track: 'slack:B' }),
      // Note: NO turnId on this turn_end
      event(5, 'turn_end', { stopReason: 'process_died' }),
    ];
    const { earlier, tail } = splitAtTailBoundary(events, 1);
    expect(earlier).toEqual([]);
    expect(tail.length).toBe(5);
  });

  it('returns all events as tail when total turns <= tail size', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:A' }),
      turnStart(2, 'turn_1'),
      turnEnd(3, 'turn_1'),
    ];
    const { earlier, tail } = splitAtTailBoundary(events, 10);
    expect(earlier).toEqual([]);
    expect(tail.length).toBe(3);
  });
});

describe('compact() with LLM fallback', () => {
  // Build a text that is long enough that many entries in the body will exceed
  // the 5K-token cap. untrackedSalience truncates each prompt to 500 chars and
  // prefixes "User: " (6 chars), so each entry contributes ~506 chars (~127 tokens).
  // 42 earlier turns × 127 tokens ≈ 5,334 tokens — comfortably over the cap.
  const longEntry = 'a'.repeat(500);

  it('calls provider.createResponse when a track block exceeds 5K tokens', async () => {
    const calls: Array<{ messages: unknown; tools: unknown; modelId: string }> = [];
    const mockProvider = {
      createResponse: async (messages: unknown, tools: unknown, modelId: string) => {
        calls.push({ messages, tools, modelId });
        return { content: 'condensed summary', usage: { promptTokens: 0, completionTokens: 50 } };
      },
      setSystemPrompt: () => {},
    } as unknown as AIProvider;

    // Build an untracked track with 42 earlier turns (no `track` field → 'untracked').
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let i = 0; i < 42; i++) {
      events.push(
        event(seq++, 'prompt', {
          content: [{ type: 'text', text: longEntry }],
        })
      );
      events.push(turnStart(seq++, `turn_${i}`));
      events.push(turnEnd(seq++, `turn_${i}`));
    }
    // Add 10 trailing turns on a different track to satisfy the tail-size requirement.
    for (let i = 0; i < 10; i++) {
      events.push(event(seq++, 'prompt', { content: [], track: 'slack:T:C:1' }));
      events.push(turnStart(seq++, `tail_${i}`));
      events.push(turnEnd(seq++, `tail_${i}`));
    }
    const result = await compact(events, {
      threadId: 'sess',
      provider: mockProvider,
      modelId: 'test-model',
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].modelId).toBe('test-model');
    // The prefix is merged into the first tail user message. Extract text
    // from either a plain string or a ContentBlock[] to check for the summary.
    const firstEntry = result.compactionEvent.data.preserved[0] as {
      role: string;
      content: string | Array<{ type: string; text?: string }>;
    };
    expect(firstEntry.role).toBe('user');
    const firstText =
      typeof firstEntry.content === 'string'
        ? firstEntry.content
        : (firstEntry.content as Array<{ type: string; text?: string }>)
            .map((b) => b.text ?? '')
            .join('');
    expect(firstText).toContain('condensed summary');
  });

  it('does NOT call provider when all tracks fit', async () => {
    let called = false;
    const mockProvider = {
      createResponse: async () => {
        called = true;
        return { content: '', usage: { promptTokens: 0, completionTokens: 0 } };
      },
      setSystemPrompt: () => {},
    } as unknown as AIProvider;
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let i = 0; i < 12; i++) {
      events.push(
        event(seq++, 'prompt', { content: [{ type: 'text', text: 'short' }], track: 'slack:T:C:0' })
      );
      events.push(turnStart(seq++, `turn_${i}`));
      events.push(turnEnd(seq++, `turn_${i}`));
    }
    // modelId is set so the absence of a call is due to tracks fitting, not the
    // missing-modelId guard.
    await compact(events, { threadId: 'sess', provider: mockProvider, modelId: 'test-model' });
    expect(called).toBe(false);
  });
});

describe('compact()', () => {
  const ctx: CompactionContext = { threadId: 'sess_test' };

  it('produces a context_compacted event with strategy="track-based"', async () => {
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let t = 0; t < 12; t++) {
      events.push(
        event(seq++, 'prompt', {
          content: [{ type: 'text', text: `msg ${t}` }],
          track: `slack:T:C:${t}`,
        })
      );
      events.push(turnStart(seq++, `turn_${t}`));
      events.push(turnEnd(seq++, `turn_${t}`));
    }
    const result = await compact(events, ctx);
    expect(result.compactionEvent.type).toBe('context_compacted');
    expect(result.compactionEvent.data.strategy).toBe('track-based');
    expect(result.compactionEvent.data.messagesCompacted).toBe(6); // earlier events count
    expect(Array.isArray(result.compactionEvent.data.preserved)).toBe(true);
    const first = result.compactionEvent.data.preserved[0] as {
      role: string;
      content: string | Array<{ type: string; text?: string }>;
    };
    expect(first.role).toBe('user');
    // The prefix is merged into the first tail user message. Extract the text
    // regardless of whether content is a string or a ContentBlock[].
    const firstText =
      typeof first.content === 'string'
        ? first.content
        : (first.content as Array<{ type: string; text?: string }>)
            .map((b) => b.text ?? '')
            .join('');
    expect(firstText).toContain('[Earlier conversation');
  });

  it('returns noop when there is nothing to compact (≤10 turns)', async () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'one' }], track: 'slack:A' }),
      turnStart(2, 'turn_1'),
      turnEnd(3, 'turn_1'),
    ];
    const result = await compact(events, ctx);
    expect('noop' in result && result.noop).toBe(true);
  });

  it('merges prefix into first tail user message to avoid adjacent user roles', async () => {
    // Build 12 turns: 2 go to earlier, 10 go to tail. The first tail event is a
    // prompt (user-role). Without the merge, preserved[] would start with two
    // consecutive user entries: [prefix, prompt, ...] which providers reject.
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let t = 0; t < 12; t++) {
      events.push(
        event(seq++, 'prompt', {
          content: [{ type: 'text', text: `msg ${t}` }],
          track: `slack:T${t}`,
        })
      );
      events.push(turnStart(seq++, `turn_${t}`));
      events.push(turnEnd(seq++, `turn_${t}`));
    }
    const result = await compact(events, ctx);
    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) return;
    const preserved = result.compactionEvent.data.preserved as Array<{
      role: string;
      content: unknown;
    }>;
    // The prefix must NOT form a separate user entry before the first tail user
    // message. Instead it is merged in: preserved[0] carries both the prefix
    // text and the tail prompt's text.
    const first = preserved[0];
    expect(first.role).toBe('user');
    const firstText =
      typeof first.content === 'string'
        ? (first.content as string)
        : (first.content as Array<{ type: string; text?: string }>)
            .map((b) => b.text ?? '')
            .join('');
    expect(firstText).toContain('[Earlier conversation');
    // The merged first-tail prompt text is also present (turn 2, content 'msg 2').
    expect(firstText).toContain('msg 2');
    // Crucially, preserved[0] is the only place the prefix lives — no separate
    // user prefix entry before it would make preserved[0] and preserved[1] both
    // user-role (the prefix+tail merge prevents that adjacency).
    if (preserved.length > 1) {
      // If there's a second entry, the merge worked: preserved[0] consumed what
      // would have been the standalone prefix. Verify the prefix text does NOT
      // appear again as a separate entry.
      const second = preserved[1];
      const secondText =
        typeof second.content === 'string'
          ? (second.content as string)
          : (second.content as Array<{ type: string; text?: string }>)
              .map((b) => b.text ?? '')
              .join('');
      expect(secondText).not.toContain('[Earlier conversation');
    }
  });

  it('preserves tool_use events in the tail as PreservedMessage with toolCalls + toolResults', async () => {
    // Build 11 earlier filler turns so earlier.length > 0 and compact() produces a real event.
    // The tool_use turn is the 11th — it lands in the tail (last 10 turns preserved verbatim).
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let i = 0; i < 10; i++) {
      events.push(event(seq++, 'prompt', { content: [], track: `slack:T${i}` }));
      events.push(turnStart(seq++, `fill_${i}`));
      events.push(turnEnd(seq++, `fill_${i}`));
    }
    // Turn 11 — the one with a tool call (goes to tail)
    events.push(
      event(seq++, 'prompt', {
        content: [{ type: 'text', text: 'use bash please' }],
        track: 'slack:A',
      })
    );
    events.push(turnStart(seq++, 'turn_tool'));
    events.push(
      event(
        seq++,
        'tool_use',
        {
          toolCallId: 'tc_1',
          name: 'bash',
          input: { command: 'echo hi' },
          result: { outcome: 'completed', content: [{ type: 'text', text: 'hi\n' }] },
        },
        'turn_tool'
      )
    );
    events.push(turnEnd(seq++, 'turn_tool'));

    const result = await compact(events, ctx);
    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) return;
    // 11 turns × 3 events = 33 total. Last 10 turns = 30 tail events; 3 earlier events.
    expect(result.compactionEvent.data.messagesCompacted).toBe(3);
    const preserved = result.compactionEvent.data.preserved as Array<{
      role: string;
      content: string | Array<{ type: string; text?: string }>;
      toolCalls?: unknown[];
      toolResults?: unknown[];
    }>;
    const contentText = (c: string | Array<{ type: string; text?: string }>) =>
      typeof c === 'string' ? c : c.map((b) => b.text ?? '').join('');
    const promptEntry = preserved.find(
      (p) => p.role === 'user' && contentText(p.content).includes('use bash')
    );
    expect(promptEntry).toBeDefined();
    const assistantWithToolCalls = preserved.find(
      (p) => p.role === 'assistant' && Array.isArray(p.toolCalls)
    );
    expect(assistantWithToolCalls?.toolCalls?.length).toBe(1);
    const userWithToolResults = preserved.find(
      (p) => p.role === 'user' && Array.isArray(p.toolResults)
    );
    expect(userWithToolResults?.toolResults?.length).toBe(1);
  });

  it('includes Subagent jobs section when job_started/job_finished have no track field', async () => {
    // job_started and job_finished carry jobId but no track field. They used to
    // fall through to the untracked bucket, causing (unknown) / ⏳ in-flight.
    // Place the job events before the last 10 tail turns so they end up in
    // the "earlier" section that gets compacted into the prefix.
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    // Top-level job events (no track field) — these come first
    events.push(
      event(seq++, 'job_started', {
        jobId: 'job_xyz',
        jobType: 'delegate',
        description: 'IP check',
      })
    );
    events.push(event(seq++, 'job_finished', { jobId: 'job_xyz', outcome: 'completed' }));
    // 11 turns after the job events; last 10 go to tail, 1 goes to earlier
    for (let i = 0; i < 11; i++) {
      events.push(event(seq++, 'prompt', { content: [], track: `slack:T${i}` }));
      events.push(turnStart(seq++, `turn_${i}`));
      events.push(turnEnd(seq++, `turn_${i}`));
    }

    const result = await compact(events, ctx);
    const firstEntry = result.compactionEvent.data.preserved[0] as {
      role: string;
      content: string | Array<{ type: string; text?: string }>;
    };
    const prefixText =
      typeof firstEntry.content === 'string'
        ? firstEntry.content
        : (firstEntry.content as Array<{ type: string; text?: string }>)
            .map((b) => b.text ?? '')
            .join('');
    expect(prefixText).toContain('IP check');
    expect(prefixText).toMatch(/completed/);
  });

  it('preserves context_injected events in the tail as user-role messages', async () => {
    // Fixture: one earlier turn (so there IS an earlier section) plus one tail
    // turn that contains a context_injected event.
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    // 11 filler turns to push earliest into earlier
    for (let i = 0; i < 11; i++) {
      events.push(event(seq++, 'prompt', { content: [], track: `slack:T${i}` }));
      events.push(turnStart(seq++, `turn_${i}`));
      events.push(turnEnd(seq++, `turn_${i}`));
    }
    // One final turn in the tail that has an injected context event
    events.push(
      event(seq++, 'context_injected', {
        content: [{ type: 'text', text: 'alarm fired: stand-up in 5 min' }],
        track: 'alarm:X',
      })
    );
    events.push(event(seq++, 'prompt', { content: [{ type: 'text', text: 'ack' }] }));
    events.push(turnStart(seq++, 'turn_tail'));
    events.push(turnEnd(seq++, 'turn_tail'));

    const result = await compact(events, ctx);
    const preserved = result.compactionEvent.data.preserved as Array<{
      role: string;
      content: string | Array<{ type: string; text?: string }>;
    }>;
    const contentText = (c: string | Array<{ type: string; text?: string }>) =>
      typeof c === 'string' ? c : c.map((b) => b.text ?? '').join('');
    const injectedEntry = preserved.find(
      (p) => p.role === 'user' && contentText(p.content).includes('alarm fired')
    );
    expect(injectedEntry).toBeDefined();
  });

  it('preserves image content blocks in tail prompts without flattening to text', async () => {
    // A prompt with an image block in the tail must survive compaction with the
    // image intact — extractText would silently drop it, losing visual context.
    // Build 11 turns so earlier.length > 0; the image prompt is the last turn (tail).
    const imageBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    };
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let i = 0; i < 10; i++) {
      events.push(event(seq++, 'prompt', { content: [], track: `slack:T${i}` }));
      events.push(turnStart(seq++, `fill_${i}`));
      events.push(turnEnd(seq++, `fill_${i}`));
    }
    events.push(
      event(seq++, 'prompt', { content: [{ type: 'text', text: 'look at this' }, imageBlock] })
    );
    events.push(turnStart(seq++, 'turn_img'));
    events.push(turnEnd(seq++, 'turn_img'));

    const result = await compact(events, ctx);
    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) return;
    const preserved = result.compactionEvent.data.preserved as Array<{
      role: string;
      content: unknown;
    }>;
    // Find the user entry whose content includes an image block
    const promptEntry = preserved.find(
      (p) =>
        p.role === 'user' &&
        Array.isArray(p.content) &&
        (p.content as Array<{ type: string }>).some((b) => b.type === 'image')
    );
    expect(promptEntry).toBeDefined();
    const blocks = promptEntry!.content as Array<{ type: string }>;
    expect(blocks.some((b) => b.type === 'image')).toBe(true);
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Live seam test: demuxByTrack(kernelAttributor) === groupEarlierEventsByTrack
// ---------------------------------------------------------------------------
// Proves kernelAttributor is correct and live — compact() now routes through
// demuxByTrack(kernelAttributor) rather than calling groupEarlierEventsByTrack
// directly. This test asserts that both paths produce identical group maps on a
// representative fixture covering all attribution branches:
//   - slack track (prompt + in-turn tool_use)
//   - job track (job_started / job_finished)
//   - turn-inherited in-turn events (tool_use, message inheriting from turnToTrack)
//   - untracked fallback (no track, no turnId in map)
//   - context_compacted filtered out by both paths
//   - mid-turn context_injected using its own track

describe('demuxByTrack(kernelAttributor) produces identical groups to groupEarlierEventsByTrack', () => {
  it('matches on a representative event set with all attribution branches', () => {
    const events: TypedDurableEvent[] = [
      // A context_compacted event — should be filtered by both paths
      event(1, 'context_compacted', { strategy: 'old', preserved: [] }),
      // Slack prompt → track 'slack:A'
      event(2, 'prompt', { content: [{ type: 'text', text: 'hi' }], track: 'slack:A' }),
      event(3, 'turn_start', {}, 'turn_1'),
      // In-turn tool_use → should inherit 'slack:A' via turnToTrack
      event(4, 'tool_use', { toolCallId: 'tc1', name: 'bash', input: {} }, 'turn_1'),
      // Mid-turn context_injected with its own track → 'alarm:X'
      event(5, 'context_injected', { content: [], track: 'alarm:X' }),
      event(6, 'message', { content: 'done' }, 'turn_1'),
      event(7, 'turn_end', { stopReason: 'end_turn' }, 'turn_1'),
      // Job lifecycle events → 'job:job_abc'
      event(8, 'job_started', { jobId: 'job_abc', jobType: 'delegate', description: 'deploy' }),
      event(9, 'job_finished', { jobId: 'job_abc', outcome: 'completed' }),
      // Prompt with no track → untracked
      event(10, 'prompt', { content: [{ type: 'text', text: 'legacy' }] }),
      // Event with turnId not in map → untracked fallback
      event(11, 'tool_use', { toolCallId: 'tc2', name: 'bash', input: {} }, 'unknown_turn'),
    ];

    const turnToTrack = buildTurnToTrackMap(events);

    // Reference: old groupEarlierEventsByTrack
    const expected = groupEarlierEventsByTrack(events, turnToTrack);

    // Live seam: demuxByTrack + kernelAttributor, with __skip__ bucket removed
    const groups = demuxByTrack(events, (e) => kernelAttributor(e, turnToTrack));
    groups.delete('__skip__');

    // Same keys, same order
    expect([...groups.keys()]).toEqual([...expected.keys()]);

    // Same event sequences per bucket
    for (const [track, evts] of expected) {
      expect(groups.get(track)?.map((e) => e.eventSeq)).toEqual(evts.map((e) => e.eventSeq));
    }
  });

  it('matches for turn-inherited tool_use and message events', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'slack:B' }),
      event(2, 'turn_start', {}, 'turn_X'),
      event(3, 'tool_use', { toolCallId: 'tc1', name: 'bash', input: {} }, 'turn_X'),
      event(4, 'message', { content: 'reply' }, 'turn_X'),
      event(5, 'turn_end', { stopReason: 'end_turn' }, 'turn_X'),
    ];

    const turnToTrack = buildTurnToTrackMap(events);
    const expected = groupEarlierEventsByTrack(events, turnToTrack);
    const groups = demuxByTrack(events, (e) => kernelAttributor(e, turnToTrack));
    groups.delete('__skip__');

    expect([...groups.keys()]).toEqual([...expected.keys()]);
    for (const [track, evts] of expected) {
      expect(groups.get(track)?.map((e) => e.eventSeq)).toEqual(evts.map((e) => e.eventSeq));
    }
    // Confirm all in-turn events are under 'slack:B', not untracked
    expect(groups.get('slack:B')?.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5]);
    expect(groups.get(UNTRACKED)).toBeUndefined();
  });
});
