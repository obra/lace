// ABOUTME: Unit tests for compaction/toolkit.ts pure exports
// ABOUTME: Covers demuxByTrack injected-attributor seam, salience helpers,
// ABOUTME: splitAtTailBoundary, buildPreservedTail, buildPreservedWithPrefix,
// ABOUTME: mergePreservedAdjacent, and renderGenericSections.

import { describe, it, expect } from 'vitest';
import type { DurableEventData, TypedDurableEvent } from '@lace/agent/storage/event-types';
import {
  demuxByTrack,
  splitAtTailBoundary,
  buildPreservedTail,
  buildPreservedWithPrefix,
  mergePreservedAdjacent,
  jobSalience,
  untrackedSalience,
  systemSalience,
  renderGenericSections,
  toNonEmptyString,
  coreToolResultFromProtocol,
  UNTRACKED,
  type TrackBlock,
} from '../toolkit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const event = (
  seq: number,
  type: DurableEventData['type'],
  data: Record<string, unknown>,
  turnId?: string
): TypedDurableEvent => ({
  eventSeq: seq,
  timestamp: `2026-06-03T00:00:${String(seq).padStart(2, '0')}Z`,
  ...(turnId ? { turnId } : {}),
  type,
  data: { type, ...data } as TypedDurableEvent['data'],
});

const turnStart = (seq: number, turnId: string) => event(seq, 'turn_start', {}, turnId);
const turnEnd = (seq: number, turnId: string) =>
  event(seq, 'turn_end', { stopReason: 'end_turn' }, turnId);

// ---------------------------------------------------------------------------
// toNonEmptyString (copied helper)
// ---------------------------------------------------------------------------

