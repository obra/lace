// ABOUTME: Checks required tool results precede same-turn user content in Anthropic and OpenAI.
// ABOUTME: Exercises actual SDK serialization with synthetic fetch responses only.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { OpenAIProvider } from '../openai-provider';
import type { ProviderMessage } from '../base-provider';

type Route = 'anthropic' | 'responses' | 'chat';
type WireRequest = {
  messages?: unknown[];
  input?: unknown[];
  previous_response_id?: string;
  store?: boolean;
};

function syntheticResponse(route: Route, streaming: boolean): Response {
  const usage = { input_tokens: 10, output_tokens: 1, total_tokens: 11 };
  const anthropic = {
    id: 'message_fixture',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'OK' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage,
  };
  const responses = {
    id: 'response_fixture',
    object: 'response',
    status: 'completed',
    usage,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'OK', annotations: [] }],
      },
    ],
  };
  const chat = {
    id: 'chat_fixture',
    object: 'chat.completion',
    model: 'gpt-4o',
    created: 0,
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
  };
  if (!streaming) {
    return Response.json(route === 'anthropic' ? anthropic : route === 'chat' ? chat : responses);
  }
  if (route === 'chat') {
    return new Response(
      `data: ${JSON.stringify({ ...chat, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } }
    );
  }
  const events =
    route === 'anthropic'
      ? [
          { type: 'message_start', message: { ...anthropic, content: [], stop_reason: null } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 1 },
          },
          { type: 'message_stop' },
        ]
      : [
          { type: 'response.output_text.delta', delta: 'OK' },
          { type: 'response.completed', response: responses },
        ];
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

function expectedHistory(route: Route, blocks: boolean): unknown[] {
  if (route === 'anthropic') {
    return [
      { role: 'user' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Inspecting both sources.' },
          { type: 'tool_use', id: 'call_image', name: 'read_image', input: { path: 'shot.png' } },
          { type: 'tool_use', id: 'call_file', name: 'read_file', input: { path: 'missing.txt' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_image',
            content: [
              { type: 'text', text: 'Screenshot.' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'dG9vbC1pbWFnZQ==' },
              },
              { type: 'text', text: 'Image complete.' },
            ],
          },
          {
            type: 'tool_result',
            tool_use_id: 'call_file',
            content: 'File not found.',
            is_error: true,
          },
          { type: 'text', text: 'Required followup.' },
          ...(blocks
            ? [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/png', data: 'dXNlci1pbWFnZQ==' },
                },
                { type: 'text', text: 'Required image context.' },
              ]
            : []),
        ],
      },
    ];
  }
  if (route === 'chat') {
    return [
      { role: 'system', content: 'Inspect both sources.' },
      { role: 'user', content: 'Inspect the record and screenshot.' },
      {
        role: 'assistant',
        content: 'Inspecting both sources.',
        tool_calls: [
          {
            id: 'call_image',
            type: 'function',
            function: { name: 'read_image', arguments: '{"path":"shot.png"}' },
          },
          {
            id: 'call_file',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"missing.txt"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_image',
        content:
          'Screenshot.\n[image omitted: this provider cannot carry an image in a tool result (image/png)]\nImage complete.',
      },
      { role: 'tool', tool_call_id: 'call_file', content: 'File not found.' },
      {
        role: 'user',
        content: blocks
          ? [
              { type: 'text', text: 'Required followup.' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,dXNlci1pbWFnZQ==' } },
              { type: 'text', text: 'Required image context.' },
            ]
          : 'Required followup.',
      },
    ];
  }
  const tail = [
    {
      type: 'function_call_output',
      call_id: 'call_image',
      output: [
        { type: 'input_text', text: 'Screenshot.' },
        { type: 'input_image', image_url: 'data:image/png;base64,dG9vbC1pbWFnZQ==' },
        { type: 'input_text', text: 'Image complete.' },
      ],
    },
    { type: 'function_call_output', call_id: 'call_file', output: 'File not found.' },
    {
      role: 'user',
      content: blocks
        ? [
            { type: 'input_text', text: 'Required followup.' },
            {
              type: 'input_image',
              detail: 'auto',
              image_url: 'data:image/png;base64,dXNlci1pbWFnZQ==',
            },
            { type: 'input_text', text: 'Required image context.' },
          ]
        : 'Required followup.',
    },
  ];
  return [
    { role: 'user', content: 'Inspect the record and screenshot.' },
    { role: 'assistant', content: 'Inspecting both sources.' },
    {
      type: 'function_call',
      call_id: 'call_image',
      name: 'read_image',
      arguments: '{"path":"shot.png"}',
    },
    {
      type: 'function_call',
      call_id: 'call_file',
      name: 'read_file',
      arguments: '{"path":"missing.txt"}',
    },
    ...tail,
  ];
}

describe('Anthropic and OpenAI tool-result ordering through actual SDKs', () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const route of ['anthropic', 'responses', 'chat'] as const) {
    for (const method of ['createResponse', 'createStreamingResponse'] as const) {
      for (const temporaryContext of [undefined, 'FRESH-TEMPORARY']) {
        it.each(['string', 'blocks'] as const)(
          `${route} ${method} context=${temporaryContext !== undefined} places multiple tool results before %s user content`,
          async (contentShape) => {
            const captures: WireRequest[] = [];
            const streaming = method === 'createStreamingResponse';
            vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
              const request = new Request(input, init);
              const url = new URL(request.url);
              expect(url.pathname).toBe(
                route === 'anthropic'
                  ? '/v1/messages'
                  : route === 'chat'
                    ? '/v1/chat/completions'
                    : '/v1/responses'
              );
              expect(url.origin).toBe(
                route === 'anthropic'
                  ? 'https://api.anthropic.com'
                  : route === 'chat'
                    ? 'https://ordering.invalid'
                    : 'https://api.openai.com'
              );
              expect(url.search).toBe(route === 'anthropic' ? '?beta=true' : '');
              const raw = await request.text();
              captures.push(JSON.parse(raw) as WireRequest);
              return syntheticResponse(route, streaming);
            });
            const required: ProviderMessage[] = [
              { role: 'user', content: 'Inspect the record and screenshot.' },
              {
                role: 'assistant',
                content: 'Inspecting both sources.',
                toolCalls: [
                  { id: 'call_image', name: 'read_image', arguments: { path: 'shot.png' } },
                  { id: 'call_file', name: 'read_file', arguments: { path: 'missing.txt' } },
                ],
              },
              {
                role: 'user',
                content:
                  contentShape === 'string'
                    ? 'Required followup.'
                    : [
                        { type: 'text', text: 'Required followup.' },
                        {
                          type: 'image',
                          source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: 'dXNlci1pbWFnZQ==',
                          },
                        },
                        { type: 'text', text: 'Required image context.' },
                      ],
                toolResults: [
                  {
                    id: 'call_image',
                    status: 'completed',
                    content: [
                      { type: 'text', text: 'Screenshot.' },
                      { type: 'image', mimeType: 'image/png', data: 'dG9vbC1pbWFnZQ==' },
                      { type: 'text', text: 'Image complete.' },
                    ],
                  },
                  {
                    id: 'call_file',
                    status: 'failed',
                    content: [{ type: 'text', text: 'File not found.' }],
                  },
                ],
              },
            ];
            const original = structuredClone(required);
            const provider =
              route === 'anthropic'
                ? new AnthropicProvider({ apiKey: 'synthetic-offline-key', maxTokens: 512 })
                : new OpenAIProvider({
                    apiKey: 'synthetic-offline-key',
                    maxTokens: 512,
                    ...(route === 'chat'
                      ? { baseURL: 'https://ordering.invalid/v1' }
                      : { supportsResponseChaining: false }),
                  });
            provider.setSystemPrompt('Inspect both sources.');
            try {
              const response = await provider[method](
                required,
                [],
                route === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o',
                undefined,
                { previousResponseId: 'old-context-response' },
                { temporaryContext }
              );
              expect(response.content).toBe('OK');
              expect(captures).toHaveLength(1);
              const body = captures[0];
              expect(route === 'responses' ? body.input : body.messages).toMatchObject([
                ...expectedHistory(route, contentShape === 'blocks'),
                ...(temporaryContext
                  ? [
                      {
                        role: 'user',
                        content:
                          route === 'anthropic'
                            ? [{ type: 'text', text: temporaryContext }]
                            : temporaryContext,
                      },
                    ]
                  : []),
              ]);
              if (route === 'anthropic') {
                // Cache stamping may promote a string to blocks; compare content with markers intact.
                const first = (body.messages?.[0] as { content: unknown }).content;
                expect(
                  typeof first === 'string' ? [{ type: 'text', text: first }] : first
                ).toMatchObject([{ type: 'text', text: 'Inspect the record and screenshot.' }]);
              }
              if (route === 'responses') {
                expect(body.store).toBe(false);
                expect(body.previous_response_id).toBeUndefined();
              }
              expect(required).toEqual(original);
            } finally {
              provider.removeAllListeners();
            }
          }
        );
      }
    }
  }
});
