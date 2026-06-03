// ABOUTME: Compaction registry seam — register built-ins, resolve by name, enforce replay-legality
import { registries } from '@lace/agent/plugins';
import type { CompactionStrategy, CompactResult } from './types';
import { trackBasedStrategy } from './track-strategy';
import { mergePreservedAdjacent, type PreservedEntry } from './toolkit';

/** Register the built-in compaction strategies.
 *  Robust to resetRegistriesForTest(): re-registers if the registry was cleared. */
export function registerBuiltinCompaction(): void {
  if (!registries.compaction.has('track-based')) {
    registries.compaction.register('track-based', trackBasedStrategy, 'builtin');
  }
}

export function resolveCompactionStrategy(name: string): CompactionStrategy {
  return registries.compaction.resolve(name);
}

export function validatePreserved(result: CompactResult): CompactResult {
  if ('noop' in result) return result;
  const repaired = mergePreservedAdjacent(
    result.compactionEvent.data.preserved as PreservedEntry[]
  );
  if (repaired.length === 0) return { noop: true };
  return {
    compactionEvent: {
      type: 'context_compacted',
      data: { ...result.compactionEvent.data, preserved: repaired },
    },
  };
}
