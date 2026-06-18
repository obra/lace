// ABOUTME: Per-converter determinism gate. Each of the four format converters is
// a pure function of its neutral ProviderMessage[] input, so feeding it the
// corpus twice must yield byte-identical JSON. Also pins the Gemini tool-call-id
// landmine (Date.now()/Math.random() ids are minted only in response parsing,
// never when converting persisted history) and the OpenAI token-count wire
// re-serialization (live on the no-usage fallback path).

import { describe, it, expect } from 'vitest';
import {
  convertToAnthropicFormat,
  convertToOpenAIFormat,
  convertToGeminiFormat,
  convertToTextOnlyFormat,
} from '@lace/agent/providers/format-converters';
import { OpenAIProvider } from '@lace/agent/providers/openai-provider';
import { FIXTURES } from './golden/_fixtures';

describe('converter determinism: each converter is a pure function of its input', () => {
  for (const fixture of FIXTURES) {
    it(`all four converters are byte-stable for "${fixture.name}"`, () => {
      expect(JSON.stringify(convertToAnthropicFormat(fixture.messages))).toBe(
        JSON.stringify(convertToAnthropicFormat(fixture.messages))
      );
      expect(JSON.stringify(convertToOpenAIFormat(fixture.messages))).toBe(
        JSON.stringify(convertToOpenAIFormat(fixture.messages))
      );
      expect(JSON.stringify(convertToGeminiFormat(fixture.messages))).toBe(
        JSON.stringify(convertToGeminiFormat(fixture.messages))
      );
      expect(JSON.stringify(convertToTextOnlyFormat(fixture.messages))).toBe(
        JSON.stringify(convertToTextOnlyFormat(fixture.messages))
      );
    });
  }

  it('Gemini converter is deterministic given a persisted tool-call id (no re-minting)', () => {
    const messages = [
      { role: 'user' as const, content: 'go' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [
          { id: 'gemini_echo_1700000000000_abc123', name: 'echo', arguments: { v: 'z' } },
        ],
      },
      {
        role: 'user' as const,
        content: '',
        toolResults: [
          {
            id: 'gemini_echo_1700000000000_abc123',
            content: [{ type: 'text' as const, text: 'z' }],
            status: 'completed' as const,
          },
        ],
      },
    ];
    expect(JSON.stringify(convertToGeminiFormat(messages))).toBe(
      JSON.stringify(convertToGeminiFormat(messages))
    );
  });
});

describe('OpenAI token-count path is deterministic', () => {
  it('counts the same tokens twice for a fixture', async () => {
    // Token counting routes through countTokens -> _countTokensImpl ->
    // countTokensExplicit (local tiktoken, no network). The OpenAIProvider
    // makes no API call here, so a throwaway apiKey is fine.
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    provider.setSystemPrompt('You are Lace. Cached system block.');
    const msgs = FIXTURES[0]!.messages;
    const a = await provider.countTokens(msgs, [], 'gpt-4o');
    const b = await provider.countTokens(msgs, [], 'gpt-4o');
    expect(a).toBe(b);
  }, 20000);
});
