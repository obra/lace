// ABOUTME: MSW HTTP handlers for mocking Anthropic API in E2E tests
// ABOUTME: Provides predictable AI responses by intercepting HTTP requests to api.anthropic.com

import { setupServer, type SetupServer } from 'msw/node';
import { http } from 'msw';

// Type the global MSW server reference
declare global {
  var __MSW_SERVER__: SetupServer | undefined;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  messages: AnthropicMessage[];
  model: string;
  stream?: boolean;
}

/**
 * Mock the Anthropic API HTTP endpoints for E2E tests
 * This intercepts actual HTTP requests to api.anthropic.com
 */
export function mockAnthropicForE2E(): void {
  const handlers = [
    // Handle Anthropic API requests
    http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
      // Parse the request to determine which response to send
      const body = await request.text();
      const requestData = JSON.parse(body) as AnthropicRequest;

      // Route helper agents to different responses based on model
      if (requestData.model === 'claude-3-haiku-20240307') {
        // Helper agent requests - return simple, non-interfering responses
        return new Response(
          JSON.stringify({
            id: 'msg_helper_response',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Helper: Brief summary completed.' }],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 5 },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Main test agent requests - use detailed test responses
      // Get the LAST user message from conversation history (not the first)
      const userMessages = requestData.messages?.filter((m) => m.role === 'user') || [];
      const userMessage = userMessages[userMessages.length - 1]?.content || '';

      // Determine response based on user message content
      let responseText = "I'm a helpful AI assistant. How can I help you today?";

      if (typeof userMessage === 'string') {
        if (userMessage.includes('test message from Test 1')) {
          responseText =
            'I see you sent a test message from Test 1. This is my response as Claude!';
        } else if (userMessage.includes('test message from Test 2')) {
          responseText = "Hello from Test 2! I'm responding to your different message.";
        } else if (userMessage.includes('Hello there!')) {
          responseText =
            "Hello! I'm Claude, streaming my response token by token. You can see each word appear as I generate it.";
        } else if (userMessage.includes('follow-up message to test conversation flow')) {
          responseText =
            'This is my follow-up response. Notice how each message gets its own streaming animation.';
        } else if (userMessage.includes('slow response')) {
          responseText =
            'This is a very long response that streams slowly so we can test the stop functionality by interrupting the generation process.';
        } else if (userMessage.includes('Please tell me a story')) {
          responseText =
            'This is a streaming response that demonstrates real-time token generation';
        } else if (userMessage.includes('First message to build conversation length')) {
          responseText =
            'I understand you are building conversation length. This response contains multiple tokens for compaction testing.';
        } else if (userMessage.includes('Second message continues the conversation')) {
          responseText =
            'Continuing the conversation with additional content that may trigger compaction events when the context grows.';
        } else if (userMessage.includes('Third message may trigger auto-compaction')) {
          responseText =
            'This third message response adds even more content to potentially trigger automatic conversation compaction.';
        } else if (userMessage.includes('/compact')) {
          responseText =
            'Manual compaction command received. Processing conversation compaction with progress indicators.';
        } else if (userMessage.includes('Test message for SSE events')) {
          responseText =
            'Response for SSE event testing with multiple event types including AGENT_TOKEN and routing verification.';
        } else if (userMessage.includes('Can you read a file for me?')) {
          responseText =
            'File reading request generates TOOL_CALL and TOOL_RESULT events along with AGENT_MESSAGE events for comprehensive testing.';
        } else if (userMessage.includes('Help me understand the project structure')) {
          responseText =
            'Project structure analysis involves multiple SSE event types and demonstrates complex event filtering and routing capabilities.';
        } else if (userMessage.includes('First concurrent message')) {
          responseText =
            'Processing first concurrent message with streaming reliability testing and concurrent operation handling.';
        } else if (userMessage.includes('Second concurrent message')) {
          responseText =
            'Second concurrent message response tests event stream reliability during multiple simultaneous operations.';
        } else if (userMessage.includes('Third concurrent message')) {
          responseText =
            'Third message in concurrent sequence verifies stream maintains reliability under stress conditions.';
        } else if (userMessage.includes('Fourth stress test message')) {
          responseText =
            'Fourth stress test response demonstrates robust streaming performance under rapid-fire operations.';
        } else if (userMessage.includes('Final reliability check message')) {
          responseText =
            'Final reliability check confirms streaming event delivery remains consistent throughout concurrent operations.';
        } else if (userMessage.includes('This message tests error handling')) {
          responseText =
            'Error handling test response with streaming events and recovery gracefully from any interruptions.';
        } else if (userMessage.includes('This message should work after recovery')) {
          responseText =
            'Recovery test successful - streaming functionality restored and working normally after error conditions.';
        }
      }

      // Split response into tokens for streaming
      const tokens = responseText.split(' ');

      const events = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test_e2e","type":"message","role":"assistant","content":[],"model":"claude-3-haiku-20240307","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":15,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      ];

      // Add token events
      tokens.forEach((token, i) => {
        const text = i === 0 ? token : ' ' + token;
        events.push(
          `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${text}"}}\n\n`
        );
      });

      // Add closing events
      events.push(
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":${tokens.length}}}\n\n`,
        'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      );

      return new Response(
        new ReadableStream({
          start(controller) {
            let i = 0;
            const sendEvent = () => {
              if (i < events.length) {
                controller.enqueue(new TextEncoder().encode(events[i]));
                i++;
                setTimeout(sendEvent, 50); // Small delay between events
              } else {
                controller.close();
              }
            };

            sendEvent();
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }
      );
    }),
  ];

  // Start MSW server
  const server = setupServer(...handlers);
  server.listen({ onUnhandledRequest: 'bypass' });

  // Anthropic API HTTP endpoints mocked for E2E tests

  // Store server reference for cleanup
  globalThis.__MSW_SERVER__ = server;
}
