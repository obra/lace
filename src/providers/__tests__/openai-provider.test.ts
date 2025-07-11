// ABOUTME: Unit tests for OpenAIProvider class
// ABOUTME: Tests streaming vs non-streaming responses, configuration, and error handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '~/providers/openai-provider.js';
import { Tool } from '~/tools/tool.js';
import { ToolResult, ToolContext } from '~/tools/types.js';
import { z } from 'zod';

// Mock the OpenAI SDK
const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockTool: Tool;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new OpenAIProvider({
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
        return this.createResult(`Executed action: ${args.action}`);
      }
    }

    mockTool = new TestTool();
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('basic properties', () => {
    it('should have correct provider name', () => {
      expect(provider.providerName).toBe('openai');
    });

    it('should have correct default model', () => {
      expect(provider.defaultModel).toBe('gpt-4o-mini');
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
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Test response',
              tool_calls: undefined,
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    });

    it('should create non-streaming response correctly', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      const response = await provider.createResponse(messages, [mockTool]);

      expect(response.content).toBe('Test response');
      expect(response.toolCalls).toEqual([]);
      expect(mockCreate).toHaveBeenCalled();

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-4o-mini');
      expect(callArgs.max_tokens).toBe(4000);
      expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'Test system prompt' });
      expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(callArgs.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: mockTool.inputSchema,
          },
        },
      ]);
    });

    it('should handle tool calls in response', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Using tool',
              tool_calls: [
                {
                  id: 'call_123',
                  function: {
                    name: 'test_tool',
                    arguments: JSON.stringify({ action: 'test' }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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

    it('should handle system messages correctly', async () => {
      const messages = [
        { role: 'system' as const, content: 'Override system message' },
        { role: 'user' as const, content: 'User message' },
        { role: 'assistant' as const, content: 'Assistant message' },
      ];

      await provider.createResponse(messages, []);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'Override system message' });
      expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'User message' });
      expect(callArgs.messages[2]).toEqual({ role: 'assistant', content: 'Assistant message' });
    });

    it('should handle empty message content', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {},
      });

      const messages = [{ role: 'user' as const, content: 'Test' }];
      const response = await provider.createResponse(messages, []);

      expect(response.content).toBe('');
    });

    it('should throw error if no message in response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{}],
        usage: {},
      });

      const messages = [{ role: 'user' as const, content: 'Test' }];

      await expect(provider.createResponse(messages, [])).rejects.toThrow(
        'No message in OpenAI response'
      );
    });
  });

  describe('streaming responses', () => {
    let mockStream: any;

    beforeEach(() => {
      mockStream = {
        [Symbol.asyncIterator]: vi.fn(),
      };
      mockCreate.mockReturnValue(mockStream);
    });

    it('should create streaming response correctly', async () => {
      const chunks = [
        {
          choices: [
            {
              delta: { content: 'Hello ' },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: { content: 'world!' },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: {},
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
        },
      ];

      mockStream[Symbol.asyncIterator].mockReturnValue(
        {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
          },
        }[Symbol.asyncIterator]()
      );

      const messages = [{ role: 'user' as const, content: 'Stream this' }];
      const response = await provider.createStreamingResponse(messages, [mockTool]);

      expect(response.content).toBe('Hello world!');
      expect(response.toolCalls).toEqual([]);
      expect(response.stopReason).toBe('stop');
      expect(response.usage).toEqual({
        promptTokens: 15,
        completionTokens: 8,
        totalTokens: 23,
      });
    });

    it('should emit token events during streaming', async () => {
      const tokenEvents: string[] = [];
      provider.on('token', ({ token }) => {
        tokenEvents.push(token);
      });

      const chunks = [
        {
          choices: [
            {
              delta: { content: 'Token ' },
            },
          ],
        },
        {
          choices: [
            {
              delta: { content: 'stream ' },
            },
          ],
        },
        {
          choices: [
            {
              delta: { content: 'test' },
              finish_reason: 'stop',
            },
          ],
        },
      ];

      mockStream[Symbol.asyncIterator].mockReturnValue(
        {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
          },
        }[Symbol.asyncIterator]()
      );

      const messages = [{ role: 'user' as const, content: 'Stream tokens' }];
      await provider.createStreamingResponse(messages, []);

      expect(tokenEvents).toEqual(['Token ', 'stream ', 'test']);
    });

    it('should emit complete event when streaming finishes', async () => {
      const completeEvents: any[] = [];
      provider.on('complete', (data) => {
        completeEvents.push(data);
      });

      const chunks = [
        {
          choices: [
            {
              delta: { content: 'Final content' },
              finish_reason: 'stop',
            },
          ],
        },
      ];

      mockStream[Symbol.asyncIterator].mockReturnValue(
        {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
          },
        }[Symbol.asyncIterator]()
      );

      const messages = [{ role: 'user' as const, content: 'Complete test' }];
      await provider.createStreamingResponse(messages, []);

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].response.content).toBe('Final content');
    });

    it('should handle streaming errors', async () => {
      const errorEvents: any[] = [];
      provider.on('error', ({ error }) => {
        errorEvents.push(error);
      });

      const streamError = new Error('Stream failed');
      mockStream[Symbol.asyncIterator].mockReturnValue(
        {
          async *[Symbol.asyncIterator]() {
            // Yield a valid chunk to satisfy ESLint, but immediately throw after
            yield { choices: [{ delta: {} }] };
            throw streamError;
          },
        }[Symbol.asyncIterator]()
      );

      const messages = [{ role: 'user' as const, content: 'Error test' }];

      await expect(provider.createStreamingResponse(messages, [])).rejects.toThrow('Stream failed');

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].message).toBe('Stream failed');
    });

    it('should handle tool calls in streaming response', async () => {
      const chunks = [
        {
          choices: [
            {
              delta: {
                content: 'Using tool via stream',
                tool_calls: [
                  {
                    index: 0,
                    id: 'stream_call_456',
                    function: {
                      name: 'test_tool',
                      arguments: '{"action":',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '"stream_action"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ];

      mockStream[Symbol.asyncIterator].mockReturnValue(
        {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
          },
        }[Symbol.asyncIterator]()
      );

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
      const customProvider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
      });

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Custom model response' },
            finish_reason: 'stop',
          },
        ],
        usage: {},
      });

      await customProvider.createResponse([{ role: 'user', content: 'Test' }], []);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-4o');
    });

    it('should use custom max tokens when provided', async () => {
      const customProvider = new OpenAIProvider({
        apiKey: 'test-key',
        maxTokens: 2000,
      });

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Custom tokens response' },
            finish_reason: 'stop',
          },
        ],
        usage: {},
      });

      await customProvider.createResponse([{ role: 'user', content: 'Test' }], []);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.max_tokens).toBe(2000);
    });

    it('should use fallback system prompt when none provided', async () => {
      const noSystemProvider = new OpenAIProvider({
        apiKey: 'test-key',
      });

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Fallback response' },
            finish_reason: 'stop',
          },
        ],
        usage: {},
      });

      await noSystemProvider.createResponse([{ role: 'user', content: 'Test' }], []);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
    });
  });

  describe('stop reason normalization', () => {
    it('should normalize stop reasons correctly', async () => {
      const testCases = [
        { openai: 'length', expected: 'max_tokens' },
        { openai: 'stop', expected: 'stop' },
        { openai: 'tool_calls', expected: 'tool_use' },
        { openai: 'content_filter', expected: 'stop' },
        { openai: 'unknown_reason', expected: 'stop' },
        { openai: null, expected: undefined },
      ];

      for (const { openai, expected } of testCases) {
        mockCreate.mockResolvedValue({
          choices: [
            {
              message: { content: 'Test' },
              finish_reason: openai,
            },
          ],
          usage: {},
        });

        const response = await provider.createResponse([{ role: 'user', content: 'Test' }], []);
        expect(response.stopReason).toBe(expected);
      }
    });
  });

  describe('error handling', () => {
    it('should handle non-streaming errors', async () => {
      const providerError = new Error('API Error');
      mockCreate.mockRejectedValue(providerError);

      const messages = [{ role: 'user' as const, content: 'Error test' }];

      await expect(provider.createResponse(messages, [])).rejects.toThrow('API Error');
    });

    it('should handle streaming setup errors', async () => {
      const streamError = new Error('Stream setup failed');
      mockCreate.mockImplementation(() => {
        throw streamError;
      });

      const messages = [{ role: 'user' as const, content: 'Stream error test' }];

      await expect(provider.createStreamingResponse(messages, [])).rejects.toThrow(
        'Stream setup failed'
      );
    });
  });
});
