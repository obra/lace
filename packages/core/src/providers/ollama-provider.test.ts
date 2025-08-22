// ABOUTME: Tests for Ollama provider
// ABOUTME: Verifies basic functionality and configuration

import { describe, it, expect } from 'vitest';
import { OllamaProvider } from '~/providers/ollama-provider';

describe('OllamaProvider', () => {
  it('should have correct provider name', () => {
    const provider = new OllamaProvider();
    expect(provider.providerName).toBe('ollama');
  });

  // defaultModel removed - providers are now model-agnostic

  it('should support streaming', () => {
    const provider = new OllamaProvider();
    expect(provider.supportsStreaming).toBe(true);
  });
});
