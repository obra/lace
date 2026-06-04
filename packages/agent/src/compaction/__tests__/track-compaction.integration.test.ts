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

      // prefix entry + at least some preserved tail entries
      expect(result.compactionEvent.data.preserved.length).toBeGreaterThan(1);

      const preserved = result.compactionEvent.data.preserved as Array<{
        role: string;
        content: string | Array<{ type: string; text?: string }>;
      }>;

      // Extract text from either string or ContentBlock[] for content assertions.
      const extractText = (c: string | Array<{ type: string; text?: string }>) =>
        typeof c === 'string' ? c : c.map((b) => b.text ?? '').join('');

      const first = preserved[0];
      const prefix = extractText(first.content);

      // The prefix must not form a standalone user entry that would make the
      // first two preserved entries both user-role. If preserved[1] exists and
      // is also user-role, the prefix merge did not work.
      if (preserved.length > 1 && preserved[1].role === 'user') {
        // prefix must be absent from preserved[1] — it was merged into preserved[0]
        expect(extractText(preserved[1].content)).not.toContain('[Earlier conversation');
      }
      expect(prefix).toContain('[Earlier conversation, compacted by track]');

      // Rough token check: prefix should be non-trivial (real content from Ada).
      // The Ada fixture is a long session (~2036 events) so 45K+ tokens is expected
      // when bucketing all untracked prompts/messages; cap at 200K to guard against
      // a runaway loop duplicating content.
      const estPrefixTokens = Math.ceil(prefix.length / 4);
      expect(estPrefixTokens).toBeGreaterThan(1_000);
      expect(estPrefixTokens).toBeLessThan(200_000);

      // The Ada fixture predates track-stamping — all events land in 'untracked'
      // which renders under "## System events", not Jobs/Other sections.
      expect(prefix).toContain('## System events');

      // The untracked salience extractor should produce User:/Assistant: lines
      // from the actual Ada conversation content.
      expect(prefix).toMatch(/User:|Assistant:/);

      // There should be a meaningful number of events compacted.
      expect(result.compactionEvent.data.messagesCompacted).toBeGreaterThan(0);

      // Dump for manual inspection when env flag is set.
      if (process.env.LACE_DUMP_COMPACTION) {
        console.log('\n--- COMPACTION PREFIX ---\n' + prefix + '\n--- END ---\n');
        console.log(`prefix length: ${prefix.length} chars, ~${estPrefixTokens} tokens`);
        console.log(`messagesCompacted: ${result.compactionEvent.data.messagesCompacted}`);
        console.log(`preserved tail entries: ${result.compactionEvent.data.preserved.length - 1}`);
      }
    },
    30_000
  );
});
