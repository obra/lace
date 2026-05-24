// ABOUTME: Tests for thinking event emission in AnthropicProvider
// ABOUTME: Verifies provider emits thinking_start, thinking_delta, and thinking_end events

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { StreamingEvents } from '../types';
import { anthropicBaseMessagesTrap } from '@lace/agent/test-utils/anthropic-base-namespace-trap';

// Mock external Anthropic SDK
const mockStreamResponse = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      // Throwing trap on base namespace — provider must call beta.messages.*
      messages = anthropicBaseMessagesTrap();
      beta = {
        messages: {
          create: vi.fn(),
          stream: mockStreamResponse,
          countTokens: vi.fn().mockResolvedValue({ input_tokens: 100 }),
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

describe('AnthropicProvider thinking events', () => {
  let provider: AnthropicProvider;

  interface MockStream {
    on: ReturnType<typeof vi.fn>;
    finalMessage: ReturnType<typeof vi.fn>;
  }
  let mockStream: MockStream;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new AnthropicProvider({
      apiKey: 'test-key',
    });
    provider.setSystemPrompt('Test system prompt');

    mockStream = {
      on: vi.fn(),
      finalMessage: vi.fn(),
    };
    mockStreamResponse.mockReturnValue(mockStream);
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  it('should emit thinking events when receiving thinking blocks', async () => {
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

    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'Final response after thinking' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages = [{ role: 'user' as const, content: 'Think about this' }];

    // Start streaming
    const responsePromise = provider.createStreamingResponse(
      messages,
      [],
      'claude-sonnet-4-20250514'
    );

    // Get the streamEvent callback that was registered
    const streamEventCallback = mockStream.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'streamEvent'
    )?.[1] as (event: unknown) => void;

    // Simulate thinking block events
    streamEventCallback({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking' },
    });

    streamEventCallback({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Let me think about this...' },
    });

    streamEventCallback({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: ' I should consider several factors.' },
    });

    streamEventCallback({
      type: 'content_block_stop',
      index: 0,
    });

    await responsePromise;

    expect(thinkingStartEvents).toHaveLength(1);
    expect(thinkingDeltaEvents).toHaveLength(2);
    expect(thinkingDeltaEvents[0].text).toBe('Let me think about this...');
    expect(thinkingDeltaEvents[1].text).toBe(' I should consider several factors.');
    expect(thinkingEndEvents).toHaveLength(1);
    expect(thinkingEndEvents[0].tokens).toBeUndefined();
  });

  it('should not emit thinking events for non-thinking blocks', async () => {
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

    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
      usage: {},
    });

    const messages = [{ role: 'user' as const, content: 'Hello' }];

    // Start streaming
    const responsePromise = provider.createStreamingResponse(
      messages,
      [],
      'claude-sonnet-4-20250514'
    );

    // Get the streamEvent callback
    const streamEventCallback = mockStream.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'streamEvent'
    )?.[1] as (event: unknown) => void;

    // Simulate a text block (not thinking)
    streamEventCallback({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    });

    streamEventCallback({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello!' },
    });

    streamEventCallback({
      type: 'content_block_stop',
      index: 0,
    });

    await responsePromise;

    // No thinking events should have been emitted
    expect(thinkingStartEvents).toHaveLength(0);
    expect(thinkingDeltaEvents).toHaveLength(0);
    expect(thinkingEndEvents).toHaveLength(0);
  });

  it('should handle multiple thinking blocks in sequence', async () => {
    const thinkingStartEvents: StreamingEvents['thinking_start'][] = [];
    const thinkingEndEvents: StreamingEvents['thinking_end'][] = [];

    provider.on('thinking_start', (data: StreamingEvents['thinking_start']) => {
      thinkingStartEvents.push(data);
    });
    provider.on('thinking_end', (data: StreamingEvents['thinking_end']) => {
      thinkingEndEvents.push(data);
    });

    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'Final' }],
      usage: {},
    });

    const messages = [{ role: 'user' as const, content: 'Complex query' }];

    const responsePromise = provider.createStreamingResponse(
      messages,
      [],
      'claude-sonnet-4-20250514'
    );

    const streamEventCallback = mockStream.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'streamEvent'
    )?.[1] as (event: unknown) => void;

    // First thinking block
    streamEventCallback({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking' },
    });
    streamEventCallback({
      type: 'content_block_stop',
      index: 0,
    });

    // Text block in between
    streamEventCallback({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text' },
    });
    streamEventCallback({
      type: 'content_block_stop',
      index: 1,
    });

    // Second thinking block
    streamEventCallback({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'thinking' },
    });
    streamEventCallback({
      type: 'content_block_stop',
      index: 2,
    });

    await responsePromise;

    expect(thinkingStartEvents).toHaveLength(2);
    expect(thinkingEndEvents).toHaveLength(2);
  });
});
