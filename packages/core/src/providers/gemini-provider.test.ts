// ABOUTME: Unit tests for Google Gemini provider implementation
// ABOUTME: Tests configuration, format conversion, responses, streaming, and error handling

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from './gemini-provider';
import { ProviderMessage } from './base-provider';
import { Tool } from '~/tools/tool';

// Mock the Google GenAI SDK
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    },
  })),
}));

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GeminiProvider({ apiKey: 'test-api-key' });
  });

  describe('Configuration', () => {
    it('should require API key for client creation', async () => {
      const provider = new GeminiProvider({ apiKey: null });
      await expect(provider.createResponse([], [], 'test')).rejects.toThrow();
    });

    it('should return provider info', () => {
      const info = provider.getProviderInfo();
      expect(info.name).toBe('gemini');
      expect(info.displayName).toBe('Google Gemini');
      expect(info.requiresApiKey).toBe(true);
    });

    it('should validate configuration', () => {
      expect(provider.isConfigured()).toBe(true);

      // Test isConfigured method by creating a provider with empty key after construction
      const testProvider = new GeminiProvider({ apiKey: 'test' });
      // Modify the config directly to simulate empty key
      const providerWithConfig = testProvider as unknown as { _config: { apiKey: string } };
      providerWithConfig._config.apiKey = '';
      expect(testProvider.isConfigured()).toBe(false);
    });

    it('should support streaming', () => {
      expect(provider.supportsStreaming).toBe(true);
    });

    it('should have correct provider name', () => {
      expect(provider.providerName).toBe('gemini');
    });
  });

  describe('Basic Response Creation', () => {
    it('should handle basic text response', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: { parts: [{ text: 'Hi there!' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          totalTokenCount: 10,
          candidatesTokenCount: 5,
        },
      });

      const response = await provider.createResponse(messages, [], 'gemini-2.5-flash');

      expect(response.content).toBe('Hi there!');
      expect(response.toolCalls).toEqual([]);
      expect(response.stopReason).toBe('stop');
      expect(response.usage?.promptTokens).toBe(5);
      expect(response.usage?.completionTokens).toBe(5);
      expect(response.usage?.totalTokens).toBe(10);
    });

    it('should handle empty response gracefully', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: { parts: [] },
            finishReason: 'STOP',
          },
        ],
      });

      const response = await provider.createResponse(messages, [], 'gemini-2.5-flash');

      expect(response.content).toBe('');
      expect(response.toolCalls).toEqual([]);
    });

    it('should throw error when no candidates', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      mockGenerateContent.mockResolvedValue({
        candidates: [],
      });

      await expect(provider.createResponse(messages, [], 'gemini-2.5-flash')).rejects.toThrow(
        'No candidate in Gemini response'
      );
    });
  });

  describe('Tool Integration', () => {
    const mockTool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
      },
    } as Tool;

    it('should handle tool calls in response', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Use the tool' }];

      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                { text: 'I will use the tool.' },
                {
                  functionCall: {
                    name: 'test_tool',
                    args: { query: 'test query' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokens: 10, totalTokens: 15, candidatesTokens: 5 },
      });

      const response = await provider.createResponse(messages, [mockTool], 'gemini-2.5-flash');

      expect(response.content).toBe('I will use the tool.');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0].name).toBe('test_tool');
      expect(response.toolCalls[0].arguments).toEqual({ query: 'test query' });
      expect(response.toolCalls[0].id).toMatch(/^gemini_/);
    });

    it('should convert tools to Gemini format in request', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Use the tool' }];

      mockGenerateContent.mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'Done' }] }, finishReason: 'STOP' }],
      });

      await provider.createResponse(messages, [mockTool], 'gemini-2.5-flash');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              functionDeclarations: expect.arrayContaining([
                expect.objectContaining({
                  name: 'test_tool',
                  description: 'A test tool',
                  parameters: mockTool.inputSchema,
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });

  describe('Stop Reason Normalization', () => {
    it('should normalize stop reasons correctly', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const testCases = [
        { geminiReason: 'STOP', expected: 'stop' },
        { geminiReason: 'MAX_TOKENS', expected: 'max_tokens' },
        { geminiReason: 'FINISH_REASON_UNSPECIFIED', expected: 'stop' },
        { geminiReason: null, expected: undefined },
        { geminiReason: undefined, expected: undefined },
      ];

      for (const { geminiReason, expected } of testCases) {
        mockGenerateContent.mockResolvedValue({
          candidates: [
            {
              content: { parts: [{ text: 'Response' }] },
              finishReason: geminiReason,
            },
          ],
        });

        const response = await provider.createResponse(messages, [], 'gemini-2.5-flash');
        expect(response.stopReason).toBe(expected);
      }
    });
  });

  describe('Streaming', () => {
    it('should handle streaming response', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // Create a mock async iterable stream
      const mockAsyncIterable = {
        async *[Symbol.asyncIterator]() {
          yield {
            text: 'Streamed ',
            candidates: [{ content: { parts: [{ text: 'Streamed ' }] }, finishReason: null }],
          };
          yield {
            text: 'response',
            candidates: [
              { content: { parts: [{ text: 'Streamed response' }] }, finishReason: 'STOP' },
            ],
            usageMetadata: { promptTokenCount: 5, totalTokenCount: 10, candidatesTokenCount: 5 },
          };
        },
      };

      mockGenerateContentStream.mockResolvedValue(mockAsyncIterable);

      const response = await provider.createStreamingResponse(messages, [], 'gemini-2.5-flash');

      expect(response.content).toBe('Streamed response');
    });

    it('should emit token events during streaming', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // Create a mock async iterable stream
      const mockAsyncIterable = {
        async *[Symbol.asyncIterator]() {
          yield {
            text: 'Hello ',
            candidates: [{ content: { parts: [{ text: 'Hello ' }] }, finishReason: null }],
          };
          yield {
            text: 'world',
            candidates: [{ content: { parts: [{ text: 'Hello world' }] }, finishReason: 'STOP' }],
          };
        },
      };

      mockGenerateContentStream.mockResolvedValue(mockAsyncIterable);

      const tokenEvents: string[] = [];
      provider.on('token', (event) => {
        tokenEvents.push(event.token);
      });

      await provider.createStreamingResponse(messages, [], 'gemini-2.5-flash');

      expect(tokenEvents).toEqual(['Hello ', 'world']);
    });

    it('should emit complete event after streaming', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // Create a mock async iterable stream
      const mockAsyncIterable = {
        async *[Symbol.asyncIterator]() {
          yield {
            text: 'Final response',
            candidates: [
              { content: { parts: [{ text: 'Final response' }] }, finishReason: 'STOP' },
            ],
          };
        },
      };

      mockGenerateContentStream.mockResolvedValue(mockAsyncIterable);

      let completeEvent: unknown = null;
      provider.on('complete', (event) => {
        completeEvent = event;
      });

      await provider.createStreamingResponse(messages, [], 'gemini-2.5-flash');

      expect(completeEvent).toBeTruthy();
      const eventObj = completeEvent as { response: { content: string } };
      expect(eventObj.response.content).toBe('Final response');
    });
  });

  describe('Error Handling', () => {
    it('should handle API authentication errors', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const authError = new Error('Invalid API key');
      const authErrorWithStatus = authError as unknown as Error & { status: number };
      authErrorWithStatus.status = 401;
      mockGenerateContent.mockRejectedValue(authError);

      await expect(provider.createResponse(messages, [], 'gemini-2.5-flash')).rejects.toThrow(
        'Invalid API key'
      );
    });

    it('should handle network errors', async () => {
      // Reduce retry count for fast test execution
      provider.RETRY_CONFIG = {
        maxRetries: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
        backoffFactor: 1,
        jitterFactor: 0,
      };

      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const networkError = new Error('Network error');
      const networkErrorWithCode = networkError as unknown as Error & { code: string };
      networkErrorWithCode.code = 'ECONNREFUSED';
      mockGenerateContent.mockRejectedValue(networkError);

      await expect(provider.createResponse(messages, [], 'gemini-2.5-flash')).rejects.toThrow(
        'Network error'
      );
    });
  });

  describe('Message Format Conversion', () => {
    it('should handle system messages', async () => {
      const messages: ProviderMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ];

      mockGenerateContent.mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'Hi!' }] }, finishReason: 'STOP' }],
      });

      await provider.createResponse(messages, [], 'gemini-2.5-flash');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: 'You are a helpful assistant',
          contents: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              parts: [{ text: 'Hello' }],
            }),
          ]),
        })
      );
    });

    it('should handle tool results in user messages', async () => {
      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'tool-123',
              content: [{ type: 'text', text: 'Tool result' }],
              status: 'completed',
            },
          ],
        },
      ];

      mockGenerateContent.mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'Got it' }] }, finishReason: 'STOP' }],
      });

      await provider.createResponse(messages, [], 'gemini-2.5-flash');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              parts: expect.arrayContaining([
                expect.objectContaining({
                  functionResponse: expect.objectContaining({
                    response: expect.objectContaining({
                      output: 'Tool result',
                    }),
                  }),
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });
});
