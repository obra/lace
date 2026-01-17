// ABOUTME: Tests for thinking event emission in GeminiProvider
// ABOUTME: Verifies provider emits thinking_start, thinking_delta, and thinking_end events

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../gemini-provider';
import { StreamingEvents } from '../types';

// Mock the Google GenAI SDK
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
      };
    },
  };
});

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock provider logging
vi.mock('../../utils/provider-logging.js', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

describe('GeminiProvider thinking events', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new GeminiProvider({
      apiKey: 'test-key',
    });
    provider.setSystemPrompt('Test system prompt');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('non-streaming responses', () => {
    it('should emit thinking events when response contains thought content', async () => {
      const thinkingStartEvents: StreamingEvents['thinking_start'][] = [];
      const thinkingDeltaEvents: StreamingEvents['thinking_delta'][] = [];
      const thinkingEndEvents: StreamingEvents['thinking_end'][] = [];

      provider.on('thinking_start', (data: StreamingEvents['thinking_start']) => {
        thinkingStartEvents.push(data);
      });
      provider.on('thinking_delta', (data: StreamingEvents['thinking_delta']) => {
        thinkingDeltaEvents.push(data);
      });
      provider.on('thinking_end', (data: StreamingEvents['thinking_end']) => {
        thinkingEndEvents.push(data);
      });

      // Mock a response with thought content
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                { thought: 'Let me think about this problem...' },
                { text: 'Here is my answer.' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      });

      const messages = [{ role: 'user' as const, content: 'Think about this' }];

      await provider.createResponse(messages, [], 'gemini-2.0-flash-thinking-exp');

      expect(thinkingStartEvents).toHaveLength(1);
      expect(thinkingDeltaEvents).toHaveLength(1);
      expect(thinkingDeltaEvents[0].text).toBe('Let me think about this problem...');
      expect(thinkingEndEvents).toHaveLength(1);
      expect(thinkingEndEvents[0].tokens).toBe(0); // Gemini doesn't provide thinking token count
    });

    it('should not emit thinking events for responses without thought content', async () => {
      const thinkingStartEvents: StreamingEvents['thinking_start'][] = [];
      const thinkingDeltaEvents: StreamingEvents['thinking_delta'][] = [];
      const thinkingEndEvents: StreamingEvents['thinking_end'][] = [];

      provider.on('thinking_start', (data: StreamingEvents['thinking_start']) => {
        thinkingStartEvents.push(data);
      });
      provider.on('thinking_delta', (data: StreamingEvents['thinking_delta']) => {
        thinkingDeltaEvents.push(data);
      });
      provider.on('thinking_end', (data: StreamingEvents['thinking_end']) => {
        thinkingEndEvents.push(data);
      });

      // Mock a regular response without thought content
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello!' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await provider.createResponse(messages, [], 'gemini-2.0-flash');

      expect(thinkingStartEvents).toHaveLength(0);
      expect(thinkingDeltaEvents).toHaveLength(0);
      expect(thinkingEndEvents).toHaveLength(0);
    });

    it('should handle multiple thought parts in response', async () => {
      const thinkingStartEvents: StreamingEvents['thinking_start'][] = [];
      const thinkingDeltaEvents: StreamingEvents['thinking_delta'][] = [];
      const thinkingEndEvents: StreamingEvents['thinking_end'][] = [];

      provider.on('thinking_start', (data: StreamingEvents['thinking_start']) => {
        thinkingStartEvents.push(data);
      });
      provider.on('thinking_delta', (data: StreamingEvents['thinking_delta']) => {
        thinkingDeltaEvents.push(data);
      });
      provider.on('thinking_end', (data: StreamingEvents['thinking_end']) => {
        thinkingEndEvents.push(data);
      });

      // Mock a response with multiple thought parts
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                { thought: 'First, let me consider the options...' },
                { thought: 'Now let me evaluate each one...' },
                { text: 'Based on my analysis, here is the answer.' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 80,
          totalTokenCount: 180,
        },
      });

      const messages = [{ role: 'user' as const, content: 'Complex question' }];

      await provider.createResponse(messages, [], 'gemini-2.0-flash-thinking-exp');

      // Each thought part emits its own set of events
      expect(thinkingStartEvents).toHaveLength(2);
      expect(thinkingDeltaEvents).toHaveLength(2);
      expect(thinkingDeltaEvents[0].text).toBe('First, let me consider the options...');
      expect(thinkingDeltaEvents[1].text).toBe('Now let me evaluate each one...');
      expect(thinkingEndEvents).toHaveLength(2);
    });
  });

  describe('streaming responses', () => {
    it('should emit thinking events when stream contains thought content', async () => {
      const thinkingStartEvents: StreamingEvents['thinking_start'][] = [];
      const thinkingDeltaEvents: StreamingEvents['thinking_delta'][] = [];
      const thinkingEndEvents: StreamingEvents['thinking_end'][] = [];

      provider.on('thinking_start', (data: StreamingEvents['thinking_start']) => {
        thinkingStartEvents.push(data);
      });
      provider.on('thinking_delta', (data: StreamingEvents['thinking_delta']) => {
        thinkingDeltaEvents.push(data);
      });
      provider.on('thinking_end', (data: StreamingEvents['thinking_end']) => {
        thinkingEndEvents.push(data);
      });

      // Create chunks with thought content
      const chunks = [
        {
          candidates: [
            {
              content: {
                parts: [{ thought: 'Let me think...' }],
              },
            },
          ],
        },
        {
          text: 'Here is my answer.',
          candidates: [
            {
              content: {
                parts: [{ text: 'Here is my answer.' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 150,
          },
        },
      ];

      // Mock streaming response as async iterable
      mockGenerateContentStream.mockResolvedValue(
        (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })()
      );

      const messages = [{ role: 'user' as const, content: 'Think about this' }];

      await provider.createStreamingResponse(messages, [], 'gemini-2.0-flash-thinking-exp');

      expect(thinkingStartEvents).toHaveLength(1);
      expect(thinkingDeltaEvents).toHaveLength(1);
      expect(thinkingDeltaEvents[0].text).toBe('Let me think...');
      expect(thinkingEndEvents).toHaveLength(1);
      expect(thinkingEndEvents[0].tokens).toBe(0);
    });

    it('should not emit thinking events for streams without thought content', async () => {
      const thinkingStartEvents: StreamingEvents['thinking_start'][] = [];
      const thinkingDeltaEvents: StreamingEvents['thinking_delta'][] = [];
      const thinkingEndEvents: StreamingEvents['thinking_end'][] = [];

      provider.on('thinking_start', (data: StreamingEvents['thinking_start']) => {
        thinkingStartEvents.push(data);
      });
      provider.on('thinking_delta', (data: StreamingEvents['thinking_delta']) => {
        thinkingDeltaEvents.push(data);
      });
      provider.on('thinking_end', (data: StreamingEvents['thinking_end']) => {
        thinkingEndEvents.push(data);
      });

      // Create chunks without thought content
      const chunks = [
        {
          text: 'Hello!',
          candidates: [
            {
              content: {
                parts: [{ text: 'Hello!' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        },
      ];

      mockGenerateContentStream.mockResolvedValue(
        (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })()
      );

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await provider.createStreamingResponse(messages, [], 'gemini-2.0-flash');

      expect(thinkingStartEvents).toHaveLength(0);
      expect(thinkingDeltaEvents).toHaveLength(0);
      expect(thinkingEndEvents).toHaveLength(0);
    });

    it('should handle multiple thought chunks in stream', async () => {
      const thinkingStartEvents: StreamingEvents['thinking_start'][] = [];
      const thinkingDeltaEvents: StreamingEvents['thinking_delta'][] = [];
      const thinkingEndEvents: StreamingEvents['thinking_end'][] = [];

      provider.on('thinking_start', (data: StreamingEvents['thinking_start']) => {
        thinkingStartEvents.push(data);
      });
      provider.on('thinking_delta', (data: StreamingEvents['thinking_delta']) => {
        thinkingDeltaEvents.push(data);
      });
      provider.on('thinking_end', (data: StreamingEvents['thinking_end']) => {
        thinkingEndEvents.push(data);
      });

      // Create multiple thought chunks
      const chunks = [
        {
          candidates: [
            {
              content: {
                parts: [{ thought: 'First thought...' }],
              },
            },
          ],
        },
        {
          candidates: [
            {
              content: {
                parts: [{ thought: 'Second thought...' }],
              },
            },
          ],
        },
        {
          text: 'Final answer.',
          candidates: [
            {
              content: {
                parts: [{ text: 'Final answer.' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 70,
            totalTokenCount: 170,
          },
        },
      ];

      mockGenerateContentStream.mockResolvedValue(
        (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })()
      );

      const messages = [{ role: 'user' as const, content: 'Complex query' }];

      await provider.createStreamingResponse(messages, [], 'gemini-2.0-flash-thinking-exp');

      // Each thought chunk triggers thinking events
      expect(thinkingStartEvents).toHaveLength(2);
      expect(thinkingDeltaEvents).toHaveLength(2);
      expect(thinkingDeltaEvents[0].text).toBe('First thought...');
      expect(thinkingDeltaEvents[1].text).toBe('Second thought...');
      expect(thinkingEndEvents).toHaveLength(2);
    });
  });
});
