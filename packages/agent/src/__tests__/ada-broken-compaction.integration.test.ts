// ABOUTME: Integration regression test for Ada's bricked session (PRI-1712)
// ABOUTME: Loads Ada's actual events.jsonl rescued from prod and asserts the rebuilt
// ABOUTME: provider message array has no orphaned tool_result blocks — the exact
// ABOUTME: failure shape that produced Anthropic 400 invalid_request_error.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { logger } from '@lace/agent/utils/logger';
import type { ProviderMessage } from '@lace/agent/providers/base-provider';

const ADA_EVENTS = '/tmp/ada-events.jsonl';

/**
 * Mimics Anthropic's adjacency rule: every user tool_result block must follow
 * an assistant message containing a matching tool_use id.
 *
 * Returns null on success, or a description of the first failure.
 */
function validateAnthropicAdjacency(messages: ProviderMessage[]): string | null {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'user' || !Array.isArray(m.toolResults) || m.toolResults.length === 0) continue;

    const prev = messages[i - 1];
    if (!prev || prev.role !== 'assistant' || !Array.isArray(prev.toolCalls)) {
      return `messages[${i}] is a user tool_result block, but prior message is not assistant(tool_use)`;
    }
    const callIds = new Set(prev.toolCalls.map((c) => c.id));
    for (const tr of m.toolResults) {
      if (!tr.id || !callIds.has(tr.id)) {
        return `messages[${i}] contains tool_result id=${tr.id ?? '<none>'} with no matching tool_use in messages[${i - 1}]`;
      }
    }
  }
  return null;
}

describe.skipIf(!existsSync(ADA_EVENTS))(
  "PRI-1712 regression: Ada's rescued broken-compaction session",
  () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'lace-ada-rescue-'));
      copyFileSync(ADA_EVENTS, join(tempDir, 'events.jsonl'));
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('rebuilds without producing any orphan tool_result blocks', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

      expect(messages.length).toBeGreaterThan(0);

      const failure = validateAnthropicAdjacency(messages);
      expect(failure).toBeNull();

      // Ada's broken file had 4 tool_results and 3 tool_uses with one initial
      // orphan. The defensive pass must have logged at least one WARN.
      const orphanWarns = warnSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('orphaned tool_result')
      );
      expect(orphanWarns.length).toBeGreaterThan(0);
      warnSpy.mockRestore();
    });
  }
);
