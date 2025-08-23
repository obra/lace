// ABOUTME: MSW utilities for creating streaming response mocks in tests
// ABOUTME: Provides helpers for Anthropic SSE streaming and other provider response patterns

/**
 * Creates a proper Anthropic SSE streaming response for MSW mocking.
 * This helper formats events as server-sent events with proper event types and data fields.
 *
 * @param events - Array of events to stream (each event should have a 'type' property)
 * @returns Response object with streaming SSE format
 */
export function createAnthropicStreamResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send each event as proper SSE with event type and data
      for (const event of events) {
        // Anthropic SDK expects events with event: and data: fields
        if ((event as { type?: string }).type) {
          controller.enqueue(encoder.encode(`event: ${(event as { type: string }).type}\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      // Send final event
      controller.enqueue(encoder.encode('event: done\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

/**
 * Creates a mock Anthropic SDK stream object with proper finalMessage support.
 * This works around MSW limitations by providing the finalMessage method that
 * the real Anthropic provider expects when using streaming responses.
 *
 * @param events - Array of streaming events
 * @returns Mock stream object compatible with Anthropic SDK
 */
export function createMockAnthropicStream(events: unknown[]) {
  // Extract final message data from streaming events
  const messageStart = events.find((e) => (e as { type?: string }).type === 'message_start') as {
    message?: {
      id?: string;
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
  };

  const messageDelta = events.find((e) => (e as { type?: string }).type === 'message_delta') as {
    delta?: { stop_reason?: string; stop_sequence?: string };
    usage?: { output_tokens?: number };
  };

  const contentDeltas = events.filter(
    (e) => (e as { type?: string }).type === 'content_block_delta'
  ) as Array<{
    delta?: { text?: string };
  }>;

  // Aggregate content and token usage
  const content = contentDeltas.map((e) => e.delta?.text || '').join('');
  const inputTokens = messageStart?.message?.usage?.input_tokens || 0;
  const outputTokens = messageDelta?.usage?.output_tokens || 0;

  // Create final message that matches Anthropic SDK format
  const finalMessage = {
    id: messageStart?.message?.id || 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: messageStart?.message?.model || 'claude-3-5-sonnet-20241022',
    stop_reason: messageDelta?.delta?.stop_reason || 'end_turn',
    stop_sequence: messageDelta?.delta?.stop_sequence || null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };

  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const mockStream = {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(listener);
    },
    emit: (event: string, ...args: unknown[]) => {
      if (listeners[event]) {
        listeners[event].forEach((listener) => listener(...args));
      }
    },
    finalMessage: () => Promise.resolve(finalMessage),
  };

  // Simulate streaming events
  setTimeout(() => {
    const contentText = contentDeltas.map((e) => e.delta?.text || '').join('');
    if (contentText) {
      mockStream.emit('text', contentText);
    }
    mockStream.emit('end');
  }, 10);

  return mockStream;
}

/**
 * Creates common Anthropic streaming event sequences for testing.
 * These are standard event patterns that appear in multiple test files.
 */
export const anthropicStreamingEventPatterns = {
  /**
   * Simple text response streaming pattern
   */
  simpleTextResponse: (content: string) => [
    {
      type: 'message_start',
      message: {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-3-sonnet-20240229',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: content },
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: Math.ceil(content.length / 4) },
    },
    {
      type: 'message_stop',
    },
  ],

  /**
   * Streaming response with token usage updates
   */
  responseWithTokenUsage: (content: string, inputTokens: number, outputTokens: number) => [
    {
      type: 'message_start',
      message: {
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-3-sonnet-20240229',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: content },
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    },
    {
      type: 'message_stop',
    },
  ],
};
