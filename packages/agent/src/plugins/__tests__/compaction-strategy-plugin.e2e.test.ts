// ABOUTME: End-to-end test for the compaction-strategy-plugin example.
// ABOUTME: Loads through the real loader into real registries; asserts the strategy
// ABOUTME: resolves at the real consumption site and produces a valid CompactResult.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins, registries, resetRegistriesForTest } from '@lace/agent/plugins';
import {
  registerBuiltinCompaction,
  resolveCompactionStrategy,
} from '@lace/agent/compaction/strategy';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import type { CompactionContext } from '@lace/agent/compaction/types';

// Resolves relative to loader.ts (src/plugins/loader.ts) — same pattern as the
// whole-system integration test and persona-aware-tool-plugin e2e test.
const PLUGIN_SPEC = './__examples__/compaction-strategy-plugin';

/** Minimal CompactionContext for tests (provider/agent/modelId all optional). */
const TEST_CTX: CompactionContext = {
  threadId: 'thread-test-1',
  sessionDir: '/tmp/test-session',
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

describe('compaction-strategy-plugin — end-to-end', () => {
  beforeEach(async () => {
    resetRegistriesForTest();
    // Built-in compaction must register before plugins (dup→fatal).
    registerBuiltinCompaction();
    await loadPlugins(PLUGIN_SPEC);
  });

  // ── Registry / loader surface ─────────────────────────────────────────────

  it('strategy is recorded in the compaction registry with correct owner', () => {
    expect(registries.compaction.has('compaction-example/user-turns-only')).toBe(true);
    expect(registries.compaction.owner('compaction-example/user-turns-only')).toBe(
      'compaction-example'
    );
  });

  it('strategy resolves by name at the real consumption site', () => {
    const strategy = resolveCompactionStrategy('compaction-example/user-turns-only');
    expect(strategy.name).toBe('compaction-example/user-turns-only');
  });

  it('built-in track-based strategy still resolves after plugin load', () => {
    const builtin = resolveCompactionStrategy('track-based');
    expect(builtin.name).toBe('track-based');
  });

  // ── Strategy behaviour: real compact() calls ──────────────────────────────

  it('returns noop when no prompt events are present', async () => {
    const strategy = resolveCompactionStrategy('compaction-example/user-turns-only');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'turn_start', {}),
      makeEvent(2, 'message', { content: 'Hello from assistant' }),
      makeEvent(3, 'turn_end', { stopReason: 'end_turn', usage: { costUsd: 0 } }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    expect(result).toEqual({ noop: true });
  });

  it('returns a context_compacted event containing the preserved user turns', async () => {
    const strategy = resolveCompactionStrategy('compaction-example/user-turns-only');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'prompt', { content: [{ type: 'text', text: 'Hello, lace!' }] }),
      makeEvent(2, 'turn_start', {}),
      makeEvent(3, 'message', { content: 'Hi there!' }),
      makeEvent(4, 'turn_end', { stopReason: 'end_turn', usage: { costUsd: 0 } }),
      makeEvent(5, 'prompt', { content: [{ type: 'text', text: 'What can you do?' }] }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    // Must be a compactionEvent, not noop
    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) throw new Error('expected compactionEvent');

    const { compactionEvent } = result;
    expect(compactionEvent.type).toBe('context_compacted');
    expect(compactionEvent.data.type).toBe('context_compacted');
    expect(compactionEvent.data.strategy).toBe('compaction-example/user-turns-only');
    expect(compactionEvent.data.messagesCompacted).toBe(events.length);

    // mergePreservedAdjacent merges adjacent same-role (user) entries into one
    const { preserved } = compactionEvent.data;
    expect(Array.isArray(preserved)).toBe(true);
    // Two prompt events → two user entries → merged into one by mergePreservedAdjacent
    expect(preserved).toHaveLength(1);

    const first = preserved[0] as { role: string; content: unknown[] };
    expect(first.role).toBe('user');
    // Both content blocks should appear in the merged entry
    expect(first.content).toContainEqual({ type: 'text', text: 'Hello, lace!' });
    expect(first.content).toContainEqual({ type: 'text', text: 'What can you do?' });
  });

  it('drops empty prompt events and still produces valid output', async () => {
    const strategy = resolveCompactionStrategy('compaction-example/user-turns-only');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'prompt', { content: [] }), // empty — will be dropped by toolkit
      makeEvent(2, 'prompt', { content: [{ type: 'text', text: 'Keep me' }] }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    expect('compactionEvent' in result).toBe(true);
    if (!('compactionEvent' in result)) throw new Error('expected compactionEvent');

    const { preserved } = result.compactionEvent.data;
    expect(Array.isArray(preserved)).toBe(true);
    expect(preserved).toHaveLength(1);
    const entry = preserved[0] as { role: string; content: unknown[] };
    expect(entry.role).toBe('user');
    expect(entry.content).toContainEqual({ type: 'text', text: 'Keep me' });
  });

  it('returns noop when all prompt events are empty', async () => {
    const strategy = resolveCompactionStrategy('compaction-example/user-turns-only');
    const events: TypedDurableEvent[] = [
      makeEvent(1, 'prompt', { content: [] }),
      makeEvent(2, 'prompt', { content: [] }),
    ];

    const result = await strategy.compact(events, TEST_CTX);

    // All empty → mergePreservedAdjacent returns [] → strategy returns noop
    expect(result).toEqual({ noop: true });
  });
});
