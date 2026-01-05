// ABOUTME: Compaction strategy system for conversation compression
// ABOUTME: Enables conversation size reduction while preserving essential context

export { registerDefaultStrategies } from './registry';
export { TrimToolResultsStrategy } from './trim-tool-results-strategy';
export { SummarizeCompactionStrategy } from './summarize-strategy';
export { compactDroppedMessagesWithCore } from './compact-dropped-messages';

export type {
  CompactionStrategy,
  CompactionContext,
  CompactionData,
  CompactionResult,
  CompactionAgent,
} from './types';
