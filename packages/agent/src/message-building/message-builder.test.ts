// ABOUTME: Tests for buildProviderMessagesFromDurableEvents — read-time recovery
// ABOUTME: Validates that orphaned tool_result blocks in context_compacted preserved arrays are dropped

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProviderMessagesFromDurableEvents } from './message-builder';
import { logger } from '@lace/agent/utils/logger';

function writeEvents(dir: string, events: unknown[]): void {
  writeFileSync(
    join(dir, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
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
            toolResults: [{ id: 'orphan-1', status: 'completed', content: [{ type: 'text', text: 'orphan' }] }],
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
            toolResults: [{ id: 'paired-1', status: 'completed', content: [{ type: 'text', text: 'hi' }] }],
          },
        ],
      },
    };

    writeEvents(tempDir, [event]);

    const messages = buildProviderMessagesFromDurableEvents(tempDir);

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

    const messages = buildProviderMessagesFromDurableEvents(tempDir);

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

    const messages = buildProviderMessagesFromDurableEvents(tempDir);

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

    const messages = buildProviderMessagesFromDurableEvents(tempDir);

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
