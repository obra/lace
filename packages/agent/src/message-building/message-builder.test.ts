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
    // Mimics the Ada-shape context_compacted event:
    // pure user messages first, then recent non-user events including tool_results
    // whose tool_uses live in the older (compacted-away) events.
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

describe('buildProviderMessagesFromDurableEvents — orphan tool_use recovery (PRI-1820)', () => {
  let tempDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-msg-builder-orphan-toolu-'));
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('drops an assistant tool_use whose id has no matching following user tool_result', () => {
    // Mirrors the Ada bricking case (PRI-1820): the matching tool_result was
    // compacted away, leaving an assistant message carrying an orphan tool_use
    // that Anthropic 400s on with "tool_use ids were found without tool_result
    // blocks immediately after".
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        preserved: [
          { role: 'user', content: 'recent user turn' },
          {
            role: 'assistant',
            content: 'thinking out loud',
            toolCalls: [
              { id: 'toolu_orphan', name: 'slack/send_message', arguments: { text: 'hi' } },
            ],
          },
          // The next user message has NO tool_result for toolu_orphan — the
          // matching tool_result was lost to compaction.
          { role: 'user', content: 'follow-up user turn' },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // No surviving assistant message should carry the orphan tool_use.
    for (const m of messages) {
      if (m.role === 'assistant' && Array.isArray(m.toolCalls)) {
        for (const c of m.toolCalls) {
          expect(c.id).not.toBe('toolu_orphan');
        }
      }
    }

    // The assistant message kept its text content (it's not empty), so the
    // message itself should survive — just stripped of its toolCalls.
    const survivingAssistant = messages.find(
      (m) => m.role === 'assistant' && m.content === 'thinking out loud'
    );
    expect(survivingAssistant).toBeDefined();
    expect(survivingAssistant!.toolCalls).toBeUndefined();

    // WARN was logged with the orphan's toolCallId.
    expect(warnSpy).toHaveBeenCalled();
    const warnedArgs = warnSpy.mock.calls.flat().map((a) => JSON.stringify(a));
    expect(warnedArgs.some((s) => s.includes('toolu_orphan'))).toBe(true);
    expect(warnedArgs.some((s) => s.includes('Dropping orphaned tool_use'))).toBe(true);
  });

  it('drops the whole assistant message when its only tool_use is orphaned and text is empty', () => {
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        preserved: [
          { role: 'user', content: 'turn 1' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'toolu_lonely', name: 'bash', arguments: { command: 'ls' } }],
          },
          // No following user tool_result — orphan.
          { role: 'user', content: 'turn 3' },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // The assistant message should be dropped entirely.
    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(0);

    // The two user messages should both survive.
    const userMsgContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userMsgContents).toEqual(['turn 1', 'turn 3']);
  });

  it('keeps only the paired tool_use entries when the assistant has a mix', () => {
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        preserved: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'paired', name: 'bash', arguments: { command: 'echo a' } },
              { id: 'orphan', name: 'bash', arguments: { command: 'echo b' } },
            ],
          },
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'paired', status: 'completed', content: [{ type: 'text', text: 'a' }] },
              // No result for 'orphan'.
            ],
          },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls!.map((c) => c.id)).toEqual(['paired']);

    expect(warnSpy).toHaveBeenCalled();
    const warnedArgs = warnSpy.mock.calls.flat().map((a) => JSON.stringify(a));
    expect(warnedArgs.some((s) => s.includes('orphan'))).toBe(true);
  });

  it('handles both-direction orphans in the same preserved list', () => {
    // Mix: an orphan user tool_result AND an orphan assistant tool_use in the
    // same conversation. Both directions must be cleaned.
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        preserved: [
          // Orphan user tool_result (existing pass A catches this).
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'user_orphan', status: 'completed', content: [{ type: 'text', text: 'x' }] },
            ],
          },
          { role: 'user', content: 'turn 2' },
          // Properly paired tool_use + tool_result.
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'paired', name: 'bash', arguments: {} }],
          },
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'paired', status: 'completed', content: [{ type: 'text', text: 'ok' }] },
            ],
          },
          // Orphan assistant tool_use (new pass B catches this).
          {
            role: 'assistant',
            content: 'note',
            toolCalls: [{ id: 'asst_orphan', name: 'bash', arguments: {} }],
          },
          { role: 'user', content: 'final turn' },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // The paired tool_use survives with its tool_result; both orphans are gone.
    const allToolCallIds = messages
      .filter((m) => m.role === 'assistant' && Array.isArray(m.toolCalls))
      .flatMap((m) => m.toolCalls!.map((c) => c.id));
    const allToolResultIds = messages
      .filter((m) => m.role === 'user' && Array.isArray(m.toolResults))
      .flatMap((m) => m.toolResults!.map((r) => r.id));

    expect(allToolCallIds).toEqual(['paired']);
    expect(allToolResultIds).toEqual(['paired']);

    // The Anthropic invariant must hold end-to-end: every assistant tool_use
    // is immediately followed by a user tool_result with the same id, and
    // every user tool_result has a matching prior assistant tool_use.
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
        const next = messages[i + 1];
        expect(next).toBeDefined();
        expect(next!.role).toBe('user');
        const resultIds = (next!.toolResults || []).map((r) => r.id);
        for (const c of m.toolCalls) {
          expect(resultIds).toContain(c.id);
        }
      }
      if (m.role === 'user' && Array.isArray(m.toolResults) && m.toolResults.length > 0) {
        const prev = messages[i - 1];
        expect(prev).toBeDefined();
        expect(prev!.role).toBe('assistant');
        const callIds = (prev!.toolCalls || []).map((c) => c.id);
        for (const r of m.toolResults) {
          expect(callIds).toContain(r.id);
        }
      }
    }
  });

  it('passes through happy-path matched pairs unchanged (no WARNs)', () => {
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        preserved: [
          { role: 'user', content: 'do a thing' },
          {
            role: 'assistant',
            content: 'on it',
            toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo hi' } }],
          },
          {
            role: 'user',
            content: '',
            toolResults: [
              { id: 'tc_1', status: 'completed', content: [{ type: 'text', text: 'hi' }] },
            ],
          },
          { role: 'assistant', content: 'done' },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages).toHaveLength(4);
    expect(messages[1]!.toolCalls).toHaveLength(1);
    expect(messages[2]!.toolResults).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reproduces the Ada bricking shape (toolu_01NK38wAMjBA3eJc76cCBfNj) and strips it', () => {
    // The exact toolu id from the Ada incident that drove 38/78 unmatched
    // turn_starts on 2026-05-24 (PRI-1820 / PRI-1818 #5). The orphan tool_use
    // survived into messages[1298] after compaction; here we model the shape
    // and assert the symmetric drop fires.
    const offendingId = 'toolu_01NK38wAMjBA3eJc76cCBfNj';
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        preserved: [
          { role: 'user', content: 'earlier turn' },
          {
            role: 'assistant',
            content: 'sending slack',
            toolCalls: [
              { id: offendingId, name: 'slack/send_message', arguments: { text: 'hello' } },
            ],
          },
          // The tool_result for offendingId is missing — compacted away.
          { role: 'user', content: 'next user turn' },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // After the symmetric strip, NO message in the rebuilt array should carry
    // the offending toolu id in toolCalls.
    const survivingIds = messages
      .filter((m) => m.role === 'assistant' && Array.isArray(m.toolCalls))
      .flatMap((m) => m.toolCalls!.map((c) => c.id));
    expect(survivingIds).not.toContain(offendingId);

    // The WARN names the offending id.
    const warnedArgs = warnSpy.mock.calls.flat().map((a) => JSON.stringify(a));
    expect(warnedArgs.some((s) => s.includes(offendingId))).toBe(true);
  });

  it('also drops user tool_results whose tool_use is missing in the prior assistant (inverse case)', () => {
    // The investigator noted a 1-of-39 inverse case from 2026-05-21 (PRI-1820
    // "out of scope" — but worth verifying that the existing user-side strip
    // covers it). The shape: a user message carrying a tool_result whose
    // tool_use_id has no matching tool_use in the immediately-prior assistant
    // message. The existing pass A should catch it; this test confirms.
    const event = {
      type: 'context_compacted',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        preserved: [
          {
            role: 'assistant',
            content: 'no calls here',
          },
          {
            role: 'user',
            content: '',
            toolResults: [
              {
                id: 'toolu_no_matching_use',
                status: 'completed',
                content: [{ type: 'text', text: 'orphan result' }],
              },
            ],
          },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // The orphan user toolResult must be gone (its user message dropped, since
    // it had no other content).
    const userToolResultIds = messages
      .filter((m) => m.role === 'user' && Array.isArray(m.toolResults))
      .flatMap((m) => m.toolResults!.map((r) => r.id));
    expect(userToolResultIds).not.toContain('toolu_no_matching_use');

    const warnedArgs = warnSpy.mock.calls.flat().map((a) => JSON.stringify(a));
    expect(warnedArgs.some((s) => s.includes('toolu_no_matching_use'))).toBe(true);
  });
});

describe('buildProviderMessagesFromDurableEvents — context_compacted preserved routing', () => {
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

  it('rebuilds messages solely from the preserved array (no data.summary injection)', () => {
    // The compaction strategy puts the summary as the first entry in preserved.
    // message-builder must NOT look at data.summary — doing so would produce a
    // duplicate if preserved[0] already contains the summary text.
    const summaryText = 'Previously: the user asked about foo and bar.';
    writeEvents(tempDir, [
      {
        type: 'context_compacted',
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        data: {
          // data.summary is intentionally absent — no writer produces this field.
          // Even if present it must be ignored; the summary lives in preserved[0].
          preserved: [
            { role: 'user', content: summaryText },
            { role: 'user', content: 'preserved turn' },
          ],
        },
      },
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // Both preserved entries are emitted; the summary appears exactly once.
    expect(messages).toHaveLength(2);
    const allText = messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    const occurrences = (
      allText.match(new RegExp(summaryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []
    ).length;
    expect(occurrences).toBe(1);
  });

  it('rebuilds only the preserved entries and ignores any stale data.summary field', () => {
    // Defensive: even if a legacy event carries data.summary, message-builder
    // must not inject it as a separate message. Only preserved entries are used.
    const summaryText = 'Legacy summary text.';
    writeEvents(tempDir, [
      {
        type: 'context_compacted',
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        data: {
          summary: summaryText, // legacy field — must be ignored
          preserved: [{ role: 'user', content: 'preserved turn' }],
        },
      },
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // Only the preserved entry is emitted; legacy data.summary is ignored.
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe('preserved turn');
    // The legacy summary text must NOT appear as an extra message.
    expect(messages.some((m) => m.content === summaryText)).toBe(false);
  });

  it('emits an empty messages array when preserved is empty', () => {
    writeEvents(tempDir, [
      {
        type: 'context_compacted',
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        data: {
          preserved: [],
        },
      },
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);
    expect(messages).toHaveLength(0);
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

  it('converts context_injected events to role:user content (not role:system)', () => {
    // When context_injected follows prompt, both are role:'user', so they are
    // merged into a single message to prevent consecutive same-role entries.
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
    // The two consecutive role:'user' entries are merged — the injected text
    // is appended to the prompt's content with a newline separator.
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[0]!.content).toBe('hi\nruntime nudge');
    // Assert no role:system in the messages array — context_injected is user-only.
    expect(result.messages.some((m) => m.role === 'system')).toBe(false);
  });

  it('context_injected after tool_use does NOT produce consecutive role:user messages', () => {
    // Sequence:
    //   system_prompt_set
    //   prompt (user 'hi')
    //   tool_use (assistant tool call + user toolResult)
    //   context_injected (runtime nudge)
    //   tool_use (assistant tool call + user toolResult)
    //
    // Without the merge, context_injected would be pushed as a separate role:user
    // immediately following the user[toolResults] from the first tool_use, producing
    // consecutive role:user messages on the wire.
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
        type: 'tool_use',
        data: {
          type: 'tool_use',
          toolCallId: 'tc_1',
          name: 'bash',
          input: { command: 'echo a' },
          result: {
            outcome: 'completed',
            content: [{ type: 'text', text: 'a' }],
          },
        },
      },
      {
        eventSeq: 4,
        type: 'context_injected',
        data: { type: 'context_injected', content: [{ type: 'text', text: 'runtime nudge' }] },
      },
      {
        eventSeq: 5,
        type: 'tool_use',
        data: {
          type: 'tool_use',
          toolCallId: 'tc_2',
          name: 'bash',
          input: { command: 'echo b' },
          result: {
            outcome: 'completed',
            content: [{ type: 'text', text: 'b' }],
          },
        },
      },
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // No two adjacent messages may both have role === 'user'
    for (let i = 1; i < messages.length; i++) {
      const bothUser = messages[i]!.role === 'user' && messages[i - 1]!.role === 'user';
      expect(bothUser).toBe(false);
    }

    // The runtime nudge must appear somewhere in the messages
    const allText = messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join(' ');
    expect(allText).toContain('runtime nudge');
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

describe('buildProviderMessagesFromDurableEvents — orphan tool_use (rebuilder tolerance)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-msg-builder-orphan-toolu-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Defensive rebuilder behavior. Today's runner ALWAYS synthesizes a
  // cancelled tool_result alongside any unexecuted tool_use (roborev job 803
  // Finding 1), so well-formed sessions never contain a `tool_use` durable
  // event without a `result` field. This test pins the rebuilder's behavior
  // when a malformed / legacy event slips through anyway: the assistant
  // tool_use is preserved without fabricating a user message after it. The
  // runner's contract (synthesize at write time) is what keeps the rebuilt
  // history valid for follow-up turns — covered separately by
  // runner.refusal.test.ts and runner.context-exceeded.test.ts.
  it('preserves an orphan assistant tool_use without inventing a user tool_result', () => {
    writeEvents(tempDir, [
      {
        eventSeq: 1,
        type: 'system_prompt_set',
        data: { text: 'You are a test assistant.' },
      },
      {
        eventSeq: 2,
        type: 'prompt',
        data: { content: [{ type: 'text', text: 'do the thing' }] },
      },
      {
        eventSeq: 3,
        type: 'message',
        data: { content: [{ type: 'text', text: 'partial answer' }] },
      },
      {
        eventSeq: 4,
        type: 'tool_use',
        data: {
          toolCallId: 'toolu_orphan',
          name: 'bash',
          kind: 'execute',
          input: { command: 'ls' },
          // No `result` field — represents a legacy / malformed event. Today's
          // runner always writes a synthetic cancelled result; this test pins
          // the rebuilder's defensive behavior if one shows up anyway.
        },
      },
    ]);

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    // Expected:
    //   user("do the thing")
    //   assistant("partial answer")
    //   assistant("", toolCalls=[toolu_orphan])
    //
    // Crucially: no user message after the orphan tool_use — the rebuilder
    // doesn't invent results it didn't see. Producing a valid provider
    // history for a follow-up turn is the runner's responsibility (which is
    // why it now writes a synthetic cancelled result; see Finding 1 fix).
    expect(messages.length).toBeGreaterThanOrEqual(2);

    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('assistant');
    expect(Array.isArray(last.toolCalls)).toBe(true);
    expect(last.toolCalls!.some((c) => c.id === 'toolu_orphan')).toBe(true);

    // No user message anywhere claims to have a toolResult matching the
    // orphan id.
    const orphanResults = messages.flatMap((m) =>
      m.role === 'user' && Array.isArray(m.toolResults)
        ? m.toolResults.filter((r) => r.id === 'toolu_orphan')
        : []
    );
    expect(orphanResults).toEqual([]);
  });
});
