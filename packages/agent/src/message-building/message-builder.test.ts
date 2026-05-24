// ABOUTME: Tests for buildProviderMessagesFromDurableEvents — read-time recovery,
// ABOUTME: system prompt recovery from system_prompt_set events, and
// ABOUTME: context_injected → role:user conversion.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProviderMessagesFromDurableEvents } from './message-builder';
import { logger } from '@lace/agent/utils/logger';

function writeEvents(dir: string, events: unknown[]): void {
  writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

describe('buildProviderMessagesFromDurableEvents — orphan tool_result recovery', () => {
  let tempDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-msg-builder-orphan-'));
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('drops a user tool_result whose toolCallId has no matching prior assistant tool_use', () => {
    // context_compacted with a preserved array that has an orphan tool_result
    // followed by a properly-paired tool_use/tool_result.
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        summary: 'Previously: did things.',
        preserved: [
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'orphan-1', status: 'completed', content: [{ type: 'text', text: 'orphan' }] },
            ],
          },
          {
            role: 'user',
            content: 'real user message',
          },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'paired-1', name: 'bash', arguments: { command: 'echo hi' } }],
          },
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'paired-1', status: 'completed', content: [{ type: 'text', text: 'hi' }] },
            ],
          },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // First message is the summary as a system message.
    // The orphan user msg should be dropped entirely (empty content + only orphaned toolResults).
    // The user "real user message" should remain.
    // The assistant tool_use + paired tool_result should remain adjacent.
    const userToolResultMessages = messages.filter(
      (m) => m.role === 'user' && Array.isArray(m.toolResults) && m.toolResults.length > 0
    );

    expect(userToolResultMessages).toHaveLength(1);
    expect(userToolResultMessages[0]!.toolResults![0]!.id).toBe('paired-1');

    // Verify the paired tool_result is adjacent to its tool_use.
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role === 'user' && m.toolResults && m.toolResults.length > 0) {
        const prev = messages[i - 1];
        expect(prev).toBeDefined();
        expect(prev!.role).toBe('assistant');
        const callIds = (prev!.toolCalls || []).map((c) => c.id);
        for (const tr of m.toolResults) {
          expect(callIds).toContain(tr.id);
        }
      }
    }

    // WARN was logged with the orphan's toolCallId.
    expect(warnSpy).toHaveBeenCalled();
    const warnedArgs = warnSpy.mock.calls.flat().map((a) => JSON.stringify(a));
    expect(warnedArgs.some((s) => s.includes('orphan-1'))).toBe(true);
  });

  it('drops only the orphaned toolResult entries when a message has a mix', () => {
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        summary: '',
        preserved: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'good-1', name: 'bash', arguments: {} }],
          },
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'good-1', status: 'completed', content: [{ type: 'text', text: 'ok' }] },
              { id: 'bad-1', status: 'completed', content: [{ type: 'text', text: 'orphan' }] },
            ],
          },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    const userTR = messages.find(
      (m) => m.role === 'user' && Array.isArray(m.toolResults) && m.toolResults.length > 0
    );
    expect(userTR).toBeDefined();
    expect(userTR!.toolResults!.map((tr) => tr.id)).toEqual(['good-1']);

    expect(warnSpy).toHaveBeenCalled();
    const warnedArgs = warnSpy.mock.calls.flat().map((a) => JSON.stringify(a));
    expect(warnedArgs.some((s) => s.includes('bad-1'))).toBe(true);
  });

  it('drops a user message entirely when all its toolResults are orphaned and content is empty', () => {
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        summary: '',
        preserved: [
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'orphan-A', status: 'completed', content: [{ type: 'text', text: 'a' }] },
              { id: 'orphan-B', status: 'completed', content: [{ type: 'text', text: 'b' }] },
            ],
          },
          {
            role: 'user',
            content: 'keep me',
          },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // The all-orphan user message should be dropped entirely.
    const userMsgsWithToolResults = messages.filter(
      (m) => m.role === 'user' && Array.isArray(m.toolResults) && m.toolResults.length > 0
    );
    expect(userMsgsWithToolResults).toHaveLength(0);

    const userMsgsWithContent = messages.filter(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content === 'keep me'
    );
    expect(userMsgsWithContent).toHaveLength(1);
  });

  it('preserves Ada-shape pattern (user-then-tool-result orphans) cleanly', () => {
    // Mimics what summarize-strategy currently emits:
    // pure user messages first, then recent non-user events including tool_results
    // whose tool_uses live in the older (summarized-away) events.
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        summary: 'Summary of older work',
        preserved: [
          { role: 'user', content: 'turn 1' },
          { role: 'user', content: 'turn 2' },
          // Tool_result with no preceding assistant tool_use — orphaned.
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'lost-toolcall', status: 'completed', content: [{ type: 'text', text: 'x' }] },
            ],
          },
          // Properly paired tool_use + tool_result.
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'kept-1', name: 'bash', arguments: {} }],
          },
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'kept-1', status: 'completed', content: [{ type: 'text', text: 'y' }] },
            ],
          },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // Validate no orphan tool_results survive.
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role === 'user' && Array.isArray(m.toolResults) && m.toolResults.length > 0) {
        const prev = messages[i - 1];
        expect(prev).toBeDefined();
        expect(prev!.role).toBe('assistant');
        const callIds = (prev!.toolCalls || []).map((c) => c.id);
        for (const tr of m.toolResults) {
          expect(callIds).toContain(tr.id);
        }
      }
    }
  });
});

