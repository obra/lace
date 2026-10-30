// ABOUTME: Keeps request-only context/options intact through supported streaming verification fallback.
// ABOUTME: Uses real OpenAI SDK serialization with synthetic fetch replies only.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../openai-provider';
import type { ProviderMessage, WireTool } from '../base-provider';

interface WireBody {
  stream: boolean;
  store?: boolean;
  previous_response_id?: string;
  tool_choice?: string;
  messages?: unknown[];
  input?: unknown[];
}

const history: ProviderMessage[] = [
  { role: 'user', content: 'Required question.' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'call_lookup', name: 'lookup', arguments: {} }],
  },
  {
    role: 'user',
    content: 'Required followup.',
    toolResults: [
      {
        id: 'call_lookup',
        status: 'completed',
        content: [{ type: 'text', text: 'Required result.' }],
      },
    ],
  },
];
const tools: WireTool[] = [
  { name: 'lookup', description: 'Lookup', inputSchema: { type: 'object' } },
];
const temporaryText = 'Current request-only context.';
const responseTail = [
  { type: 'function_call_output', call_id: 'call_lookup', output: 'Required result.' },
  { role: 'user', content: 'Required followup.' },
];
const responseHistory = [
  { role: 'user', content: 'Required question.' },
  { type: 'function_call', call_id: 'call_lookup', name: 'lookup', arguments: '{}' },
  ...responseTail,
];

function verificationError(): Response {
  return Response.json(
    {
      error: {
        type: 'invalid_request_error',
        code: 'unsupported_value',
        param: 'stream',
        message: 'Streaming requires organization verification.',
      },
    },
    { status: 400 }
  );
}

function acceptedResponse(route: 'responses' | 'chat'): Response {
  return Response.json(
    route === 'responses'
      ? {
          id: 'resp_fallback',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'OK', annotations: [] }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
        }
      : {
          id: 'chat_fallback',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        }
  );
}

describe('OpenAI streaming verification fallback preserves request context', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([temporaryText, null, undefined])(
    'preserves Responses mode with context=%s',
    async (temporaryContext) => {
      const captures: WireBody[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(new URL(request.url).pathname).toBe('/v1/responses');
        const body = JSON.parse(await request.text()) as WireBody;
        captures.push(body);
        return body.stream ? verificationError() : acceptedResponse('responses');
      });
      const provider = new OpenAIProvider({ apiKey: 'synthetic-offline-key' });
      const original = structuredClone(history);
      const response = await provider.createStreamingResponse(
        history,
        tools,
        'gpt-4o',
        undefined,
        { previousResponseId: 'resp_previous' },
        { temporaryContext, toolChoice: 'required' }
      );

      expect(response.content).toBe('OK');
      expect(captures).toHaveLength(2);
      expect(captures.map((body) => body.stream)).toEqual([true, false]);
      for (const body of captures) {
        if (temporaryContext === undefined) {
          expect(body.store).toBe(true);
          expect(body.previous_response_id).toBe('resp_previous');
          expect(body.input).toEqual(responseTail);
        } else {
          expect(body.store).toBe(false);
          expect(body.previous_response_id).toBeUndefined();
          expect(body.input).toEqual([
            ...responseHistory,
            ...(temporaryContext ? [{ role: 'user', content: temporaryContext }] : []),
          ]);
        }
        expect(body.tool_choice).toBe('required');
      }
      expect(history).toEqual(original);
    }
  );

  for (const routing of ['custom-chat', 'openai-responses-to-chat'] as const) {
    it.each([temporaryText, null, undefined])(
      `${routing} stays on Chat and keeps exactly one context tail with context=%s`,
      async (temporaryContext) => {
        const captures: Array<{ path: string; body: WireBody }> = [];
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          const path = new URL(request.url).pathname;
          const body = JSON.parse(await request.text()) as WireBody;
          captures.push({ path, body });
          if (path === '/v1/responses') {
            return Response.json(
              {
                error: {
                  type: 'invalid_request_error',
                  code: 'model_not_found',
                  message: 'The model does not exist',
                },
              },
              { status: 404 }
            );
          }
          expect(path).toBe('/v1/chat/completions');
          return body.stream ? verificationError() : acceptedResponse('chat');
        });
        const provider = new OpenAIProvider({
          apiKey: 'synthetic-offline-key',
          ...(routing === 'custom-chat' ? { baseURL: 'https://verification.invalid/v1' } : {}),
        });
        const original = structuredClone(history);
        const response = await provider.createStreamingResponse(
          history,
          tools,
          'gpt-4o',
          undefined,
          { previousResponseId: 'resp_previous' },
          { temporaryContext, toolChoice: 'required' }
        );

        expect(response.content).toBe('OK');
        expect(captures.map(({ path, body }) => [path, body.stream])).toEqual([
          ...(routing === 'openai-responses-to-chat' ? [['/v1/responses', true]] : []),
          ['/v1/chat/completions', true],
          ['/v1/chat/completions', false],
        ]);
        const chatRequests = captures.filter(({ path }) => path === '/v1/chat/completions');
        for (const { body } of chatRequests) {
          expect(body.tool_choice).toBe('required');
          expect(body.messages).toMatchObject([
            { role: 'system' },
            { role: 'user', content: 'Required question.' },
            {
              role: 'assistant',
              tool_calls: [{ id: 'call_lookup', function: { name: 'lookup', arguments: '{}' } }],
            },
            { role: 'tool', tool_call_id: 'call_lookup', content: 'Required result.' },
            { role: 'user', content: 'Required followup.' },
            ...(temporaryContext ? [{ role: 'user', content: temporaryContext }] : []),
          ]);
        }
        expect(history).toEqual(original);
      }
    );
  }
});
