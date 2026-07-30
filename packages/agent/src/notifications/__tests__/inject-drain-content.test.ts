// ABOUTME: Unit tests for the inject-drain follow-up content decision: an empty
// ABOUTME: prompt is only safe while the conversation still ends on a user
// ABOUTME: message; once an assistant message trails it, the drain must carry
// ABOUTME: content or the dispatched request is an assistant prefill.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { injectDrainContent } from '../inject-drain-content';

describe('injectDrainContent', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'inject-drain-content-'));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  /** Write durable events as the session's JSONL shard. */
  function writeEvents(events: Array<Record<string, unknown>>): void {
    mkdirSync(sessionDir, { recursive: true });
    const lines = events
      .map((e, i) => JSON.stringify({ eventSeq: i + 1, timestamp: new Date().toISOString(), ...e }))
      .join('\n');
    writeFileSync(join(sessionDir, 'events.jsonl'), `${lines}\n`);
  }

  const userText = (text: string) => ({
    type: 'prompt',
    data: { content: [{ type: 'text', text }] },
  });
  const assistantText = (text: string) => ({
    type: 'message',
    data: { content: [{ type: 'text', text }] },
  });
  const injected = (text: string) => ({
    type: 'context_injected',
    data: { content: [{ type: 'text', text }], priority: 'immediate' },
  });

  it('returns empty content when the inject is still the last message', () => {
    // The healthy shape: nothing followed the inject, so it is already the
    // trailing user message and an empty prompt surfaces it as-is.
    writeEvents([userText('hi'), assistantText('hello'), injected('job finished')]);

    expect(injectDrainContent(sessionDir)).toEqual([]);
  });

  it('returns a nudge when an assistant message trails the inject', () => {
    // The wedge shape: the turn answered something else after the inject
    // landed, so the conversation now ends on an assistant message.
    writeEvents([userText('hi'), injected('news?'), assistantText('unrelated reply')]);

    const content = injectDrainContent(sessionDir);

    expect(content.length).toBe(1);
    expect(content[0]?.type).toBe('text');
    expect(content[0]?.text).toContain('<system-reminder>');
    expect(content[0]?.text.length).toBeGreaterThan(0);
  });

  it('returns a nudge when a tool call with no result trails the inject', () => {
    // An unresolved tool_use folds to an assistant message too.
    writeEvents([
      userText('hi'),
      injected('news?'),
      { type: 'tool_use', data: { toolCallId: 'c1', name: 'bash', input: {} } },
    ]);

    expect(injectDrainContent(sessionDir)).toHaveLength(1);
  });

  it('returns empty content when a completed tool call trails the inject', () => {
    // A tool_use WITH a result folds to assistant + user(tool_result), so the
    // conversation ends on the user and an empty prompt is valid.
    writeEvents([
      userText('hi'),
      injected('news?'),
      {
        type: 'tool_use',
        data: {
          toolCallId: 'c1',
          name: 'bash',
          input: {},
          result: { content: [{ type: 'text', text: 'ok' }], isError: false },
        },
      },
    ]);

    expect(injectDrainContent(sessionDir)).toEqual([]);
  });

  it('returns empty content for an unreadable session dir rather than throwing', () => {
    // The drain must never be the thing that breaks a turn.
    expect(injectDrainContent(join(sessionDir, 'does-not-exist'))).toEqual([]);
  });
});
