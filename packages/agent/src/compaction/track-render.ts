// ABOUTME: Markdown renderer for compacted track blocks
// ABOUTME: Pure function; receives TrackBlock[] and scheduler roll-up, returns string
// ABOUTME: Domain-neutral — delegates entirely to renderGenericSections from toolkit.

import { renderGenericSections, type SchedulerRollup } from './toolkit';
import type { TrackBlock } from './toolkit';

export type { SchedulerRollup };

export type RenderInput = {
  blocks: TrackBlock[];
  scheduler: SchedulerRollup;
};

/**
 * Render the compaction prefix from track blocks and scheduler state.
 * Domain-neutral: delegates to renderGenericSections. Plugin strategies
 * that need domain-specific sections call renderGenericSections directly
 * with an extraSections argument.
 */
export function renderCompactionPrefix(input: RenderInput): string {
  return renderGenericSections(input);
}
