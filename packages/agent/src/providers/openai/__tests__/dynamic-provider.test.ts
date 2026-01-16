// ABOUTME: Tests for OpenAI dynamic provider chat compatibility filtering
// Ensures non-chat models (embeddings, audio, image, legacy completions) are filtered out

import { describe, it, expect } from 'vitest';
import { OpenAIDynamicProvider } from '../dynamic-provider';

// Access the private method via a test subclass
class TestableOpenAIDynamicProvider extends OpenAIDynamicProvider {
  public testIsChatCompatible(modelId: string): boolean {
    // @ts-expect-error - accessing private method for testing
    return this.isChatCompatibleModel(modelId);
  }
}

describe('OpenAIDynamicProvider', () => {
  describe('isChatCompatibleModel', () => {
    const provider = new TestableOpenAIDynamicProvider('test-instance');

    describe('chat-compatible models (should be included)', () => {
      const chatModels = [
        // GPT-4 family
        'gpt-4',
        'gpt-4-turbo',
        'gpt-4-turbo-preview',
        'gpt-4-0125-preview',
        'gpt-4-1106-preview',
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4o-2024-05-13',
        // GPT-3.5-turbo family
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-0125',
        'gpt-3.5-turbo-16k',
        // Reasoning models (Responses API)
        'o1',
        'o1-mini',
        'o1-preview',
        'o1-pro',
        'o3',
        'o3-mini',
        'o3-pro',
        'o4-mini-deep-research',
        // GPT-5 family
        'gpt-5',
        'gpt-5-codex',
        'gpt-5-pro',
        // Fine-tuned GPT models
        'ft:gpt-4o-mini:my-org::abc123',
        'ft:gpt-3.5-turbo:my-org::xyz789',
        // ChatGPT models
        'chatgpt-4o-latest',
      ];

      it.each(chatModels)('includes %s', (modelId) => {
        expect(provider.testIsChatCompatible(modelId)).toBe(true);
      });
    });

    describe('non-chat models (should be excluded)', () => {
      const nonChatModels = [
        // Embedding models
        'text-embedding-3-small',
        'text-embedding-3-large',
        'text-embedding-ada-002',
        // Audio models
        'whisper-1',
        'tts-1',
        'tts-1-hd',
        // Image models
        'dall-e-2',
        'dall-e-3',
        // Legacy completion models
        'davinci',
        'davinci-002',
        'babbage',
        'babbage-002',
        'curie',
        'ada',
        // Completion-only instruct model
        'gpt-3.5-turbo-instruct',
        'gpt-3.5-turbo-instruct-0914',
        // Legacy text completion models
        'text-davinci-003',
        'text-davinci-002',
        'text-curie-001',
        'text-babbage-001',
        'text-ada-001',
        // Legacy code models
        'code-davinci-002',
        'code-cushman-001',
        // Fine-tuned legacy models
        'ft:davinci-002:my-org::abc123',
        'ft:babbage-002:my-org::xyz789',
        // Moderation models
        'moderation-latest',
        'moderation-stable',
        'omni-moderation-latest',
        // Search/similarity models (deprecated)
        'text-search-davinci-doc-001',
        'text-similarity-davinci-001',
      ];

      it.each(nonChatModels)('excludes %s', (modelId) => {
        expect(provider.testIsChatCompatible(modelId)).toBe(false);
      });
    });

    describe('unknown models (should be included by default)', () => {
      it('includes unknown model names to allow trying new models', () => {
        expect(provider.testIsChatCompatible('some-random-model')).toBe(true);
        expect(provider.testIsChatCompatible('my-custom-model')).toBe(true);
        expect(provider.testIsChatCompatible('gpt-6-turbo')).toBe(true);
        expect(provider.testIsChatCompatible('claude-3-opus')).toBe(true);
      });
    });
  });
});
