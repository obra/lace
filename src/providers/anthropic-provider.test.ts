// ABOUTME: Unit tests for AnthropicProvider class
// ABOUTME: Tests streaming vs non-streaming responses, configuration, and error handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '~/providers/anthropic-provider';
import { Tool } from '~/tools/tool';
import { ToolResult, ToolContext } from '~/tools/types';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { StreamingEvents } from '~/providers/types';

// Mock external Anthropic SDK to avoid real API calls during tests
// Tests focus on provider logic, not Anthropic API implementation
const mockCreateResponse = vi.fn();
const mockStreamResponse = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreateResponse,
        stream: mockStreamResponse,
      };
    },
  };
});

// Mock logger to prevent test output noise and control log verification
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockTool: Tool;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new AnthropicProvider({
      apiKey: 'test-key',
    });
    provider.setSystemPrompt('Test system prompt');

    class TestTool extends Tool {
      name = 'test_tool';
      description = 'A test tool';
      schema = z.object({
        action: z.string().describe('Action to perform'),
      });

      protected async executeValidated(
        args: { action: string },
        _context?: ToolContext
      ): Promise<ToolResult> {
        return await Promise.resolve(this.createResult(`Executed action: ${args.action}`));
      }
    }

    mockTool = new TestTool();
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('basic properties', () => {
    it('should have correct provider name', () => {
      expect(provider.providerName).toBe('anthropic');
    });

    it('should have correct default model', () => {
      expect(provider.defaultModel).toBe('claude-sonnet-4-20250514');
    });

    it('should support streaming', () => {
      expect(provider.supportsStreaming).toBe(true);
    });

    it('should expose system prompt', () => {
      expect(provider.systemPrompt).toBe('Test system prompt');
    });
  });

  describe('non-streaming responses', () => {
    beforeEach(() => {
      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'Test response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    });

    it('should create non-streaming response correctly', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      const response = await provider.createResponse(messages, [mockTool]);

      expect(response.content).toBe('Test response');
      expect(response.toolCalls).toEqual([]);
    });

    it('should handle tool calls in response', async () => {
      mockCreateResponse.mockResolvedValue({
        content: [
          { type: 'text', text: 'Using tool' },
          {
            type: 'tool_use',
            id: 'call_123',
            name: 'test_tool',
            input: { action: 'test' },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const messages = [{ role: 'user' as const, content: 'Use tool' }];
      const response = await provider.createResponse(messages, [mockTool]);

      expect(response.content).toBe('Using tool');
      expect(response.toolCalls).toEqual([
        {
          id: 'call_123',
          name: 'test_tool',
          input: { action: 'test' },
        },
      ]);
    });

    it('should filter out system messages correctly', async () => {
      const messages = [
        { role: 'system' as const, content: 'System message' },
        { role: 'user' as const, content: 'User message' },
        { role: 'assistant' as const, content: 'Assistant message' },
      ];

      await provider.createResponse(messages, []);

      const callArgs = mockCreateResponse.mock
        .calls[0][0] as Anthropic.Messages.MessageCreateParams;
      expect(callArgs.messages).toEqual([
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' },
      ]);
      expect(callArgs.system).toBe('System message');
    });
  });

  describe('streaming responses', () => {
    interface MockStream {
      on: ReturnType<typeof vi.fn>;
      finalMessage: ReturnType<typeof vi.fn>;
    }
    let mockStream: MockStream;

    beforeEach(() => {
      mockStream = {
        on: vi.fn(),
        finalMessage: vi.fn(),
      };
      mockStreamResponse.mockReturnValue(mockStream);
    });

    it('should create streaming response correctly', async () => {
      const finalMessage = {
        content: [{ type: 'text', text: 'Streaming complete' }],
        usage: { input_tokens: 15, output_tokens: 8 },
      };
      mockStream.finalMessage.mockResolvedValue(finalMessage);

      const messages = [{ role: 'user' as const, content: 'Stream this' }];

      // Start the streaming response (don't await yet)
      const responsePromise = provider.createStreamingResponse(messages, [mockTool]);

      // Simulate the streaming events
      const textCallback = mockStream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'text'
      )?.[1] as (text: string) => void;
      textCallback('Hello ');
      textCallback('world!');

      // Complete the stream
      const response = await responsePromise;

      expect(response.content).toBe('Streaming complete');
      expect(response.toolCalls).toEqual([]);
    });

    it('should emit token events during streaming', async () => {
      const tokenEvents: string[] = [];
      provider.on('token', ({ token }: { token: string }) => {
        tokenEvents.push(token);
      });

      mockStream.finalMessage.mockResolvedValue({
        content: [{ type: 'text', text: 'Complete' }],
        usage: {},
      });

      const messages = [{ role: 'user' as const, content: 'Stream tokens' }];

      // Start streaming
      const responsePromise = provider.createStreamingResponse(messages, []);

      // Simulate token events
      const textCallback = mockStream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'text'
      )?.[1] as (text: string) => void;
      textCallback('Token ');
      textCallback('stream ');
      textCallback('test');

      await responsePromise;

      expect(tokenEvents).toEqual(['Token ', 'stream ', 'test']);
    });

    it('should emit complete event when streaming finishes', async () => {
      const completeEvents: StreamingEvents['complete'][] = [];
      provider.on('complete', (data: StreamingEvents['complete']) => {
        completeEvents.push(data);
      });

      const finalMessage = {
        content: [{ type: 'text', text: 'Final content' }],
        usage: {},
      };
      mockStream.finalMessage.mockResolvedValue(finalMessage);

      const messages = [{ role: 'user' as const, content: 'Complete test' }];
      await provider.createStreamingResponse(messages, []);

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].response.content).toBe('Final content');
    });

    it('should handle streaming errors', async () => {
      const errorEvents: Error[] = [];
      provider.on('error', ({ error }: StreamingEvents['error']) => {
        errorEvents.push(error);
      });

      const streamError = new Error('Stream failed');
      mockStream.finalMessage.mockRejectedValue(streamError);

      const messages = [{ role: 'user' as const, content: 'Error test' }];

      await expect(provider.createStreamingResponse(messages, [])).rejects.toThrow('Stream failed');

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].message).toBe('Stream failed');
    });

    it('should handle tool calls in streaming response', async () => {
      const finalMessage = {
        content: [
          { type: 'text', text: 'Using tool via stream' },
          {
            type: 'tool_use',
            id: 'stream_call_456',
            name: 'test_tool',
            input: { action: 'stream_action' },
          },
        ],
        usage: {},
      };
      mockStream.finalMessage.mockResolvedValue(finalMessage);

      const messages = [{ role: 'user' as const, content: 'Stream with tools' }];
      const response = await provider.createStreamingResponse(messages, [mockTool]);

      expect(response.content).toBe('Using tool via stream');
      expect(response.toolCalls).toEqual([
        {
          id: 'stream_call_456',
          name: 'test_tool',
          input: { action: 'stream_action' },
        },
      ]);
    });
  });

  describe('configuration handling', () => {
    it('should use custom model when provided', async () => {
      const customProvider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3-opus-20240229',
      });

      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'Custom model response' }],
        usage: {},
      });

      await customProvider.createResponse([{ role: 'user', content: 'Test' }], []);

      const callArgs = mockCreateResponse.mock
        .calls[0][0] as Anthropic.Messages.MessageCreateParams;
      expect(callArgs.model).toBe('claude-3-opus-20240229');
    });

    it('should use custom max tokens when provided', async () => {
      const customProvider = new AnthropicProvider({
        apiKey: 'test-key',
        maxTokens: 2000,
      });

      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'Custom tokens response' }],
        usage: {},
      });

      await customProvider.createResponse([{ role: 'user', content: 'Test' }], []);

      const callArgs = mockCreateResponse.mock
        .calls[0][0] as Anthropic.Messages.MessageCreateParams;
      expect(callArgs.max_tokens).toBe(2000);
    });

    it('should use fallback system prompt when none provided', async () => {
      const noSystemProvider = new AnthropicProvider({
        apiKey: 'test-key',
      });

      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'Fallback response' }],
        usage: {},
      });

      await noSystemProvider.createResponse([{ role: 'user', content: 'Test' }], []);

      const callArgs = mockCreateResponse.mock
        .calls[0][0] as Anthropic.Messages.MessageCreateParams;
      expect(callArgs.system).toBe('You are a helpful assistant.');
    });
  });

  describe('error handling', () => {
    it('should handle non-streaming errors', async () => {
      const providerError = new Error('API Error');
      mockCreateResponse.mockRejectedValue(providerError);

      const messages = [{ role: 'user' as const, content: 'Error test' }];

      await expect(provider.createResponse(messages, [])).rejects.toThrow('API Error');
    });

    it('should handle streaming setup errors', async () => {
      const streamError = new Error('Stream setup failed');
      mockStreamResponse.mockImplementation(() => {
        throw streamError;
      });

      const messages = [{ role: 'user' as const, content: 'Stream error test' }];

      await expect(provider.createStreamingResponse(messages, [])).rejects.toThrow(
        'Stream setup failed'
      );
    });
  });
});
