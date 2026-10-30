// ABOUTME: Verifies Gemini sends required tool results before same-turn user content.
// ABOUTME: Exercises the installed SDK with synthetic fetch responses only.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Content, Part } from '@google/genai';
import { GeminiProvider } from '../gemini-provider';
import type { ProviderMessage } from '../base-provider';

describe('Gemini tool-result ordering on the wire', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const method of ['createResponse', 'createStreamingResponse'] as const) {
    it.each(['string', 'blocks'] as const)(
      `${method} places multiple tool results before %s user content`,
      async (contentShape) => {
        const captures: Content[][] = [];
        const reply = {
          candidates: [
            { content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' },
          ],
        };
        vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
          captures.push((JSON.parse(String(init?.body)) as { contents: Content[] }).contents);
          return new Response(
            method === 'createStreamingResponse'
              ? `data: ${JSON.stringify(reply)}\n\n`
              : JSON.stringify(reply),
            {
              headers: {
                'content-type':
                  method === 'createStreamingResponse' ? 'text/event-stream' : 'application/json',
              },
            }
          );
        });
        const required: ProviderMessage[] = [
          { role: 'user', content: 'Inspect the record and screenshot.' },
          {
            role: 'assistant',
            content: 'Inspecting both sources.',
            toolCalls: [
              {
                id: 'gemini_read_image_123_a',
                name: 'read_image',
                arguments: { path: 'shot.png' },
              },
              {
                id: 'gemini_read_file_124_b',
                name: 'read_file',
                arguments: { path: 'missing.txt' },
              },
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
                      source: { type: 'base64', media_type: 'image/png', data: 'dXNlci1pbWFnZQ==' },
                    },
                    { type: 'text', text: 'Required image context.' },
                  ],
            toolResults: [
              {
                id: 'gemini_read_image_123_a',
                status: 'completed',
                content: [
                  { type: 'text', text: 'Screenshot.' },
                  { type: 'image', mimeType: 'image/png', data: 'dG9vbC1pbWFnZQ==' },
                  { type: 'text', text: 'Image complete.' },
                ],
              },
              {
                id: 'gemini_read_file_124_b',
                status: 'failed',
                content: [{ type: 'text', text: 'File not found.' }],
              },
            ],
          },
        ];
        const original = structuredClone(required);
        const provider = new GeminiProvider({ apiKey: 'synthetic-offline-key', maxTokens: 512 });
        provider.setSystemPrompt('Inspect both sources.');
        const response = await provider[method](required, [], 'gemini-3-pro-preview');
        expect(response.content).toBe('OK');

        const requiredUserParts: Part[] = [
          {
            functionResponse: {
              name: 'read_image',
              id: 'gemini_read_image_123_a',
              response: { output: 'Screenshot.\n[image: image/png]\nImage complete.' },
              parts: [{ inlineData: { mimeType: 'image/png', data: 'dG9vbC1pbWFnZQ==' } }],
            },
          },
          {
            functionResponse: {
              name: 'read_file',
              id: 'gemini_read_file_124_b',
              response: { output: 'File not found.', error: 'Tool execution failed' },
            },
          },
          { text: 'Required followup.' },
          ...(contentShape === 'blocks'
            ? [
                { inlineData: { mimeType: 'image/png', data: 'dXNlci1pbWFnZQ==' } },
                { text: 'Required image context.' },
              ]
            : []),
        ];
        expect(captures).toHaveLength(1);
        captures.forEach((contents) => {
          expect(contents).toEqual([
            { role: 'user', parts: [{ text: 'Inspect the record and screenshot.' }] },
            {
              role: 'model',
              parts: [
                { text: 'Inspecting both sources.' },
                { functionCall: { name: 'read_image', args: { path: 'shot.png' } } },
                { functionCall: { name: 'read_file', args: { path: 'missing.txt' } } },
              ],
            },
            { role: 'user', parts: requiredUserParts },
          ]);
        });
        expect(required).toEqual(original);
      }
    );
  }
});
