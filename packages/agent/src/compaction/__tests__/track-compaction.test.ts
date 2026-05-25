// ABOUTME: Tests for track-based compaction — demux, salience, render, orchestrator
// ABOUTME: Pure-function tests over synthetic TypedDurableEvent[] fixtures

import { describe, it, expect } from 'vitest';
import {
  buildTurnToTrackMap,
  groupEarlierEventsByTrack,
  salienceForTrack,
} from '../track-compaction';
import type { DurableEventData, TypedDurableEvent } from '@lace/agent/storage/event-types';

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
              text: '<messages channel="C1" thread_ts="1.0"><current count="1"><slack_message user="U1">hello</slack_message></current></messages>',
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
    expect(block?.body).toContain('hello');
    expect(block?.body).toContain('hi back');
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
});
