// ABOUTME: Example compaction strategy plugin — "user-turns-only" strategy.
// ABOUTME: Preserves only user prompt events, runs them through mergePreservedAdjacent,
// ABOUTME: and returns a context_compacted event. Exercises the CompactionStrategy contract
// ABOUTME: and the mergePreservedAdjacent toolkit helper.

import type { PluginApi, PluginModule } from '@lace/agent/plugins';
import type {
  CompactionStrategy,
  CompactionContext,
  CompactResult,
} from '@lace/agent/compaction/types';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import { mergePreservedAdjacent, type PreservedEntry } from '@lace/agent/compaction/toolkit';

export const meta = {
  name: 'compaction-example',
  namespace: 'compaction-example',
  version: '1.0.0',
};

/**
 * A compaction strategy that keeps only the user's prompt events.
 * All assistant messages, tool calls, and system events are discarded.
 * Adjacent user entries are merged into one by mergePreservedAdjacent so
 * the preserved list is replay-legal.
 *
 * Useful as a minimal context-shedding strategy: the assistant sees only
 * what the user has said, with no model output history.
 */
const userTurnsOnlyStrategy: CompactionStrategy = {
  name: 'compaction-example/user-turns-only',

  async compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactResult> {
    // Collect raw preserved entries from prompt-type events (user turns).
    const rawPreserved: PreservedEntry[] = events
      .filter((e) => e.type === 'prompt')
      .map((e) => {
        const data = e.data as { type: 'prompt'; content: unknown[] };
        return {
          role: 'user',
          content:
            typeof data.content === 'string'
              ? data.content
              : (data.content as Array<{ type: string; [k: string]: unknown }>),
        };
      });

    // Apply toolkit: drops empty entries, merges consecutive same-role entries,
    // ensures the preserved list starts with a user-role entry.
    const preserved = mergePreservedAdjacent(rawPreserved);

    // If nothing remains after merging, signal no-op so the caller skips
    // writing a compaction event.
    if (preserved.length === 0) {
      return { noop: true };
    }

    return {
      compactionEvent: {
        type: 'context_compacted',
        data: {
          type: 'context_compacted',
          strategy: 'compaction-example/user-turns-only',
          preserved,
          summary: `Compacted ${events.length} events for thread ${ctx.threadId}; kept ${preserved.length} user turn(s).`,
          messagesCompacted: events.length,
        },
      },
    };
  },
};

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.compaction.register('compaction-example/user-turns-only', userTurnsOnlyStrategy);
}

export default { meta, register } satisfies PluginModule;