describe('buildProviderMessagesFromDurableEvents — context_compacted summary routing', () => {
  let tempDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-msg-builder-compacted-'));
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('emits the compaction summary as role:user, not role:system', () => {
    writeEvents(tempDir, [
      {
        type: 'context_compacted',
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        data: {
          summary: 'Previously: the user asked about foo and bar.',
          preserved: [],
        },
      },
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
  });

  it('wraps the compaction summary in <previous-context-summary> tags', () => {
    const summaryText = 'Previously: the user asked about foo and bar.';
    writeEvents(tempDir, [
      {
        type: 'context_compacted',
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        data: {
          summary: summaryText,
          preserved: [],
        },
      },
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages).toHaveLength(1);
    const content = messages[0]!.content as string;
    expect(content).toContain('<previous-context-summary>');
    expect(content).toContain('</previous-context-summary>');
    expect(content).toContain(summaryText);
    // Summary text must appear between the tags
    const openTag = '<previous-context-summary>';
    const closeTag = '</previous-context-summary>';
    const openIdx = content.indexOf(openTag);
    const closeIdx = content.indexOf(closeTag);
    const textIdx = content.indexOf(summaryText);
    expect(openIdx).toBeLessThan(textIdx);
    expect(textIdx).toBeLessThan(closeIdx);
  });

  it('omits the summary message entirely when the summary is empty', () => {
    writeEvents(tempDir, [
      {
        type: 'context_compacted',
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        data: {
          summary: '',
          preserved: [{ role: 'user', content: 'preserved turn' }],
        },
      },
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // No summary message should be emitted; only the preserved turn.
    expect(
      messages.some(
        (m) => typeof m.content === 'string' && m.content.includes('<previous-context-summary>')
      )
    ).toBe(false);
    expect(messages.some((m) => m.content === 'preserved turn')).toBe(true);
  });
});

describe('buildProviderMessagesFromDurableEvents — system_prompt_set and context_injected', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-msg-builder-sps-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns the system prompt text from a system_prompt_set event', () => {
    writeEvents(tempDir, [
      {
        eventSeq: 1,
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: 'You are Lace.' },
      },
      {
        eventSeq: 2,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
      },
    ]);

    const result = buildProviderMessagesFromDurableEvents(tempDir);
    expect(result.systemPrompt).toBe('You are Lace.');
    expect(result.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('converts context_injected events to role:user messages (not role:system)', () => {
    writeEvents(tempDir, [
      {
        eventSeq: 1,
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: 'sys' },
      },
      {
        eventSeq: 2,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
      },
      {
        eventSeq: 3,
        type: 'context_injected',
        data: { type: 'context_injected', content: [{ type: 'text', text: 'runtime nudge' }] },
      },
    ]);

    const result = buildProviderMessagesFromDurableEvents(tempDir);
    expect(result.systemPrompt).toBe('sys');
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'runtime nudge' },
    ]);
  });

  it('returns empty systemPrompt when no system_prompt_set or pre-prompt context_injected events exist', () => {
    writeEvents(tempDir, [
      {
        eventSeq: 1,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
      },
    ]);

    const result = buildProviderMessagesFromDurableEvents(tempDir);
    expect(result.systemPrompt).toBe('');
    expect(result.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('uses the LAST system_prompt_set event when multiple exist (defensive)', () => {
    writeEvents(tempDir, [
      {
        eventSeq: 1,
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: 'first' },
      },
      {
        eventSeq: 2,
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: 'second' },
      },
      {
        eventSeq: 3,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
      },
    ]);

    const result = buildProviderMessagesFromDurableEvents(tempDir);
    expect(result.systemPrompt).toBe('second');
  });

  it('legacy session — uses pre-prompt context_injected events as systemPrompt when no system_prompt_set exists', () => {
    writeEvents(tempDir, [
      // Two pre-prompt context_injected events: legacy persona + userInstructions
      {
        eventSeq: 1,
        type: 'context_injected',
        data: { type: 'context_injected', content: [{ type: 'text', text: 'Legacy persona.' }] },
      },
      {
        eventSeq: 2,
        type: 'context_injected',
        data: {
          type: 'context_injected',
          content: [{ type: 'text', text: 'Legacy user instructions.' }],
        },
      },
      // First prompt event ends the "system prompt" run
      {
        eventSeq: 3,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
      },
      // Post-prompt context_injected → role:user
      {
        eventSeq: 4,
        type: 'context_injected',
        data: { type: 'context_injected', content: [{ type: 'text', text: 'runtime nudge' }] },
      },
    ]);

    const result = buildProviderMessagesFromDurableEvents(tempDir);
    expect(result.systemPrompt).toBe('Legacy persona.\n\nLegacy user instructions.');
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'runtime nudge' },
    ]);
  });

  it('legacy migration is bypassed when a system_prompt_set event is present (new session takes precedence)', () => {
    writeEvents(tempDir, [
      {
        eventSeq: 1,
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: 'New session sys prompt.' },
      },
      {
        eventSeq: 2,
        type: 'context_injected',
        data: {
          type: 'context_injected',
          content: [{ type: 'text', text: 'Pre-prompt context.' }],
        },
      },
      {
        eventSeq: 3,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
      },
      {
        eventSeq: 4,
        type: 'context_injected',
        data: {
          type: 'context_injected',
          content: [{ type: 'text', text: 'Post-prompt runtime nudge.' }],
        },
      },
    ]);

    const result = buildProviderMessagesFromDurableEvents(tempDir);
    expect(result.systemPrompt).toBe('New session sys prompt.');
    expect(result.messages).toEqual([
      { role: 'user', content: 'Pre-prompt context.' },
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'Post-prompt runtime nudge.' },
    ]);
  });

  describe('Fix #2 — legacy session: peer context_injected after non-context_injected events', () => {
    // A peer process (e.g. reminder scheduler) can write a context_injected
    // event to a legacy session BEFORE the user's first prompt but AFTER some
    // other event type (e.g. turn_start). That inject must NOT be absorbed into
    // the synthesized systemPrompt; it must appear as a role:user message.

    it('only absorbs creation-time context_injected events (leading run) into systemPrompt', () => {
      writeEvents(tempDir, [
        // Creation-time inject — should become systemPrompt
        {
          eventSeq: 1,
          type: 'context_injected',
          data: { content: [{ type: 'text', text: 'Creation-time persona.' }] },
        },
        // A non-context_injected event written by an early run() invocation
        {
          eventSeq: 2,
          type: 'turn_start',
          data: {},
        },
        // Peer inject written AFTER the turn_start — must NOT be in systemPrompt
        {
          eventSeq: 3,
          type: 'context_injected',
          data: { content: [{ type: 'text', text: 'Peer reminder inject.' }] },
        },
        // The actual user prompt
        {
          eventSeq: 4,
          type: 'prompt',
          data: { content: [{ type: 'text', text: 'Hello.' }] },
        },
      ]);

      const { systemPrompt, messages } = buildProviderMessagesFromDurableEvents(tempDir);

      // Only the leading creation-time inject makes it into the system prompt.
      expect(systemPrompt).toBe('Creation-time persona.');

      // The peer inject must appear as a role:user message, not be absorbed.
      const peerMsg = messages.find(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('Peer reminder inject.')
      );
      expect(peerMsg).toBeDefined();

      // The prompt also appears as role:user.
      const promptMsg = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string' && m.content === 'Hello.'
      );
      expect(promptMsg).toBeDefined();
    });

    it('treats a context_injected immediately following a turn_start as peer inject (role:user)', () => {
      // Specifically tests the turn_start-as-separator scenario mentioned in the spec.
      writeEvents(tempDir, [
        {
          eventSeq: 1,
          type: 'turn_start',
          data: {},
        },
        {
          eventSeq: 2,
          type: 'context_injected',
          data: { content: [{ type: 'text', text: 'Late inject.' }] },
        },
        {
          eventSeq: 3,
          type: 'prompt',
          data: { content: [{ type: 'text', text: 'Hi.' }] },
        },
      ]);

      const { systemPrompt, messages } = buildProviderMessagesFromDurableEvents(tempDir);

      // No creation-time context_injected events — systemPrompt must be empty.
      expect(systemPrompt).toBe('');

      // The late inject appears as a role:user message.
      expect(messages.some((m) => m.role === 'user' && m.content === 'Late inject.')).toBe(true);
    });
  });

  describe('Fix #3 — multiple system_prompt_set events warn', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('does NOT warn when exactly one system_prompt_set event is present', () => {
      writeEvents(tempDir, [
        {
          eventSeq: 1,
          type: 'system_prompt_set',
          data: { text: 'Only one.' },
        },
        {
          eventSeq: 2,
          type: 'prompt',
          data: { content: [{ type: 'text', text: 'hi' }] },
        },
      ]);

      buildProviderMessagesFromDurableEvents(tempDir);

      // No warn should have been called about multiple system_prompt_set events.
      const multiWarnCall = warnSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('system_prompt_set')
      );
      expect(multiWarnCall).toBeUndefined();
    });

    it('warns when two system_prompt_set events appear and still uses the last value', () => {
      writeEvents(tempDir, [
        {
          eventSeq: 1,
          type: 'system_prompt_set',
          data: { text: 'First prompt.' },
        },
        {
          eventSeq: 2,
          type: 'system_prompt_set',
          data: { text: 'Second (last) prompt.' },
        },
        {
          eventSeq: 3,
          type: 'prompt',
          data: { content: [{ type: 'text', text: 'hi' }] },
        },
      ]);

      const { systemPrompt } = buildProviderMessagesFromDurableEvents(tempDir);

      // Must use the last value defensively.
      expect(systemPrompt).toBe('Second (last) prompt.');

      // Must have warned exactly once with an appropriate message.
      const multiWarnCall = warnSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('system_prompt_set')
      );
      expect(multiWarnCall).toBeDefined();
    });
  });
});
