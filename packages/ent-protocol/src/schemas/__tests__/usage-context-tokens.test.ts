// ABOUTME: Tests that UsageInfoSchema carries lastCallInputContextTokens — the
// ABOUTME: last API call's on-the-wire input context size — so an embedder can
// ABOUTME: gate compaction on real context occupancy instead of a turn-cumulative
// ABOUTME: sum. Also pins the back-compat contract: the field is optional and the
// ABOUTME: schema stays strict about genuinely unknown keys.

import { describe, expect, it } from 'vitest';
import { UsageInfoSchema } from '../shared';
import { SessionUpdateNotificationSchema } from '../methods';

describe('UsageInfoSchema.lastCallInputContextTokens', () => {
  it('accepts the field and preserves its value', () => {
    const parsed = UsageInfoSchema.parse({
      inputTokens: 12,
      outputTokens: 34,
      cacheReadTokens: 65_000,
      cacheWriteTokens: 1_200,
      lastCallInputContextTokens: 66_212,
    });
    expect(parsed.lastCallInputContextTokens).toBe(66_212);
  });

  it('leaves the field undefined when absent, so an older agent still parses', () => {
    // Back-compat direction: a newer embedder pointed at an older lace that
    // does not send the field must still parse the payload and simply see
    // `undefined` — never a validation failure.
    const parsed = UsageInfoSchema.parse({ inputTokens: 12, outputTokens: 34 });
    expect(parsed.lastCallInputContextTokens).toBeUndefined();
  });

  it('still rejects genuinely unknown keys', () => {
    expect(() =>
      UsageInfoSchema.parse({
        inputTokens: 12,
        outputTokens: 34,
        somethingNobodyDefined: 1,
      })
    ).toThrow();
  });

  it('rejects a non-numeric value', () => {
    expect(() =>
      UsageInfoSchema.parse({
        inputTokens: 12,
        outputTokens: 34,
        lastCallInputContextTokens: 'lots',
      })
    ).toThrow();
  });

  it('rides on a turn_end session/update notification', () => {
    // turn_end is the payload sen-core's CompactionTrigger reads. The
    // notification schema is strict, so the field has to be declared for the
    // wire message to validate at all.
    const parsed = SessionUpdateNotificationSchema.parse({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_00000000-0000-4000-8000-000000000000',
        streamSeq: 1,
        type: 'turn_end',
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: {
          inputTokens: 12,
          outputTokens: 34,
          cacheReadTokens: 65_000,
          lastCallInputContextTokens: 66_212,
        },
      },
    });
    const params = parsed.params as { usage: { lastCallInputContextTokens?: number } };
    expect(params.usage.lastCallInputContextTokens).toBe(66_212);
  });
});
