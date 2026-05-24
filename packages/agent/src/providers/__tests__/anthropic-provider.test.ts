// ABOUTME: Unit tests for AnthropicProvider class
// ABOUTME: Tests streaming vs non-streaming responses, configuration, and error handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolResult, ToolContext } from '@lace/agent/tools/types';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { StreamingEvents } from '../types';
import { anthropicBaseMessagesTrap } from '@lace/agent/test-utils/anthropic-base-namespace-trap';

// Mock external Anthropic SDK to avoid real API calls during tests
// Tests focus on provider logic, not Anthropic API implementation
const mockCreateResponse = vi.fn();
const mockStreamResponse = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      // The provider routes through beta.messages.* (chunk I migration). The
      // base messages.* slot is a throwing trap — any call to client.messages.*
      // means we've regressed and the test must fail loudly.
      messages = anthropicBaseMessagesTrap();
      beta = {
        messages: {
          create: mockCreateResponse,
          stream: mockStreamResponse,
          countTokens: vi.fn().mockResolvedValue({ input_tokens: 100 }),
        },
      };
    },
  };
});

// Mock logger to prevent test output noise and control log verification
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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
        _context: ToolContext
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

    // defaultModel removed - providers are now model-agnostic

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

      const response = await provider.createResponse(
        messages,
        [mockTool],
        'claude-sonnet-4-20250514'
      );

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
      const response = await provider.createResponse(
        messages,
        [mockTool],
        'claude-sonnet-4-20250514'
      );

      expect(response.content).toBe('Using tool');
      expect(response.toolCalls).toEqual([
        {
          id: 'call_123',
          name: 'test_tool',
          arguments: { action: 'test' },
        },
      ]);
    });

    it('should filter out system messages correctly', async () => {
      // role:system messages are stripped from messages[] by convertToAnthropicFormat.
      // The actual system prompt comes from setSystemPrompt(), called in beforeEach.
      const messages = [
        { role: 'system' as const, content: 'System message' },
        { role: 'user' as const, content: 'User message' },
        { role: 'assistant' as const, content: 'Assistant message' },
      ];

      await provider.createResponse(messages, [], 'claude-sonnet-4-20250514');

      const callArgs = mockCreateResponse.mock
        .calls[0][0] as Anthropic.Messages.MessageCreateParams;
      // role:system is filtered out of messages[] by convertToAnthropicFormat;
      // PRI-1799: last message is converted to a content-block array so we
      // can attach a 1h cache_control breakpoint to its final block.
      expect(callArgs.messages).toEqual([
        { role: 'user', content: 'User message' },
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Assistant message',
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ],
        },
      ]);
      // System prompt is sourced from setSystemPrompt(), not from role:system messages
      // (PRI-1804 invariant: system prompt is set once at session start and never
      // changes; role:system entries in input are ignored).
      expect(Array.isArray(callArgs.system)).toBe(true);
      const systemBlocks = callArgs.system as Array<{
        type: string;
        text: string;
        cache_control?: { type: string };
      }>;
      expect(systemBlocks[0].text).toBe('Test system prompt');
      expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    });

    it('uses _systemPrompt (set via setSystemPrompt) and ignores any role:system messages in input (PRI-1804 invariant)', async () => {
      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'r' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      provider.setSystemPrompt('Frozen prompt set at session start.');

      // role:system messages in the input must NOT influence the request's
      // system block. The system prompt is set once at session start via
      // setSystemPrompt() and is byte-stable for the session lifetime —
      // this is what makes the system+tools cache prefix reusable.
      await provider.createResponse(
        [
          { role: 'system', content: 'This must be ignored.' },
          { role: 'system', content: 'This too.' },
          { role: 'user', content: 'Hello' },
        ],
        [],
        'claude-sonnet-4-20250514'
      );

      const callArgs = mockCreateResponse.mock
        .calls[0][0] as Anthropic.Messages.MessageCreateParams;
      const sysBlocks = callArgs.system as Array<{ text: string }>;
      expect(sysBlocks[0].text).toBe('Frozen prompt set at session start.');
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
      const responsePromise = provider.createStreamingResponse(
        messages,
        [mockTool],
        'claude-sonnet-4-20250514'
      );

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
      const responsePromise = provider.createStreamingResponse(
        messages,
        [],
        'claude-sonnet-4-20250514'
      );

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
      await provider.createStreamingResponse(messages, [], 'claude-sonnet-4-20250514');

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

      await expect(
        provider.createStreamingResponse(messages, [], 'claude-sonnet-4-20250514')
      ).rejects.toThrow('Stream failed');

      // Provider no longer emits error events (handled at agent level to prevent duplicates)
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
      const response = await provider.createStreamingResponse(
        messages,
        [mockTool],
        'claude-sonnet-4-20250514'
      );

      expect(response.content).toBe('Using tool via stream');
      expect(response.toolCalls).toEqual([
        {
          id: 'stream_call_456',
          name: 'test_tool',
          arguments: { action: 'stream_action' },
        },
      ]);
    });
  });

  describe('configuration handling', () => {
    it('should use model passed as parameter', async () => {
      const customProvider = new AnthropicProvider({
        apiKey: 'test-key',
      });

      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'Custom model response' }],
        usage: {},
      });

      await customProvider.createResponse(
        [{ role: 'user', content: 'Test' }],
        [],
        'claude-sonnet-4-20250514'
      );

      const callArgs = mockCreateResponse.mock
        .calls[0][0] as Anthropic.Messages.MessageCreateParams;
      expect(callArgs.model).toBe('claude-sonnet-4-20250514');
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

      await customProvider.createResponse(
        [{ role: 'user', content: 'Test' }],
        [],
        'claude-sonnet-4-20250514'
      );

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

      await noSystemProvider.createResponse(
        [{ role: 'user', content: 'Test' }],
        [],
        'claude-sonnet-4-20250514'
      );

      const callArgs = mockCreateResponse.mock
        .calls[0][0] as Anthropic.Messages.MessageCreateParams;
      // System prompt is now an array with cache_control for prompt caching
      expect(Array.isArray(callArgs.system)).toBe(true);
      const systemBlocks = callArgs.system as Array<{
        type: string;
        text: string;
        cache_control?: { type: string };
      }>;
      expect(systemBlocks[0].text).toBe('You are a helpful assistant.');
      expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    });
  });

  describe('error handling', () => {
    it('should handle non-streaming errors', async () => {
      const providerError = new Error('API Error');
      mockCreateResponse.mockRejectedValue(providerError);

      const messages = [{ role: 'user' as const, content: 'Error test' }];

      await expect(
        provider.createResponse(messages, [], 'claude-sonnet-4-20250514')
      ).rejects.toThrow('API Error');
    });

    it('should handle streaming setup errors', async () => {
      const streamError = new Error('Stream setup failed');
      mockStreamResponse.mockImplementation(() => {
        throw streamError;
      });

      const messages = [{ role: 'user' as const, content: 'Stream error test' }];

      await expect(
        provider.createStreamingResponse(messages, [], 'claude-sonnet-4-20250514')
      ).rejects.toThrow('Stream setup failed');
    });
  });

  // PRI-1817: surface cache_creation_input_tokens and cache_read_input_tokens
  // from the SDK response into ProviderResponse.usage so the runner can
  // accumulate them and compute real cost.
  describe('cache token mapping (PRI-1817)', () => {
    it('maps cache_creation/cache_read fields from non-streaming response', async () => {
      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: {
          input_tokens: 2000,
          output_tokens: 100,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 5000,
        },
      });

      const response = await provider.createResponse(
        [{ role: 'user' as const, content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      expect(response.usage).toBeDefined();
      expect(response.usage!.promptTokens).toBe(2000);
      expect(response.usage!.completionTokens).toBe(100);
      expect(response.usage!.cacheCreationInputTokens).toBe(1000);
      expect(response.usage!.cacheReadInputTokens).toBe(5000);
    });

    it('defaults missing cache fields to 0', async () => {
      // Some Anthropic responses (e.g. on uncached cold-start turns) omit
      // the cache fields entirely. We must default to 0, not leave undefined,
      // so the runner's `+= ?? 0` math stays correct.
      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const response = await provider.createResponse(
        [{ role: 'user' as const, content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      expect(response.usage!.cacheCreationInputTokens).toBe(0);
      expect(response.usage!.cacheReadInputTokens).toBe(0);
    });

    it('maps cache_creation/cache_read fields from streaming response', async () => {
      const mockStream = {
        on: vi.fn(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'streamed' }],
          usage: {
            input_tokens: 3000,
            output_tokens: 200,
            cache_creation_input_tokens: 1500,
            cache_read_input_tokens: 8000,
          },
        }),
      };
      mockStreamResponse.mockReturnValue(mockStream);

      const response = await provider.createStreamingResponse(
        [{ role: 'user' as const, content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      expect(response.usage).toBeDefined();
      expect(response.usage!.promptTokens).toBe(3000);
      expect(response.usage!.completionTokens).toBe(200);
      expect(response.usage!.cacheCreationInputTokens).toBe(1500);
      expect(response.usage!.cacheReadInputTokens).toBe(8000);
    });
  });
});
