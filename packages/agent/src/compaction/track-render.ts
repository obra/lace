// ABOUTME: Markdown renderer for compacted track blocks
// ABOUTME: Pure function; receives TrackBlock[] and scheduler roll-up, returns string

import type { TrackBlock } from './track-compaction';

export type SchedulerRollup = {
  alarmsPending: number;
  remindersPending: number;
};

export type RenderInput = {
  blocks: TrackBlock[];
  scheduler: SchedulerRollup;
};

const HEADER = '[Earlier conversation, compacted by track]';

export function renderCompactionPrefix(input: RenderInput): string {
  const slackBlocks = input.blocks.filter((b) => b.trackId.startsWith('slack:'));
  const jobBlocks = input.blocks.filter((b) => b.trackId.startsWith('job:'));
  const systemBlocks = input.blocks.filter(
    (b) => b.trackId.startsWith('system:') || b.trackId === 'untracked'
  );
  const otherBlocks = input.blocks.filter(
    (b) =>
      !b.trackId.startsWith('slack:') &&
      !b.trackId.startsWith('job:') &&
      !b.trackId.startsWith('system:') &&
      b.trackId !== 'untracked'
  );

  const parts: string[] = [HEADER];

  if (slackBlocks.length > 0) {
    parts.push('\n## Slack threads\n');
    parts.push(slackBlocks.map((b) => b.body).join('\n\n'));
  }

  if (jobBlocks.length > 0) {
    parts.push('\n## Subagent jobs\n');
    parts.push(jobBlocks.map((b) => b.body).join('\n\n'));
  }

  const { alarmsPending, remindersPending } = input.scheduler;
  if (alarmsPending > 0 || remindersPending > 0) {
    parts.push('\n## Scheduler\n');
    parts.push(
      `${alarmsPending} alarm${alarmsPending === 1 ? '' : 's'} pending, ${remindersPending} reminder${remindersPending === 1 ? '' : 's'} pending. Use \`list_alarms\` / \`list_reminders\` for details.`
    );
  }

  if (systemBlocks.length > 0) {
    parts.push('\n## System events\n');
    parts.push(systemBlocks.map((b) => b.body).join('\n\n'));
  }

  if (otherBlocks.length > 0) {
    parts.push('\n## Other\n');
    parts.push(otherBlocks.map((b) => b.body).join('\n\n'));
  }

  return parts.join('\n');
}
