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
