// ABOUTME: Integration test running compact() against Ada's retagged fixture
// ABOUTME: Same source events as track-compaction.integration.test, but with
// ABOUTME: data.track populated to simulate post-producer-track-stamping world.
// ABOUTME: The kernel default (track-based) is domain-neutral — generic rendering
// ABOUTME: for all tracks.

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
    'compacts with track-stamped producers into a prefix — generic rendering',
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

      // The kernel default is domain-neutral: no domain-specific XML wrapper tags.
      // All plugin-tracked events render generically as prose.
      expect(prefix).not.toContain('<domain-thread');
      expect(prefix).not.toContain('<plugin-thread');

      // Old markdown format must still be absent.
      expect(prefix).not.toContain('#### [Jesse Vincent/U0A2GP26U94]');
      expect(prefix).not.toContain('#### You');

      // Subagent jobs section should still be populated (kernel-generic concept).
      expect(prefix).toContain('## Subagent jobs');

      // Token budget: generic rendering may include more content than a specialized
      // renderer. Cap at 300K to guard against runaway loops.
      const estPrefixTokens = Math.ceil(prefix.length / 4);
      expect(estPrefixTokens).toBeGreaterThan(2_000);
      expect(estPrefixTokens).toBeLessThan(300_000);

      // There should be a meaningful number of events compacted.
      expect(result.compactionEvent.data.messagesCompacted).toBeGreaterThan(0);

      if (process.env.LACE_DUMP_COMPACTION) {
        console.log(
          '\n--- COMPACTION PREFIX (TRACKED, GENERIC) ---\n' + prefix + '\n--- END ---\n'
        );
        console.log(`prefix length: ${prefix.length} chars, ~${estPrefixTokens} tokens`);
        console.log(`messagesCompacted: ${result.compactionEvent.data.messagesCompacted}`);
        console.log(`preserved tail entries: ${result.compactionEvent.data.preserved.length - 1}`);
      }
    },
    30_000
  );
});
