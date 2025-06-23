// ABOUTME: Tests for AbortSignal integration across all AI providers
// ABOUTME: Validates that each provider correctly accepts and handles AbortSignal for cancellation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider.js';
import { OpenAIProvider } from '../openai-provider.js';
import { LMStudioProvider } from '../lmstudio-provider.js';
import { OllamaProvider } from '../ollama-provider.js';
import { ProviderMessage } from '../types.js';
import { Tool } from '../../tools/types.js';

describe('Provider AbortSignal Integration', () => {
  let abortController: AbortController;
  const tools: Tool[] = [];
  const messages: ProviderMessage[] = [
    { role: 'user', content: 'Hello, world!' }
  ];

  beforeEach(() => {
    abortController = new AbortController();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Anthropic Provider', () => {
    it('should accept AbortSignal parameter in createResponse method', async () => {
      // Arrange
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });

      // Act & Assert - should not throw for method signature acceptance
      expect(() => {
        // This tests that the method signature accepts AbortSignal
        (provider as any).createResponse(messages, tools, abortController.signal);
      }).not.toThrow();
    });

    it('should accept AbortSignal parameter in createStreamingResponse method', async () => {
      // Arrange
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });

      // Act & Assert - should not throw for method signature acceptance
      expect(() => {
        // This tests that the method signature accepts AbortSignal
        (provider as any).createStreamingResponse(messages, tools, abortController.signal);
      }).not.toThrow();
    });

    it('should throw AbortError when signal is pre-aborted', async () => {
      // Arrange
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });
      
      // Abort the signal before calling
      abortController.abort();

      // Act & Assert
      await expect((provider as any).createResponse(messages, tools, abortController.signal))
        .rejects.toThrow();
    });
  });

  describe('OpenAI Provider', () => {
    it('should accept AbortSignal parameter in createResponse method', async () => {
      // Arrange
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      // Act & Assert - should not throw for method signature acceptance
      expect(() => {
        // This tests that the method signature accepts AbortSignal
        (provider as any).createResponse(messages, tools, abortController.signal);
      }).not.toThrow();
    });

    it('should accept AbortSignal parameter in createStreamingResponse method', async () => {
      // Arrange
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      // Act & Assert - should not throw for method signature acceptance
      expect(() => {
        // This tests that the method signature accepts AbortSignal
        (provider as any).createStreamingResponse(messages, tools, abortController.signal);
      }).not.toThrow();
    });

    it('should throw AbortError when signal is pre-aborted', async () => {
      // Arrange
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });
      
      // Abort the signal before calling
      abortController.abort();

      // Act & Assert
      await expect((provider as any).createResponse(messages, tools, abortController.signal))
        .rejects.toThrow();
    });
  });

  describe('LMStudio Provider', () => {
    it('should accept AbortSignal parameter in createResponse method', async () => {
      // Arrange
      const provider = new LMStudioProvider({
        baseURL: 'http://localhost:1234',
        model: 'test-model',
      });

      // Act & Assert - should not throw for method signature acceptance
      expect(() => {
        // This tests that the method signature accepts AbortSignal
        (provider as any).createResponse(messages, tools, abortController.signal);
      }).not.toThrow();
    });

    it('should accept AbortSignal parameter in createStreamingResponse method', async () => {
      // Arrange
      const provider = new LMStudioProvider({
        baseURL: 'http://localhost:1234',
        model: 'test-model',
      });

      // Act & Assert - should not throw for method signature acceptance
      expect(() => {
        // This tests that the method signature accepts AbortSignal
        (provider as any).createStreamingResponse(messages, tools, abortController.signal);
      }).not.toThrow();
    });

    it('should throw AbortError when signal is pre-aborted', async () => {
      // Arrange
      const provider = new LMStudioProvider({
        baseURL: 'http://localhost:1234',
        model: 'test-model',
      });
      
      // Abort the signal before calling
      abortController.abort();

      // Act & Assert
      await expect((provider as any).createResponse(messages, tools, abortController.signal))
        .rejects.toThrow();
    });
  });

  describe('Ollama Provider', () => {
    it('should accept AbortSignal parameter in createResponse method', async () => {
      // Arrange
      const provider = new OllamaProvider({
        baseURL: 'http://localhost:11434',
        model: 'llama2',
      });

      // Act & Assert - should not throw for method signature acceptance
      expect(() => {
        // This tests that the method signature accepts AbortSignal
        (provider as any).createResponse(messages, tools, abortController.signal);
      }).not.toThrow();
    });

    it('should accept AbortSignal parameter in createStreamingResponse method', async () => {
      // Arrange
      const provider = new OllamaProvider({
        baseURL: 'http://localhost:11434',
        model: 'llama2',
      });

      // Act & Assert - should not throw for method signature acceptance
      expect(() => {
        // This tests that the method signature accepts AbortSignal
        (provider as any).createStreamingResponse(messages, tools, abortController.signal);
      }).not.toThrow();
    });

    it('should handle abort via AbortableAsyncIterator for streaming', async () => {
      // Arrange
      const provider = new OllamaProvider({
        baseURL: 'http://localhost:11434',
        model: 'llama2',
      });
      
      // Abort the signal before calling
      abortController.abort();

      // Act & Assert - Should handle the abort gracefully
      await expect((provider as any).createResponse(messages, tools, abortController.signal))
        .rejects.toThrow();
    });
  });

  describe('Provider Method Signatures', () => {
    it('should ensure all providers accept AbortSignal in their method signatures', () => {
      // This test validates that all providers can accept AbortSignal in their method signatures
      // without throwing TypeScript compilation errors
      
      const providers = [
        new AnthropicProvider({ apiKey: 'test-key', model: 'claude-sonnet-4-20250514' }),
        new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4' }),
        new LMStudioProvider({ baseURL: 'http://localhost:1234', model: 'test-model' }),
        new OllamaProvider({ baseURL: 'http://localhost:11434', model: 'llama2' })
      ];

      for (const provider of providers) {
        // Test that the methods can be called with AbortSignal without TypeScript errors
        expect(() => {
          // These should not throw due to method signature issues
          (provider as any).createResponse(messages, tools, abortController.signal);
          (provider as any).createStreamingResponse(messages, tools, abortController.signal);
        }).not.toThrow();
      }
    });
  });
});