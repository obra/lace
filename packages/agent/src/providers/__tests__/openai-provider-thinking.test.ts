// ABOUTME: Tests for thinking event emission in OpenAIProvider
// ABOUTME: Verifies provider emits thinking_start, thinking_delta, and thinking_end events for o1/o3 models

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai-provider';
import { StreamingEvents } from '../types';

// Mock the OpenAI SDK
const mockResponsesCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      responses = {
        create: mockResponsesCreate,
      };
      chat = {
        completions: {
          create: vi.fn(),
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

describe('OpenAIProvider thinking events', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new OpenAIProvider({
      apiKey: 'test-key',
    });
    provider.setSystemPrompt('Test system prompt');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('non-streaming responses', () => {
    it('should emit thinking events when response contains reasoning items', async () => {
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

      // Mock a response with reasoning content (o1/o3 model response format)
      mockResponsesCreate.mockResolvedValue({
        id: 'resp_123',
        status: 'completed',
        output: [
          {
            type: 'reasoning',
            id: 'reasoning_1',
            summary: [
              { text: 'Let me think about this problem...' },
              { text: 'I should consider multiple approaches.' },
            ],
          },
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Here is my answer.' }],
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
          output_tokens_details: {
            reasoning_tokens: 25,
          },
        },
      });

      const messages = [{ role: 'user' as const, content: 'Think about this' }];

      await provider.createResponse(messages, [], 'o1');

      expect(thinkingStartEvents).toHaveLength(1);
      expect(thinkingDeltaEvents).toHaveLength(2);
      expect(thinkingDeltaEvents[0].text).toBe('Let me think about this problem...');
      expect(thinkingDeltaEvents[1].text).toBe('I should consider multiple approaches.');
      expect(thinkingEndEvents).toHaveLength(1);
      expect(thinkingEndEvents[0].tokens).toBe(25);
    });

    it('should not emit thinking events for responses without reasoning items', async () => {
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

      // Mock a regular response without reasoning
      mockResponsesCreate.mockResolvedValue({
        id: 'resp_123',
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Hello!' }],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await provider.createResponse(messages, [], 'gpt-4o');

      expect(thinkingStartEvents).toHaveLength(0);
      expect(thinkingDeltaEvents).toHaveLength(0);
      expect(thinkingEndEvents).toHaveLength(0);
    });
  });

  describe('system prompt handling (Responses API path)', () => {
    it('uses _systemPrompt (set via setSystemPrompt) and ignores role:system messages in input (PRI-1804 invariant)', async () => {
      // The system prompt is set once at session start via setSystemPrompt() (done in
      // beforeEach). role:system messages in the input are ignored — the invariant
      // ensures the system prompt is byte-stable for the session, keeping the
      // system+tools cache prefix reusable across requests.
      mockResponsesCreate.mockResolvedValue({
        id: 'resp_123',
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Hello!' }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });

      await provider.createResponse(
        [
          { role: 'system', content: 'This must be ignored.' },
          { role: 'system', content: 'This too.' },
          { role: 'user', content: 'Hello' },
        ],
        [],
        'gpt-4o'
      );

      expect(mockResponsesCreate).toHaveBeenCalled();
      const callArgs = mockResponsesCreate.mock.calls[0][0] as {
        instructions?: string;
      };
      // instructions comes from setSystemPrompt(), not from role:system messages
      expect(callArgs.instructions).toBe('Test system prompt');
    });
  });

  describe('streaming responses', () => {
    it('should emit thinking events when stream contains reasoning events', async () => {
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

      // Create an async iterator that yields streaming events
      const streamEvents = [
        // Reasoning item added
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'reasoning', id: 'reasoning_1' },
        },
        // Reasoning summary deltas
        {
          type: 'response.reasoning_summary.delta',
          item_id: 'reasoning_1',
          delta: 'Let me think...',
        },
        {
          type: 'response.reasoning_summary.delta',
          item_id: 'reasoning_1',
          delta: ' about this problem.',
        },
        // Reasoning summary done
        {
          type: 'response.reasoning_summary.done',
          item_id: 'reasoning_1',
          text: 'Let me think... about this problem.',
        },
        // Text output
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: { type: 'message', id: 'msg_1' },
        },
        {
          type: 'response.output_text.delta',
          delta: 'Here is my answer.',
        },
        // Completion
        {
          type: 'response.completed',
          response: {
            id: 'resp_123',
            status: 'completed',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
              output_tokens_details: {
                reasoning_tokens: 30,
              },
            },
          },
        },
      ];

      // Mock the streaming response as an async iterable
      mockResponsesCreate.mockImplementation(() => {
        return (async function* () {
          for (const event of streamEvents) {
            yield event;
          }
        })();
      });

      const messages = [{ role: 'user' as const, content: 'Think about this' }];

      await provider.createStreamingResponse(messages, [], 'o1');

      expect(thinkingStartEvents).toHaveLength(1);
      expect(thinkingDeltaEvents).toHaveLength(2);
      expect(thinkingDeltaEvents[0].text).toBe('Let me think...');
      expect(thinkingDeltaEvents[1].text).toBe(' about this problem.');
      expect(thinkingEndEvents).toHaveLength(1);
      expect(thinkingEndEvents[0].tokens).toBe(30);
    });

    it('should not emit thinking events for streams without reasoning', async () => {
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

      // Create a stream without reasoning events
      const streamEvents = [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'msg_1' },
        },
        {
          type: 'response.output_text.delta',
          delta: 'Hello!',
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_123',
            status: 'completed',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
            },
          },
        },
      ];

      mockResponsesCreate.mockImplementation(() => {
        return (async function* () {
          for (const event of streamEvents) {
            yield event;
          }
        })();
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await provider.createStreamingResponse(messages, [], 'gpt-4o');

      expect(thinkingStartEvents).toHaveLength(0);
      expect(thinkingDeltaEvents).toHaveLength(0);
      expect(thinkingEndEvents).toHaveLength(0);
    });

    it('should handle multiple reasoning blocks', async () => {
      const thinkingStartEvents: StreamingEvents['thinking_start'][] = [];
      const thinkingEndEvents: StreamingEvents['thinking_end'][] = [];

      provider.on('thinking_start', (data: StreamingEvents['thinking_start']) => {
        thinkingStartEvents.push(data);
      });
      provider.on('thinking_end', (data: StreamingEvents['thinking_end']) => {
        thinkingEndEvents.push(data);
      });

      // Two reasoning blocks in one response
      const streamEvents = [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'reasoning', id: 'reasoning_1' },
        },
        {
          type: 'response.reasoning_summary.delta',
          item_id: 'reasoning_1',
          delta: 'First thought.',
        },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: { type: 'reasoning', id: 'reasoning_2' },
        },
        {
          type: 'response.reasoning_summary.delta',
          item_id: 'reasoning_2',
          delta: 'Second thought.',
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_123',
            status: 'completed',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
              output_tokens_details: {
                reasoning_tokens: 40,
              },
            },
          },
        },
      ];

      mockResponsesCreate.mockImplementation(() => {
        return (async function* () {
          for (const event of streamEvents) {
            yield event;
          }
        })();
      });

      const messages = [{ role: 'user' as const, content: 'Complex query' }];

      await provider.createStreamingResponse(messages, [], 'o3');

      // Each reasoning block triggers a thinking_start
      expect(thinkingStartEvents).toHaveLength(2);
      // Only one thinking_end at completion
      expect(thinkingEndEvents).toHaveLength(1);
      expect(thinkingEndEvents[0].tokens).toBe(40);
    });
  });
});
