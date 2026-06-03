// ABOUTME: Example compaction strategy plugin — "tool-elision" strategy.
// ABOUTME: Preserves all user prompt and assistant message events, replacing each
// ABOUTME: tool_use event's (potentially massive) result with a compact stub entry.
// ABOUTME: Exercises the full CompactionStrategy contract and mergePreservedAdjacent.

import type { PluginApi, PluginModule } from '@lace/agent/plugins';
import type {
  CompactionStrategy,
  CompactionContext,
  CompactResult,
} from '@lace/agent/compaction/types';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import { mergePreservedAdjacent, type PreservedEntry } from '@lace/agent/compaction/toolkit';

export const meta = {
  name: 'tool-elision',
  namespace: 'tool-elision',
  version: '1.0.0',
};

/**
 * Converts a tool_use event's input record to a short human-readable summary,
 * capped at a fixed character limit so it is safe to embed in the preserved text.
 */
function summariseInput(input: Record<string, unknown>): string {
  try {
    const raw = JSON.stringify(input);
    const limit = 120;
    return raw.length <= limit ? raw : `${raw.slice(0, limit)}…`;
  } catch {
    return '(unserializable input)';
  }
}

/**
 * A compaction strategy that elides tool result payloads — the primary source of
 * context-window bloat in agentic workflows — while retaining the full
 * user↔assistant conversational narrative.
 *
 * Preserved:
 *   - Every `prompt` event → user-role entry (unchanged content).
 *   - Every `message` event → assistant-role entry (unchanged content).
 *   - Every `tool_use` event → two synthetic text entries:
 *       1. assistant-role: "Called tool <name>(<input summary>)"
 *       2. user-role:      "[tool result elided by compaction]"
 *
 * Dropped: turn_start, turn_end, context_compacted, job/permission events, etc.
 *
 * The strategy is deterministic and self-contained — no LLM or network calls.
 * It is most effective when the conversation contains many large tool outputs
 * (bash, read_file, web_search) that are no longer needed for future reasoning.
 */
const elideToolResultsStrategy: CompactionStrategy = {
  name: 'tool-elision/elide-tool-results',

  async compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactResult> {
    const rawPreserved: PreservedEntry[] = [];

    for (const e of events) {
      if (e.type === 'prompt') {
        const data = e.data as { type: 'prompt'; content: unknown };
        rawPreserved.push({
          role: 'user',
          content:
            typeof data.content === 'string'
              ? data.content
              : (data.content as Array<{ type: string; [k: string]: unknown }>),
        });
        continue;
      }

      if (e.type === 'message') {
        const data = e.data as { type: 'message'; content: unknown };
        rawPreserved.push({
          role: 'assistant',
          content:
            typeof data.content === 'string'
              ? data.content
              : (data.content as Array<{ type: string; [k: string]: unknown }>),
        });
        continue;
      }

      if (e.type === 'tool_use') {
        const data = e.data as {
          type: 'tool_use';
          name: string;
          input: Record<string, unknown>;
        };
        const callSummary = `Called tool ${data.name}(${summariseInput(data.input)})`;
        rawPreserved.push({ role: 'assistant', content: callSummary });
        rawPreserved.push({ role: 'user', content: '[tool result elided by compaction]' });
        continue;
      }

      // All other event types (turn_start, turn_end, context_compacted,
      // job_started, permission_requested, etc.) are intentionally dropped.
    }

    // Apply toolkit: drops empty entries, merges consecutive same-role entries,
    // ensures the preserved list starts with a user-role entry.
    const preserved = mergePreservedAdjacent(rawPreserved);

    if (preserved.length === 0) {
      return { noop: true };
    }

    const toolUseCount = events.filter((e) => e.type === 'tool_use').length;

    return {
      compactionEvent: {
        type: 'context_compacted',
        data: {
          type: 'context_compacted',
          strategy: 'tool-elision/elide-tool-results',
          preserved,
          summary:
            `Compacted ${events.length} events for thread ${ctx.threadId}; ` +
            `elided ${toolUseCount} tool result(s), kept ${preserved.length} entry(ies).`,
          messagesCompacted: events.length,
        },
      },
    };
  },
};

export function register(api: PluginApi): void {
  api.assertVersion(1);
  api.compaction.register('tool-elision/elide-tool-results', elideToolResultsStrategy);
}

export default { meta, register } satisfies PluginModule;