describe('toNonEmptyString', () => {
  it('returns the trimmed string when non-empty', () => {
    expect(toNonEmptyString('  hello  ')).toBe('hello');
  });

  it('returns null for empty or whitespace-only strings', () => {
    expect(toNonEmptyString('')).toBeNull();
    expect(toNonEmptyString('   ')).toBeNull();
  });

  it('returns null for non-string inputs', () => {
    expect(toNonEmptyString(42)).toBeNull();
    expect(toNonEmptyString(null)).toBeNull();
    expect(toNonEmptyString(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// coreToolResultFromProtocol (copied helper)
// ---------------------------------------------------------------------------

describe('coreToolResultFromProtocol', () => {
  it('maps completed outcome → completed status', () => {
    const result = coreToolResultFromProtocol(
      { outcome: 'completed', content: [{ type: 'text', text: 'ok' }] },
      'call-1'
    );
    expect(result.status).toBe('completed');
    expect(result.id).toBe('call-1');
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' });
  });

  it('maps denied → denied, cancelled → aborted, failed → failed', () => {
    expect(coreToolResultFromProtocol({ outcome: 'denied', content: [] }, 'id').status).toBe(
      'denied'
    );
    expect(coreToolResultFromProtocol({ outcome: 'cancelled', content: [] }, 'id').status).toBe(
      'aborted'
    );
    expect(coreToolResultFromProtocol({ outcome: 'failed', content: [] }, 'id').status).toBe(
      'failed'
    );
  });

  it('maps json content to serialized text', () => {
    const result = coreToolResultFromProtocol(
      { outcome: 'completed', content: [{ type: 'json', data: { x: 1 } }] },
      'id'
    );
    expect(result.content[0]).toEqual({ type: 'text', text: '{\n  "x": 1\n}' });
  });

  it('passes meta through as metadata', () => {
    const result = coreToolResultFromProtocol(
      { outcome: 'completed', content: [], meta: { threadId: 'abc' } },
      'id'
    );
    expect(result.metadata).toEqual({ threadId: 'abc' });
  });
});

// ---------------------------------------------------------------------------
// demuxByTrack — injected attributor seam
// ---------------------------------------------------------------------------

describe('demuxByTrack', () => {
  it('groups events by the string returned by attributeFn', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [] }),
      event(2, 'message', { content: 'hi' }),
      event(3, 'prompt', { content: [] }),
    ];

    // Custom attributor: group by event type
    const groups = demuxByTrack(events, (e) => e.type);

    expect(groups.get('prompt')?.map((e) => e.eventSeq)).toEqual([1, 3]);
    expect(groups.get('message')?.map((e) => e.eventSeq)).toEqual([2]);
  });

  it('returns an empty map for an empty event list', () => {
    const groups = demuxByTrack([], () => 'x');
    expect(groups.size).toBe(0);
  });

  it('groups all events under a single bucket when attributeFn returns a constant', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [] }),
      event(2, 'turn_start', {}, 't1'),
      event(3, 'turn_end', { stopReason: 'end_turn' }, 't1'),
    ];
    const groups = demuxByTrack(events, () => 'all');
    expect(groups.get('all')?.length).toBe(3);
  });

  it('supports a track-field-based attributor matching kernel behavior for simple cases', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [], track: 'ext:T:C:1.0' }),
      event(2, 'prompt', { content: [], track: 'system:bootstrap' }),
      event(3, 'prompt', { content: [] }), // no track → untracked
    ];
    // Simplified kernel-style attributor (no turnId inheritance — stateless)
    const simpleKernelAttr = (e: TypedDurableEvent): string => {
      const data = e.data as { track?: string };
      return data.track ?? UNTRACKED;
    };
    const groups = demuxByTrack(events, simpleKernelAttr);
    expect(groups.get('ext:T:C:1.0')?.map((e) => e.eventSeq)).toEqual([1]);
    expect(groups.get('system:bootstrap')?.map((e) => e.eventSeq)).toEqual([2]);
    expect(groups.get(UNTRACKED)?.map((e) => e.eventSeq)).toEqual([3]);
  });

  it('custom attributFn can implement job-bucketing', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'job_started', { jobId: 'job_a', jobType: 'delegate', description: 'check' }),
      event(2, 'job_finished', { jobId: 'job_a', outcome: 'completed' }),
      event(3, 'prompt', { content: [] }),
    ];
    const jobAttr = (e: TypedDurableEvent): string => {
      const data = e.data as { jobId?: string };
      if (data.jobId) return `job:${data.jobId}`;
      return UNTRACKED;
    };
    const groups = demuxByTrack(events, jobAttr);
    expect(groups.get('job:job_a')?.map((e) => e.eventSeq)).toEqual([1, 2]);
    expect(groups.get(UNTRACKED)?.map((e) => e.eventSeq)).toEqual([3]);
  });
});

// ---------------------------------------------------------------------------
// splitAtTailBoundary (re-exported from toolkit)
// ---------------------------------------------------------------------------

describe('splitAtTailBoundary (toolkit export)', () => {
  it('splits correctly into earlier and tail', () => {
    const events: TypedDurableEvent[] = [];
    let seq = 1;
    for (let t = 0; t < 5; t++) {
      events.push(event(seq++, 'prompt', { content: [], track: `t${t}` }));
      events.push(turnStart(seq++, `turn_${t}`));
      events.push(turnEnd(seq++, `turn_${t}`));
    }
    const { earlier, tail } = splitAtTailBoundary(events, 3);
    // 5 turns × 3 events. Last 3 turns = 9 tail events; 6 earlier.
    expect(tail.length).toBe(9);
    expect(earlier.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// jobSalience
// ---------------------------------------------------------------------------

describe('jobSalience', () => {
  it('renders description and completed outcome', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'job_started', { jobId: 'j1', jobType: 'delegate', description: 'run tests' }),
      event(2, 'job_finished', { jobId: 'j1', outcome: 'completed' }),
    ];
    const block = jobSalience('job:j1', events);
    expect(block.body).toContain('run tests');
    expect(block.body).toContain('completed');
    expect(block.trackId).toBe('job:j1');
  });

  it('shows ⏳ in-flight when no job_finished event', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'job_started', { jobId: 'j2', jobType: 'delegate', description: 'long job' }),
    ];
    const block = jobSalience('job:j2', events);
    expect(block.body).toContain('in-flight');
  });

  it('shows failed outcome', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'job_started', { jobId: 'j3', jobType: 'delegate', description: 'crash' }),
      event(2, 'job_finished', { jobId: 'j3', outcome: 'failed' }),
    ];
    const block = jobSalience('job:j3', events);
    expect(block.body).toContain('✗ failed');
  });
});

