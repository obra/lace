// ABOUTME: Pins a load-bearing byte-safety invariant: an assistant message whose
// text is carried as a plain string and the same text carried as a single
// { type: 'text' } ContentBlock[] convert to byte-identical wire output, for every
// provider. The rebuild path (buildProviderMessagesFromDurableEvents via foldEvent)
// yields ContentBlock[] for `message` events, while the runner's live tail yields a
// string — so this equivalence is what keeps the prompt-cache prefix stable across
// turns (sent == rebuilt) regardless of which shape produced the assistant text.
// If a converter change breaks this, a parallel-tool-free assistant turn would
// silently bust the cache; this test catches it.

import { describe, it, expect } from 'vitest';
import {
  convertToAnthropicFormat,
  convertToOpenAIFormat,
  convertToGeminiFormat,
  convertToTextOnlyFormat,
} from '../format-converters';
import type { ProviderMessage } from '../base-provider';

const TEXT = 'doing the thing';

// Same logical assistant message, two content encodings.
const asString: ProviderMessage[] = [{ role: 'assistant', content: TEXT }];
const asBlocks: ProviderMessage[] = [
  { role: 'assistant', content: [{ type: 'text', text: TEXT }] },
];

// And the same, paired with tool calls (the canonical parallel-tool assistant).
const call = { id: 'c1', name: 'echo', arguments: { v: 'x' } };
const asStringWithCall: ProviderMessage[] = [
  { role: 'assistant', content: TEXT, toolCalls: [call] },
];
const asBlocksWithCall: ProviderMessage[] = [
  { role: 'assistant', content: [{ type: 'text', text: TEXT }], toolCalls: [call] },
];

describe('assistant text content: string and single-text-block array convert identically', () => {
  it('Anthropic — plain assistant text', () => {
    expect(JSON.stringify(convertToAnthropicFormat(asString))).toBe(
      JSON.stringify(convertToAnthropicFormat(asBlocks))
    );
  });

  it('Anthropic — assistant text with tool call', () => {
    expect(JSON.stringify(convertToAnthropicFormat(asStringWithCall))).toBe(
      JSON.stringify(convertToAnthropicFormat(asBlocksWithCall))
    );
  });

  it('OpenAI — plain assistant text', () => {
    expect(JSON.stringify(convertToOpenAIFormat(asString))).toBe(
      JSON.stringify(convertToOpenAIFormat(asBlocks))
    );
  });

  it('OpenAI — assistant text with tool call', () => {
    expect(JSON.stringify(convertToOpenAIFormat(asStringWithCall))).toBe(
      JSON.stringify(convertToOpenAIFormat(asBlocksWithCall))
    );
  });

  it('Gemini — plain assistant text', () => {
    expect(JSON.stringify(convertToGeminiFormat(asString))).toBe(
      JSON.stringify(convertToGeminiFormat(asBlocks))
    );
  });

  it('Gemini — assistant text with tool call', () => {
    expect(JSON.stringify(convertToGeminiFormat(asStringWithCall))).toBe(
      JSON.stringify(convertToGeminiFormat(asBlocksWithCall))
    );
  });

  it('text-only — plain assistant text', () => {
    expect(JSON.stringify(convertToTextOnlyFormat(asString))).toBe(
      JSON.stringify(convertToTextOnlyFormat(asBlocks))
    );
  });
});
