// ABOUTME: Pins that a subagent session's projection stamps every received message
// ABOUTME: (prompts and context injections) with its own event time, that root
// ABOUTME: sessions render unchanged, and that the stamped rebuild is deterministic.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildProviderMessagesFromDurableEvents,
  buildProviderMessagesFromParsedEvents,
} from '@lace/agent/message-building/message-builder';
import { readParsedSessionEvents } from '@lace/agent/message-building/parsed-events';
import {
  initialCachedProjection,
  foldTailIntoProjection,
  projectTurnEntry,
  type CachedProjection,
} from '@lace/agent/message-building/incremental-projection';
import { loadTurnEntryProjection } from '@lace/agent/message-building/turn-entry-projection';

const T1 = '2026-10-21T16:24:06.123Z';
const T2 = '2026-10-21T17:00:00.000Z';
const T3 = '2026-10-21T17:05:30.500Z';
const T4 = '2026-10-21T17:06:00.000Z';
const meta = (t: string) =>
  `<message_meta sent_at="${new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')}"/>`;

function line(eventSeq: number, timestamp: string, type: string, data: Record<string, unknown>) {
  return JSON.stringify({ eventSeq, timestamp, type, data });
}

// A subagent's life: task prompt, a tool turn, two injects that merge into the
// tool_result user message, the assistant reply, then a delegate(resume=...)
// follow-up prompt.
const LOG = [
  line(1, T1, 'system_prompt_set', { text: 'sys' }),
  line(2, T1, 'prompt', { content: [{ type: 'text', text: 'research the thing' }] }),
  line(3, T2, 'tool_use', {
    toolCallId: 'tc1',
    name: 'bash',
    input: { command: 'ls' },
    result: { outcome: 'completed', content: [{ type: 'text', text: 'out' }] },
  }),
  line(4, T2, 'context_injected', {
    priority: 'immediate',
    content: [{ type: 'text', text: 'job finished' }],
  }),
  line(5, T3, 'context_injected', {
    priority: 'immediate',
    content: [{ type: 'text', text: 'reminder fired' }],
  }),
  line(6, T3, 'message', { content: 'done' }),
  line(7, T4, 'prompt', { content: [{ type: 'text', text: 'follow up please' }] }),
];

describe('subagent sent_at stamping at projection time', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-sentat-proj-'));
    writeFileSync(join(dir, 'events.jsonl'), LOG.join('\n') + '\n', 'utf8');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeMeta(parent: boolean): void {
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({
        sessionId: 'sess_00000000-0000-4000-8000-0000000000c1',
        workDir: '/tmp',
        created: T1,
        ...(parent ? { parent: { sessionId: 'sess_parent', jobId: 'job_1' } } : {}),
      })
    );
  }

  it('stamps the task prompt, the follow-up prompt, and each merged inject segment', () => {
    writeMeta(true);
    const { messages } = buildProviderMessagesFromDurableEvents(dir);

    expect(messages[0]).toEqual({ role: 'user', content: `${meta(T1)}\nresearch the thing` });
    // The two injects merge into the tool_result user message; each keeps its own stamp.
    expect(messages[2]!.role).toBe('user');
    expect(messages[2]!.toolResults).toHaveLength(1);
    expect(messages[2]!.content).toBe(`${meta(T2)}\njob finished\n${meta(T3)}\nreminder fired`);
    expect(messages[3]).toEqual({ role: 'assistant', content: 'done' });
    expect(messages[4]).toEqual({ role: 'user', content: `${meta(T4)}\nfollow up please` });
  });

  it('leaves a root session byte-for-byte unstamped', () => {
    writeMeta(false);
    const { messages } = buildProviderMessagesFromDurableEvents(dir);
    expect(JSON.stringify(messages)).not.toContain('message_meta');
    expect(messages[0]).toEqual({ role: 'user', content: 'research the thing' });
    expect(messages[2]!.content).toBe('job finished\nreminder fired');
  });

  it('rebuilds identically every time, and incrementally at every split', () => {
    writeMeta(true);
    const first = JSON.stringify(buildProviderMessagesFromDurableEvents(dir));
    const second = JSON.stringify(buildProviderMessagesFromDurableEvents(dir));
    expect(second).toBe(first);

    const events = readParsedSessionEvents(dir);
    const full = buildProviderMessagesFromParsedEvents(events, { stampSentAt: true });
    expect(JSON.stringify(full)).toBe(first);
    for (let k = 0; k <= events.length; k++) {
      let proj = initialCachedProjection('', true);
      proj = foldTailIntoProjection(proj, events.slice(0, k));
      proj = foldTailIntoProjection(proj, events.slice(k));
      expect(JSON.stringify(proj.messages)).toBe(JSON.stringify(full.messages));
    }
  });

  it('projectTurnEntry stamps on the cold seed and on the incremental tail', () => {
    writeMeta(true);
    writeFileSync(join(dir, 'events.jsonl'), LOG.slice(0, 6).join('\n') + '\n', 'utf8');
    writeFileSync(join(dir, '.seq'), '7', 'utf8');
    const cache = new Map<string, CachedProjection>();

    const cold = projectTurnEntry(dir, '/tmp', cache, 'sess_child');
    expect(cold.messages[0]!.content).toBe(`${meta(T1)}\nresearch the thing`);

    appendFileSync(join(dir, 'events.jsonl'), LOG[6] + '\n', 'utf8');
    writeFileSync(join(dir, '.seq'), '8', 'utf8');
    const warm = projectTurnEntry(dir, '/tmp', cache, 'sess_child');
    expect(warm.messages[warm.messages.length - 1]).toEqual({
      role: 'user',
      content: `${meta(T4)}\nfollow up please`,
    });
    expect(JSON.stringify(warm.messages)).toBe(
      JSON.stringify(loadTurnEntryProjection(dir, '/tmp').messages)
    );
  });
});
