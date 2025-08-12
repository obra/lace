// ABOUTME: Central registry for compaction strategies
// ABOUTME: Handles strategy registration and initialization

import { TrimToolResultsStrategy } from '~/threads/compaction/trim-tool-results-strategy';
import { SummarizeCompactionStrategy } from '~/threads/compaction/summarize-strategy';
import type { CompactionStrategy } from '~/threads/compaction/types';

function createDefaultStrategies(): CompactionStrategy[] {
  return [new TrimToolResultsStrategy(), new SummarizeCompactionStrategy()];
}

export function registerDefaultStrategies(
  registerFn: (strategy: CompactionStrategy) => void
): void {
  const strategies = createDefaultStrategies();
  for (const strategy of strategies) {
    registerFn(strategy);
  }
}
