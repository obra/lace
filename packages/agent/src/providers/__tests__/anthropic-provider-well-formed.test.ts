// ABOUTME: The provider sanitizes lone surrogates in the request so a corrupted
// ABOUTME: history (e.g. compaction truncating mid-emoji) can't wedge the session.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicBaseMessagesTrap } from '@lace/agent/test-utils/anthropic-base-namespace-trap';

const mockCreateResponse = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = anthropicBaseMessagesTrap();
      beta = {
        messages: {
          create: mockCreateResponse,
          stream: vi.fn(),
          countTokens: vi.fn().mockResolvedValue({ input_tokens: 100 }),
        },
      };
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), trace: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../utils/provider-logging.js', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

const HIGH = '\uD83D'; // lone high surrogate — the lead half of 😀, left behind by a mid-pair truncation

describe('AnthropicProvider lone-surrogate sanitization', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({ apiKey: 'test-key' });
    provider.setSystemPrompt('Test system prompt');
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  it('replaces a lone surrogate in message content before sending, and the body round-trips JSON', async () => {
    await provider.createResponse(
      [{ role: 'user', content: `secret ${HIGH} token` }],
      [],
      'claude-sonnet-4-20250514'
    );

    const payload = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;

    // The bad code unit is gone; no lone surrogate remains anywhere in the body.
    const serialized = JSON.stringify(payload);
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(serialized)
    ).toBe(false);
    // Strict re-parse (the Anthropic-side failure mode) now succeeds.
    expect(() => JSON.parse(serialized)).not.toThrow();

    const lastMessage = payload.messages[payload.messages.length - 1];
    const blocks = lastMessage.content as Array<{ type: string; text?: string }>;
    expect(blocks.some((b) => b.text?.includes('secret � token'))).toBe(true);
  });
});
