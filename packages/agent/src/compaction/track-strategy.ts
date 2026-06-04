// ABOUTME: The built-in 'track-based' compaction strategy
// ABOUTME: Wraps the existing compact() function unchanged — no behavior change.
import type { CompactionStrategy } from './types';
import { compact } from './track-compaction';

export const trackBasedStrategy: CompactionStrategy = {
  name: 'track-based',
  compact: (e, c) => compact(e, c),
};
