// ABOUTME: Integration test running compact() against Ada's retagged fixture
// ABOUTME: Same source events as track-compaction.integration.test, but with
// ABOUTME: data.track populated to simulate post-producer-track-stamping world.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compact } from '../track-compaction';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// From packages/agent/src/compaction/__tests__/ up to the worktree root (7 levels),
// then out to sen2/compaction/fixtures/ada-main/:
//   __tests__/ → compaction/ (1)
//   → src/ (2)
//   → agent/ (3)
//   → packages/ (4)
//   → track-based-compaction/ (5)
//   → lace-worktrees/ (6)
//   → sen2/ (7)
const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../../../../compaction/fixtures/ada-main/events-tracked.jsonl'
);

const fixtureAvailable = existsSync(FIXTURE_PATH);

describe('compact() against Ada retagged fixture', () => {
  it.skipIf(!fixtureAvailable)(
    'compacts with track-stamped producers into a much smaller prefix',
    async () => {
      const raw = readFileSync(FIXTURE_PATH, 'utf-8');
      const events: TypedDurableEvent[] = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as TypedDurableEvent);

      const result = await compact(events, { threadId: 'sess_ada_tracked' });

      if ('noop' in result && result.noop) {
        throw new Error('expected compact() to produce a compaction event, got noop');
      }

      expect(result.compactionEvent.data.strategy).toBe('track-based');

      const preserved = result.compactionEvent.data.preserved as Array<{
        role: string;
        content: string | Array<{ type: string; text?: string }>;
      }>;

      const extractText = (c: string | Array<{ type: string; text?: string }>) =>
        typeof c === 'string' ? c : c.map((b) => b.text ?? '').join('');

      const first = preserved[0];
      const prefix = extractText(first.content);
      expect(prefix).toContain('[Earlier conversation, compacted by track]');

      // With producer-side track-stamping, expect:
      // - Slack threads section populated (was empty before)
      // - Subagent jobs section populated (already worked via lifecycle routing)
      // - Alarms / reminders / bootstrap DROPPED (return null from salience)
      // - System events should be much smaller (most events now have a track)
      expect(prefix).toContain('## Slack threads');
      expect(prefix).toContain('## Subagent jobs');

      // Token budget: with track-stamping, most events are now routed to specific
      // tracks. Slack messages are truncated to 240 chars, alarms/bootstrap/reminders
      // are dropped. Expect a dramatic shrink vs the 52K+ untracked baseline.
      const estPrefixTokens = Math.ceil(prefix.length / 4);
      expect(estPrefixTokens).toBeLessThan(20_000);
      expect(estPrefixTokens).toBeGreaterThan(2_000);

      // There should be a meaningful number of events compacted.
      expect(result.compactionEvent.data.messagesCompacted).toBeGreaterThan(0);

      if (process.env.LACE_DUMP_COMPACTION) {
        // eslint-disable-next-line no-console
        console.log('\n--- COMPACTION PREFIX (TRACKED) ---\n' + prefix + '\n--- END ---\n');
        // eslint-disable-next-line no-console
        console.log(`prefix length: ${prefix.length} chars, ~${estPrefixTokens} tokens`);
        // eslint-disable-next-line no-console
        console.log(`messagesCompacted: ${result.compactionEvent.data.messagesCompacted}`);
        // eslint-disable-next-line no-console
        console.log(`preserved tail entries: ${result.compactionEvent.data.preserved.length - 1}`);
      }
    },
    30_000
  );
});