// ---------------------------------------------------------------------------
// untrackedSalience
// ---------------------------------------------------------------------------

describe('untrackedSalience', () => {
  it('extracts User/Assistant/Note prose', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'hello' }] }),
      event(2, 'turn_start', {}, 't1'),
      event(3, 'message', { content: 'world' }, 't1'),
      event(4, 'turn_end', { stopReason: 'end_turn' }, 't1'),
    ];
    const block = untrackedSalience(UNTRACKED, events);
    expect(block.body).toContain('User: hello');
    expect(block.body).toContain('Assistant: world');
  });

  it('emits (empty) when no prose events', () => {
    const block = untrackedSalience(UNTRACKED, [event(1, 'turn_start', {}, 't1')]);
    expect(block.body).toBe('(empty)');
  });

  it('emits Note: for context_injected events', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', {
        content: [{ type: 'text', text: 'injected note' }],
      }),
    ];
    const block = untrackedSalience(UNTRACKED, events);
    expect(block.body).toContain('Note: injected note');
  });
});

// ---------------------------------------------------------------------------
// systemSalience
// ---------------------------------------------------------------------------

describe('systemSalience', () => {
  it('returns null for alarm: tracks', () => {
    expect(systemSalience('alarm:X', [])).toBeNull();
  });

  it('returns null for reminder: tracks', () => {
    expect(systemSalience('reminder:R', [])).toBeNull();
  });

  it('returns null for system:bootstrap', () => {
    expect(systemSalience('system:bootstrap', [])).toBeNull();
  });

  it('returns count-only block for system:idle-errors', () => {
    const events = [
      event(1, 'context_injected', { content: [], track: 'system:idle-errors' }),
      event(2, 'context_injected', { content: [], track: 'system:idle-errors' }),
    ];
    const block = systemSalience('system:idle-errors', events);
    expect(block).not.toBeNull();
    expect(block?.body).toMatch(/2 idle-error reports/);
  });

  it('returns null for unknown system: tracks', () => {
    expect(systemSalience('system:unknown-thing', [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPreservedTail
// ---------------------------------------------------------------------------

describe('buildPreservedTail', () => {
  it('converts prompts to user-role entries', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'prompt', { content: [{ type: 'text', text: 'hi' }] }),
    ];
    const tail = buildPreservedTail(events);
    expect(tail.length).toBe(1);
    expect(tail[0].role).toBe('user');
  });

  it('converts messages to assistant-role entries', () => {
    const events: TypedDurableEvent[] = [event(1, 'message', { content: 'reply' })];
    const tail = buildPreservedTail(events);
    expect(tail.length).toBe(1);
    expect(tail[0].role).toBe('assistant');
  });

  it('converts context_injected to user-role entries', () => {
    const events: TypedDurableEvent[] = [
      event(1, 'context_injected', { content: [{ type: 'text', text: 'injected' }] }),
    ];
    const tail = buildPreservedTail(events);
    expect(tail.length).toBe(1);
    expect(tail[0].role).toBe('user');
  });

  it('coalesces consecutive tool_use events: appends toolCalls to prev assistant, toolResults to prev user', () => {
    // Two consecutive tool_use events with results:
    // tc1 → [assistant(tc1), user(tc1-result)]
    // tc2 → last is user (with results), so new assistant created; result coalesces
    //   into prior user-with-results → [assistant(tc1), user(tc1+tc2 results), assistant(tc2)]
    // Actually: tc2 sees last=user-with-results, creates new assistant. Then tc2's result
    // sees last=assistant (no results), so new user entry: [ast(tc1), usr(tc1-result), ast(tc2), usr(tc2-result)]
    // The key behavior: tool_use coalesces toolCall into prev assistant, toolResult into
    // prev user-with-results (if any). With interleaved results, each pair is separate.
    const events: TypedDurableEvent[] = [
      event(
        1,
        'tool_use',
        {
          toolCallId: 'tc1',
          name: 'bash',
          input: { command: 'ls' },
          result: { outcome: 'completed', content: [{ type: 'text', text: 'file' }] },
        },
        'turn_1'
      ),
      event(
        2,
        'tool_use',
        {
          toolCallId: 'tc2',
          name: 'bash',
          input: { command: 'pwd' },
          result: { outcome: 'completed', content: [{ type: 'text', text: '/tmp' }] },
        },
        'turn_1'
      ),
    ];
    const tail = buildPreservedTail(events);
    // Each tool_use with a result produces: assistant(toolCall) + user(toolResult)
    // The second tool_use sees last=user-with-results so creates new assistant.
    // Result: [assistant(tc1), user(tc1-result), assistant(tc2), user(tc2-result)]
    const assistants = tail.filter((e) => e.role === 'assistant');
    const users = tail.filter((e) => e.role === 'user' && Array.isArray(e.toolResults));
    expect(assistants.length).toBe(2);
    expect(users.length).toBe(2);
    expect(assistants[0].toolCalls?.[0]).toMatchObject({ id: 'tc1', name: 'bash' });
    expect(assistants[1].toolCalls?.[0]).toMatchObject({ id: 'tc2', name: 'bash' });
  });

  it('coalesces multiple tool_calls into one assistant entry when no results interleave', () => {
    // Two tool_use events WITHOUT results — both toolCalls go into same assistant entry.
    const events: TypedDurableEvent[] = [
      event(1, 'tool_use', { toolCallId: 'tc1', name: 'bash', input: {} }, 'turn_1'),
      event(2, 'tool_use', { toolCallId: 'tc2', name: 'bash', input: {} }, 'turn_1'),
    ];
    const tail = buildPreservedTail(events);
    // No results → coalesced: [assistant(tc1, tc2)]
    expect(tail.length).toBe(1);
    expect(tail[0].role).toBe('assistant');
    expect(tail[0].toolCalls?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildPreservedWithPrefix
// ---------------------------------------------------------------------------

describe('buildPreservedWithPrefix', () => {
  it('prepends a standalone user prefix when tail starts with assistant', () => {
    const tail = [{ role: 'assistant' as const, content: 'hello' }];
    const result = buildPreservedWithPrefix('PREFIX', tail);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('PREFIX');
    expect(result[1].role).toBe('assistant');
  });

  it('merges prefix into first user entry to avoid consecutive user roles', () => {
    const tail = [{ role: 'user' as const, content: 'original' }];
    const result = buildPreservedWithPrefix('PREFIX', tail);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('PREFIX\n\noriginal');
  });

  it('merges prefix into ContentBlock[] first user entry', () => {
    const tail = [
      {
        role: 'user' as const,
        content: [{ type: 'text', text: 'block' }] as Array<{ type: string; text: string }>,
      },
    ];
    const result = buildPreservedWithPrefix('PREFIX', tail);
    expect(result.length).toBe(1);
    expect(Array.isArray(result[0].content)).toBe(true);
    const blocks = result[0].content as Array<{ type: string; text?: string }>;
    expect(blocks[0]).toEqual({ type: 'text', text: 'PREFIX' });
    expect(blocks[1]).toEqual({ type: 'text', text: 'block' });
  });

  it('produces a standalone prefix entry when tail is empty', () => {
    const result = buildPreservedWithPrefix('PREFIX', []);
    expect(result.length).toBe(1);
    expect(result[0].content).toBe('PREFIX');
  });
});

// ---------------------------------------------------------------------------
// mergePreservedAdjacent
// ---------------------------------------------------------------------------

describe('mergePreservedAdjacent', () => {
  it('merges consecutive same-role entries', () => {
    const entries = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
    ];
    const result = mergePreservedAdjacent(entries);
    expect(result.length).toBe(2);
    expect(result[0].content).toContain('a');
    expect(result[0].content).toContain('b');
  });

  it('drops empty entries', () => {
    const entries = [
      { role: 'user', content: '' },
      { role: 'assistant', content: 'non-empty' },
    ];
    const result = mergePreservedAdjacent(entries);
    // Leading empty user dropped; assistant becomes first but is not user-role → dropped
    // Actually: empty user dropped, assistant is first → not user-role → forced
    // The logic merges leading assistant into following user or drops it if alone.
    // Here there's no following user, so the assistant is dropped.
    expect(result.length).toBe(0);
  });

  it('ensures leading entry is user-role', () => {
    const entries = [
      { role: 'assistant', content: 'first' },
      { role: 'user', content: 'second' },
    ];
    const result = mergePreservedAdjacent(entries);
    expect(result[0].role).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// renderGenericSections
// ---------------------------------------------------------------------------

describe('renderGenericSections', () => {
  it('renders header + job + system sections', () => {
    const blocks: TrackBlock[] = [
      { trackId: 'job:j1', body: '- job:j1 run tests → ✓ completed', estimatedTokens: 10 },
      { trackId: 'untracked', body: 'User: hello', estimatedTokens: 5 },
    ];
    const out = renderGenericSections({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).toContain('[Earlier conversation, compacted by track]');
    expect(out).toContain('## Subagent jobs');
    expect(out).toContain('run tests');
    expect(out).toContain('## System events');
    expect(out).toContain('User: hello');
  });

  it('renders scheduler section when alarms or reminders are pending', () => {
    const out = renderGenericSections({
      blocks: [],
      scheduler: { alarmsPending: 2, remindersPending: 1 },
    });
    expect(out).toContain('## Scheduler');
    expect(out).toContain('2 alarms pending');
    expect(out).toContain('1 reminder pending');
  });

  it('injects extraSections content when provided', () => {
    const extraSections = '\n## Plugin section\n\n<plugin-content ref="x"></plugin-content>';
    const out = renderGenericSections(
      { blocks: [], scheduler: { alarmsPending: 0, remindersPending: 0 } },
      extraSections
    );
    expect(out).toContain('## Plugin section');
    expect(out).toContain('<plugin-content');
  });

  it('extraSections appears before job section', () => {
    const extraSections = '\n## Plugin section\n\nextra content';
    const blocks: TrackBlock[] = [{ trackId: 'job:j1', body: 'job content', estimatedTokens: 5 }];
    const out = renderGenericSections(
      { blocks, scheduler: { alarmsPending: 0, remindersPending: 0 } },
      extraSections
    );
    const extraIdx = out.indexOf('extra content');
    const jobIdx = out.indexOf('job content');
    expect(extraIdx).toBeLessThan(jobIdx);
  });

  it('renders other section for non-standard track prefixes', () => {
    const blocks: TrackBlock[] = [
      { trackId: 'custom:foo', body: 'custom content', estimatedTokens: 5 },
    ];
    const out = renderGenericSections({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).toContain('## Other');
    expect(out).toContain('custom content');
  });

  it('skips empty sections', () => {
    const out = renderGenericSections({
      blocks: [],
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).not.toContain('## Subagent jobs');
    expect(out).not.toContain('## Scheduler');
    expect(out).not.toContain('## System events');
    expect(out).not.toContain('## Other');
  });
});
