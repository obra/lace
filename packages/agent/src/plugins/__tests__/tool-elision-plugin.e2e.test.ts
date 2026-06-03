// ABOUTME: End-to-end test for the tool-elision-plugin example.
// ABOUTME: Loads through the real loader into real registries; asserts the strategy
// ABOUTME: resolves at the real consumption site and elides tool result payloads correctly.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import {
  registerBuiltinCompaction,
  resolveCompactionStrategy,
} from '@lace/agent/compaction/strategy';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import type { CompactionContext } from '@lace/agent/compaction/types';

// Resolves relative to loader.ts (src/plugins/loader.ts) — same pattern as the
// whole-system integration test and other e2e plugin tests.
const PLUGIN_SPEC = './__examples__/tool-elision-plugin';

/** Minimal CompactionContext for tests (provider/agent/modelId all optional). */
const TEST_CTX: CompactionContext = {
  threadId: 'thread-tool-elision-test',
  sessionDir: '/tmp/test-session-tool-elision',
};

/** Build a minimal TypedDurableEvent for a given type and data payload. */
function makeEvent(
  seq: number,
  type: TypedDurableEvent['type'],
  data: Record<string, unknown>
): TypedDurableEvent {
  return {
    eventSeq: seq,
    timestamp: new Date(0).toISOString(),
    type,
    data: { type, ...data } as TypedDurableEvent['data'],
  };
}

