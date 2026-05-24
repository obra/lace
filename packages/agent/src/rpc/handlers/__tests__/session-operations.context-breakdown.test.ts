// ABOUTME: Regression test for PRI-1799 context-breakdown systemPrompt token accounting.
// ABOUTME: After Phase 2 of cache-control hardening, rebuilt messages never contain
// ABOUTME: role:'system' entries — the system prompt lives in the returned systemPrompt
// ABOUTME: string. This test verifies that the inputs used by
// ABOUTME: computeContextBreakdownForActiveSession are correct, preventing the
// ABOUTME: systemPromptTokens=0 regression.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { estimateTokens } from '@lace/agent/utils/token-estimation';

const KNOWN_SYSTEM_PROMPT = 'You are Lace, a helpful AI assistant. Be concise.';

function writeEvents(dir: string, events: unknown[]): void {
  writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

describe('context-breakdown systemPrompt token accounting (PRI-1799 regression)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-ctx-breakdown-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('buildProviderMessagesFromDurableEvents returns systemPrompt from system_prompt_set event', () => {
    writeEvents(tempDir, [
      {
        eventSeq: 1,
        type: 'system_prompt_set',
        data: { type: 'system_prompt_set', text: KNOWN_SYSTEM_PROMPT },
      },
      {
        eventSeq: 2,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'Hello' }] },
      },
    ]);

    const { messages, systemPrompt } = buildProviderMessagesFromDurableEvents(tempDir);

    // The fix: systemPrompt is non-empty — estimateTokens(systemPrompt) will be > 0.
    expect(systemPrompt).toBe(KNOWN_SYSTEM_PROMPT);
    expect(estimateTokens(systemPrompt)).toBeGreaterThan(0);
    expect(estimateTokens(systemPrompt)).toBe(Math.ceil(KNOWN_SYSTEM_PROMPT.length / 4));

    // Confirm the regression was real: no role:'system' message in the rebuilt messages array.
    // The old code tried to find role:'system' entries here and always got 0.
    const systemMessages = messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(0);
  });

  it('estimateTokens on empty systemPrompt returns 0 (baseline for sessions with no system_prompt_set)', () => {
    // Sessions with no system_prompt_set event return systemPrompt:''.
    // After the fix, systemPromptTokens = estimateTokens('') = 0 — correct behavior,
    // not a regression (those sessions genuinely have no system prompt to account for).
    writeEvents(tempDir, [
      {
        eventSeq: 1,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'Hello' }] },
      },
    ]);

    const { systemPrompt } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(systemPrompt).toBe('');
    expect(estimateTokens(systemPrompt)).toBe(0);
  });
});
