
// ABOUTME: Tests for Ollama provider
// ABOUTME: Verifies basic functionality and configuration

import { describe, it, expect } from 'vitest';
import { OllamaProvider } from '../ollama-provider.js';

describe('OllamaProvider', () => {
  it('should have correct provider name', () => {
    const provider = new OllamaProvider();
    expect(provider.providerName).toBe('ollama');
  });

  it('should have correct default model', () => {
    const provider = new OllamaProvider();
    expect(provider.defaultModel).toBe('qwen3:32b');
  });

  it('should support streaming', () => {
    const provider = new OllamaProvider();
    expect(provider.supportsStreaming).toBe(true);
  });
});
