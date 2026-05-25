// ABOUTME: Integration test running compact() against Ada's real session fixture
// ABOUTME: Fixture lives outside the lace repo at sen2/compaction/fixtures/ada-main/

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
  '../../../../../../../compaction/fixtures/ada-main/events.jsonl'
);

const fixtureAvailable = existsSync(FIXTURE_PATH);

describe('compact() against Ada fixture', () => {
  it.skipIf(!fixtureAvailable)(
    'compacts the 2,036-event session into a prefix < 30K tokens',
    async () => {
      const raw = readFileSync(FIXTURE_PATH, 'utf-8');
      const events: TypedDurableEvent[] = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as TypedDurableEvent);

      const result = await compact(events, { threadId: 'sess_ada_fixture' });

      expect(result.compactionEvent.data.strategy).toBe('track-based');
      expect(result.compactionEvent.data.preserved.length).toBeGreaterThan(0);

      const first = result.compactionEvent.data.preserved[0] as {
        role: string;
        content: string;
      };
      const prefix = first.content;
      expect(prefix).toContain('[Earlier conversation, compacted by track]');

      // Rough token check: prefix should be well under 30K tokens.
      const estPrefixTokens = Math.ceil(prefix.length / 4);
      expect(estPrefixTokens).toBeLessThan(30_000);

      // The Ada fixture predates track-stamping — all events land in 'untracked'
      // which renders under "## System events", not Slack/Jobs sections.
      // Asserting the section that is actually produced:
      expect(prefix).toContain('## System events');

      // Dump for manual inspection when env flag is set.
      if (process.env.LACE_DUMP_COMPACTION) {
        // eslint-disable-next-line no-console
        console.log('\n--- COMPACTION PREFIX ---\n' + prefix + '\n--- END ---\n');
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
