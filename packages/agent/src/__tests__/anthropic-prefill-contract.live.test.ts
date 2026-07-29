// ABOUTME: LIVE contract test against the real Anthropic API. Pins the rule the
// ABOUTME: inject-drain wedge trips over: claude-opus-4-8 refuses a conversation
// ABOUTME: that ends with an assistant message ("assistant prefill"), while
// ABOUTME: claude-sonnet-4-5 accepts one. No mocks — real key, real endpoint.

import { describe, expect, it } from 'vitest';

const API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * The second half of the inject-drain wedge (the first half is
 * agent-process.inject-drain-prefill.e2e.test.ts, which proves the drain
 * dispatches a request whose conversation ends on an assistant message).
 *
 * This test proves what the real API does with that shape. Together they close
 * the loop on the production failure seen on ada-sen:
 *
 *   400 invalid_request_error: This model does not support assistant message
 *   prefill. The conversation must end with a user message.
 *
 * Note the trigger is the MODEL, not extended thinking: opus-4-8 refuses the
 * prefill with thinking on OR off. Turning thinking off is not a workaround.
 * Skipped when ANTHROPIC_API_KEY is unset (CI without credentials).
 */
describe.skipIf(!API_KEY)('Anthropic assistant-prefill contract (LIVE)', () => {
  async function send(body: Record<string, unknown>): Promise<{
    status: number;
    errorMessage?: string;
    stopReason?: string;
  }> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY as string,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      error?: { message?: string };
      stop_reason?: string;
    };
    return {
      status: res.status,
      ...(json.error?.message !== undefined ? { errorMessage: json.error.message } : {}),
      ...(json.stop_reason !== undefined ? { stopReason: json.stop_reason } : {}),
    };
  }

  const TRAILING_ASSISTANT = [
    { role: 'user', content: 'Say hello.' },
    { role: 'assistant', content: 'Hello.' },
  ];
  const TRAILING_USER = [...TRAILING_ASSISTANT, { role: 'user', content: 'news?' }];

  it(
    'opus-4-8 REJECTS a conversation ending on an assistant message',
    { timeout: 30_000 },
    async () => {
      const result = await send({
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        messages: TRAILING_ASSISTANT,
      });

      expect(result.status).toBe(400);
      expect(result.errorMessage).toContain('does not support assistant message prefill');
      expect(result.errorMessage).toContain('must end with a user message');
    }
  );

  it(
    'opus-4-8 ACCEPTS the same conversation once a user message closes it',
    { timeout: 30_000 },
    async () => {
      const result = await send({
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        messages: TRAILING_USER,
      });

      expect(result.status).toBe(200);
      expect(result.errorMessage).toBeUndefined();
    }
  );

  it(
    'the refusal is the MODEL, not thinking — same 400 with no thinking block',
    { timeout: 30_000 },
    async () => {
      const result = await send({
        model: 'claude-opus-4-8',
        max_tokens: 1000,
        messages: TRAILING_ASSISTANT,
      });

      expect(result.status).toBe(400);
      expect(result.errorMessage).toContain('does not support assistant message prefill');
    }
  );

  it(
    'sonnet-4-5 still accepts prefill — the contract is model-specific',
    { timeout: 30_000 },
    async () => {
      const result = await send({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: TRAILING_ASSISTANT,
      });

      expect(result.status).toBe(200);
    }
  );
});