describe('tool-elision-plugin — end-to-end', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    // Built-in compaction must register before plugins (dup→fatal).
    registerBuiltinCompaction();
    await loadPlugins(PLUGIN_SPEC);
  });

  // ── Registry / loader surface ─────────────────────────────────────────────

  it('strategy is recorded in the compaction registry with correct owner', () => {
    expect(registries.compaction.has('tool-elision/elide-tool-results')).toBe(true);
    expect(registries.compaction.owner('tool-elision/elide-tool-results')).toBe('tool-elision');
  });

  it('strategy resolves by name at the real consumption site', () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    expect(strategy.name).toBe('tool-elision/elide-tool-results');
  });

  it('built-in track-based strategy still resolves after plugin load', () => {
    const builtin = resolveCompactionStrategy('track-based');
    expect(builtin.name).toBe('track-based');
  });

  // ── Strategy behaviour: noop paths ───────────────────────────────────────

  it('returns noop when event list is empty', async () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    const result = await strategy.compact([], TEST_CTX);
    expect(result).toEqual({ noop: true });
  });

  it('returns noop when only non-conversation events are present', async () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'turn_start', {}),
      makeEvent(2, 'turn_end', { stopReason: 'end_turn', usage: { costUsd: 0 } }),
      makeEvent(3, 'job_started', { jobId: 'j1', jobType: 'shell' }),
      makeEvent(4, 'job_finished', { jobId: 'j1', outcome: 'completed' }),
    ];
    const result = await strategy.compact(events, TEST_CTX);
    expect(result).toEqual({ noop: true });
  });

  // ── Strategy behaviour: real compact() calls ──────────────────────────────

  it('preserves user prompt and assistant message, dropping system events', async () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'turn_start', {}),
      makeEvent(2, 'prompt', { content: [{ type: 'text', text: 'Hello, lace!' }] }),
      makeEvent(3, 'message', { content: 'Hi there, how can I help?' }),
      makeEvent(4, 'turn_end', { stopReason: 'end_turn', usage: { costUsd: 0 } }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) throw new Error('expected compactionEvent');

    const { compactionEvent } = result;
    expect(compactionEvent.type).toBe('context_compacted');
    expect(compactionEvent.data.strategy).toBe('tool-elision/elide-tool-results');
    expect(compactionEvent.data.messagesCompacted).toBe(events.length);

    const { preserved } = compactionEvent.data;
    expect(Array.isArray(preserved)).toBe(true);

    // prompt → user, message → assistant; different roles so not merged
    expect(preserved).toHaveLength(2);
    const [userEntry, assistantEntry] = preserved as Array<{
      role: string;
      content: unknown;
    }>;
    expect(userEntry.role).toBe('user');
    expect(assistantEntry.role).toBe('assistant');
    expect(assistantEntry.content).toBe('Hi there, how can I help?');
  });

  it('elides tool result payload and replaces with stub text', async () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'prompt', { content: [{ type: 'text', text: 'Run ls please' }] }),
      makeEvent(2, 'turn_start', {}),
      makeEvent(3, 'message', { content: 'I will list the directory.' }),
      makeEvent(4, 'tool_use', {
        toolCallId: 'tc-001',
        name: 'bash',
        input: { command: 'ls -la /home' },
        result: {
          status: 'completed',
          content: [
            {
              type: 'text',
              // Simulates a massive tool output that compaction should elide
              text: 'total 9999\n' + '-rw-r--r-- user user file1\n'.repeat(500),
            },
          ],
        },
      }),
      makeEvent(5, 'turn_end', { stopReason: 'end_turn', usage: { costUsd: 0.01 } }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) throw new Error('expected compactionEvent');

    const { preserved } = result.compactionEvent.data;
    expect(Array.isArray(preserved)).toBe(true);

    // Expected: user(prompt) | assistant(message) | assistant(tool call summary) | user(elided stub)
    // But mergePreservedAdjacent merges adjacent same-role:
    //   assistant(message) + assistant(tool call) → merged assistant
    //   user(elided stub) stays separate
    // So: user(prompt) | assistant(merged) | user(stub)
    expect(preserved).toHaveLength(3);

    const entries = preserved as Array<{ role: string; content: unknown }>;
    expect(entries[0].role).toBe('user');
    expect(entries[1].role).toBe('assistant');
    expect(entries[2].role).toBe('user');

    // The elided stub must appear — the massive original output must NOT appear
    const stubEntry = entries[2];
    expect(typeof stubEntry.content).toBe('string');
    expect(stubEntry.content).toBe('[tool result elided by compaction]');
  });

  it('includes the tool name in the assistant call summary entry', async () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'prompt', { content: [{ type: 'text', text: 'Read the config file' }] }),
      makeEvent(2, 'tool_use', {
        toolCallId: 'tc-002',
        name: 'read_file',
        input: { path: '/etc/config.yaml' },
        result: {
          status: 'completed',
          content: [{ type: 'text', text: 'key: value\n'.repeat(1000) }],
        },
      }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) throw new Error('expected compactionEvent');

    const { preserved } = result.compactionEvent.data;
    const entries = preserved as Array<{ role: string; content: unknown }>;

    // user(prompt) | assistant(call summary) | user(elided stub)
    // The prompt is user, tool call is assistant(call) then user(result)
    // Since user and assistant alternate, no merging. user+assistant+user = 3 entries.
    expect(entries).toHaveLength(3);

    const assistantEntry = entries[1];
    expect(assistantEntry.role).toBe('assistant');
    expect(typeof assistantEntry.content).toBe('string');
    expect(assistantEntry.content as string).toContain('read_file');
    expect(assistantEntry.content as string).toContain('/etc/config.yaml');
  });

  it('handles multiple tool calls in sequence, merging adjacent same-role entries', async () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'prompt', { content: [{ type: 'text', text: 'Do some work' }] }),
      makeEvent(2, 'tool_use', {
        toolCallId: 'tc-003',
        name: 'bash',
        input: { command: 'pwd' },
        result: { status: 'completed', content: [{ type: 'text', text: '/home/user' }] },
      }),
      makeEvent(3, 'tool_use', {
        toolCallId: 'tc-004',
        name: 'bash',
        input: { command: 'whoami' },
        result: { status: 'completed', content: [{ type: 'text', text: 'root' }] },
      }),
      makeEvent(4, 'message', { content: 'All done!' }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) throw new Error('expected compactionEvent');

    const { preserved } = result.compactionEvent.data;
    const entries = preserved as Array<{ role: string; content: unknown }>;

    // Raw sequence before merging:
    //   user(prompt) | assistant(tc-003 call) | user(tc-003 elided) | assistant(tc-004 call) | user(tc-004 elided) | assistant(message)
    // After mergePreservedAdjacent:
    //   user(prompt) | assistant(tc-003 call) | user(tc-003 elided) | assistant(tc-004 call merged with message) | user(tc-004 elided)
    // Wait — the assistant(message) comes AFTER user(tc-004 elided), not before.
    // Actually the last entry is assistant(message), which is the SAME role as the preceding
    // assistant(tc-004 call). But they are separated by user(tc-004 elided).
    // So the sequence is: user | assistant | user | assistant | user | assistant
    // After merging (no adjacent same-role except...):
    //   - user(prompt) alone
    //   - assistant(tc-003) alone (prev is user)
    //   - user(tc-003 elided) alone (prev is assistant)
    //   - assistant(tc-004) alone (prev is user)
    //   - user(tc-004 elided) alone (prev is assistant)
    //   - assistant(message) alone (prev is user)
    // = 6 entries, all alternating.
    expect(entries).toHaveLength(6);

    // Verify role alternation
    for (let i = 0; i < entries.length; i++) {
      const expectedRole = i % 2 === 0 ? 'user' : 'assistant';
      expect(entries[i].role).toBe(expectedRole);
    }

    // First entry is the user prompt
    expect(entries[0].content).toContainEqual({ type: 'text', text: 'Do some work' });

    // Last entry is the assistant message
    expect(entries[5].content).toBe('All done!');
  });

  it('merges adjacent same-role entries: two consecutive prompts become one user entry', async () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'prompt', { content: [{ type: 'text', text: 'First question' }] }),
      makeEvent(2, 'prompt', { content: [{ type: 'text', text: 'Second question' }] }),
      makeEvent(3, 'message', { content: 'I will answer both.' }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) throw new Error('expected compactionEvent');

    const { preserved } = result.compactionEvent.data;
    // Two adjacent user entries → merged into one; then one assistant entry
    expect(preserved).toHaveLength(2);

    const [userEntry, assistantEntry] = preserved as Array<{
      role: string;
      content: unknown[];
    }>;
    expect(userEntry.role).toBe('user');
    expect(userEntry.content).toContainEqual({ type: 'text', text: 'First question' });
    expect(userEntry.content).toContainEqual({ type: 'text', text: 'Second question' });
    expect(assistantEntry.role).toBe('assistant');
  });

  it('includes summary string with correct elision count', async () => {
    const strategy = resolveCompactionStrategy('tool-elision/elide-tool-results');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'prompt', { content: [{ type: 'text', text: 'Go!' }] }),
      makeEvent(2, 'tool_use', {
        toolCallId: 'tc-005',
        name: 'bash',
        input: { command: 'echo hi' },
        result: { status: 'completed', content: [{ type: 'text', text: 'hi' }] },
      }),
      makeEvent(3, 'tool_use', {
        toolCallId: 'tc-006',
        name: 'bash',
        input: { command: 'echo bye' },
        result: { status: 'completed', content: [{ type: 'text', text: 'bye' }] },
      }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) throw new Error('expected compactionEvent');

    const { data } = result.compactionEvent;
    expect(data.summary).toContain('elided 2 tool result(s)');
    expect(data.summary).toContain('thread-tool-elision-test');
  });
});
