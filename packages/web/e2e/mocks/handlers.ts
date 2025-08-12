// ABOUTME: MSW handlers for mocking external API responses during E2E tests
// ABOUTME: Only mocks external services, never our own application logic

import { http, HttpResponse } from 'msw';

// Mock successful Anthropic API response
export const anthropicSuccessHandler = http.post(
  'https://api.anthropic.com/v1/messages',
  async ({ request }) => {
    const body = await request.json() as unknown;
    
    // Type guard for request body
    if (!isAnthropicRequest(body)) {
      return HttpResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    return HttpResponse.json({
      id: 'msg_test123',
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'Hello! This is a test response from the mocked Anthropic API.'
      }],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 15
      }
    });
  }
);

// Mock OpenAI API response (if needed)
export const openaiSuccessHandler = http.post(
  'https://api.openai.com/v1/chat/completions',
  async () => {
    return HttpResponse.json({
      id: 'chatcmpl-test123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-3.5-turbo',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello! This is a test response from the mocked OpenAI API.'
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25
      }
    });
  }
);

// Default handlers for successful responses
export const handlers = [
  anthropicSuccessHandler,
  openaiSuccessHandler,
];

// Type guard for Anthropic request body
function isAnthropicRequest(body: unknown): body is { 
  model: string; 
  messages: Array<{ role: string; content: string }>; 
} {
  return (
    typeof body === 'object' &&
    body !== null &&
    'model' in body &&
    'messages' in body &&
    typeof (body as { model: unknown }).model === 'string' &&
    Array.isArray((body as { messages: unknown }).messages)
  );
}