// ABOUTME: Markdown renderer for compacted track blocks
// ABOUTME: Pure function; receives TrackBlock[] and scheduler roll-up, returns string
// ABOUTME: Composes renderGenericSections from toolkit and adds the Slack section.

import type { TrackBlock } from './toolkit';
import { renderGenericSections } from './toolkit';

export type SchedulerRollup = {
  alarmsPending: number;
  remindersPending: number;
};

export type RenderInput = {
  blocks: TrackBlock[];
  scheduler: SchedulerRollup;
};

export function renderCompactionPrefix(input: RenderInput): string {
  const slackBlocks = input.blocks.filter((b) => b.trackId.startsWith('slack:'));

  // Build the slack section string (if any) to inject into the generic renderer.
  let slackParts: string | undefined;
  if (slackBlocks.length > 0) {
    slackParts = '\n## Slack threads\n\n' + slackBlocks.map((b) => b.body).join('\n\n');
  }

  return renderGenericSections(input, slackParts);
}
