// ABOUTME: MSW handlers for mocking external API responses during E2E tests
// ABOUTME: Only mocks external services, never our own application logic

import { http, HttpResponse } from 'msw';

// Mock successful Anthropic API response
const anthropicSuccessHandler = http.post(
  'https://api.anthropic.com/v1/messages',
  async ({ request }) => {
    const body = (await request.json()) as unknown;

    // Type guard for request body
    if (!isAnthropicRequest(body)) {
      return HttpResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    return HttpResponse.json({
      id: 'msg_test123',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Hello! This is a test response from the mocked Anthropic API.',
        },
      ],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 15,
      },
    });
  }
);

// Mock OpenAI API response (if needed)
const openaiSuccessHandler = http.post('https://api.openai.com/v1/chat/completions', async () => {
  return HttpResponse.json({
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-3.5-turbo',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello! This is a test response from the mocked OpenAI API.',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 15,
      total_tokens: 25,
    },
  });
});

// Streaming response handler for testing real-time token streaming
const anthropicStreamingHandler = http.post(
  'https://api.anthropic.com/v1/messages',
  async ({ request }) => {
    const body = (await request.json()) as unknown;

    if (!isAnthropicRequest(body)) {
      return HttpResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Create a streaming response that sends tokens progressively
    const responseText =
      'This is a streaming response that demonstrates real-time token generation for comprehensive testing of the SSE event system.';
    const tokens = responseText.split(' ');

    const stream = new ReadableStream({
      async start(controller) {
        // Send initial message structure
        const baseMessage = {
          id: 'msg_streaming_comprehensive',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-haiku-20240307',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 25, output_tokens: 0 },
        };

        controller.enqueue(
          `data: ${JSON.stringify({
            ...baseMessage,
            content: [{ type: 'text', text: '' }],
          })}\n\n`
        );

        // Stream tokens with realistic delays
        let accumulatedText = '';
        for (let i = 0; i < tokens.length; i++) {
          await new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 40)); // 80-120ms delays

          accumulatedText += (i > 0 ? ' ' : '') + tokens[i];

          const tokenMessage = {
            ...baseMessage,
            content: [{ type: 'text', text: accumulatedText }],
            usage: { input_tokens: 25, output_tokens: i + 1 },
          };

          controller.enqueue(`data: ${JSON.stringify(tokenMessage)}\n\n`);
        }

        // Send completion message
        const finalMessage = {
          ...baseMessage,
          content: [{ type: 'text', text: responseText }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 25, output_tokens: tokens.length },
        };

        controller.enqueue(`data: ${JSON.stringify(finalMessage)}\n\n`);
        controller.close();
      },
    });

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }
);

// Error handler for testing error recovery
const anthropicErrorHandler = http.post('https://api.anthropic.com/v1/messages', () => {
  return HttpResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
});

// Slow response handler for testing timeout behavior
const anthropicSlowHandler = http.post(
  'https://api.anthropic.com/v1/messages',
  async ({ request }) => {
    const body = (await request.json()) as unknown;

    if (!isAnthropicRequest(body)) {
      return HttpResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Simulate slow response
    await new Promise((resolve) => setTimeout(resolve, 5000));

    return HttpResponse.json({
      id: 'msg_slow_response',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'This is a slow response for testing timeout handling.' }],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      usage: { input_tokens: 15, output_tokens: 12 },
    });
  }
);

// Tool-triggering response handler
const anthropicToolTriggerHandler = http.post(
  'https://api.anthropic.com/v1/messages',
  async ({ request }) => {
    const body = (await request.json()) as unknown;

    if (!isAnthropicRequest(body)) {
      return HttpResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Check if request mentions files or tools
    const requestText = JSON.stringify(body).toLowerCase();
    if (
      requestText.includes('file') ||
      requestText.includes('read') ||
      requestText.includes('tool')
    ) {
      return HttpResponse.json({
        id: 'msg_tool_trigger',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_call_123',
            name: 'file_read',
            input: { path: '/example/file.txt' },
          },
        ],
        model: 'claude-3-haiku-20240307',
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 15 },
      });
    }

    return HttpResponse.json({
      id: 'msg_no_tools_needed',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'I can help you with that without needing any tools.' }],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      usage: { input_tokens: 18, output_tokens: 14 },
    });
  }
);

// Default handlers for successful responses
export const handlers = [anthropicSuccessHandler, openaiSuccessHandler];

// Export additional handlers for specific test scenarios
export const streamingHandlers = {
  streaming: anthropicStreamingHandler,
  error: anthropicErrorHandler,
  slow: anthropicSlowHandler,
  toolTrigger: anthropicToolTriggerHandler,
  success: anthropicSuccessHandler,
};

// Type for Anthropic content blocks
type ContentBlock = {
  type: string;
  text: string;
};

// Type guard for Anthropic request body - supports both string content and content blocks
function isAnthropicRequest(body: unknown): body is {
  model: string;
  messages: Array<{ role: string; content: string | ContentBlock[] }>;
} {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('model' in body) ||
    !('messages' in body) ||
    typeof (body as { model: unknown }).model !== 'string' ||
    !Array.isArray((body as { messages: unknown }).messages)
  ) {
    return false;
  }

  const messages = (body as { messages: unknown[] }).messages;

  // Validate each message has role and content (string or content blocks)
  return messages.every(
    (msg) =>
      typeof msg === 'object' &&
      msg !== null &&
      'role' in msg &&
      'content' in msg &&
      typeof (msg as { role: unknown }).role === 'string' &&
      // Content is string
      (typeof (msg as { content: unknown }).content === 'string' ||
        // Content is array of content blocks
        (Array.isArray((msg as { content: unknown }).content) &&
          ((msg as { content: unknown[] }).content as unknown[]).every(
            (block) =>
              typeof block === 'object' &&
              block !== null &&
              'type' in block &&
              'text' in block &&
              typeof (block as { type: unknown }).type === 'string' &&
              typeof (block as { text: unknown }).text === 'string'
          )))
  );
}
