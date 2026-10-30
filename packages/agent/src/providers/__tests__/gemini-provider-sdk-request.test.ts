// ABOUTME: Exercises Gemini request serialization through the installed Google SDK.
// ABOUTME: Captures only fetch so missing instructions and tools cannot hide behind SDK mocks.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../gemini-provider';
import type { WireTool } from '../base-provider';

describe('GeminiProvider SDK requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['createResponse', 'createStreamingResponse'] as const)(
    '%s sends system instructions and function declarations on the wire',
    async (method) => {
      const bodies: unknown[] = [];
      const streaming = method === 'createStreamingResponse';
      const reply = {
        candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 1, totalTokenCount: 21 },
      };
      vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          streaming ? `data: ${JSON.stringify(reply)}\n\n` : JSON.stringify(reply),
          {
            status: 200,
            headers: { 'content-type': streaming ? 'text/event-stream' : 'application/json' },
          }
        );
      });
      const provider = new GeminiProvider({ apiKey: 'synthetic-offline-key', maxTokens: 512 });
      provider.setSystemPrompt('Use the lookup tool when needed.');
      const tool = {
        name: 'lookup',
        description: 'Look up a synthetic record',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      } satisfies WireTool;

      const response = await provider[method](
        [{ role: 'user', content: 'Find the synthetic record.' }],
        [tool],
        'gemini-2.5-flash'
      );

      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({
        systemInstruction: { parts: [{ text: 'Use the lookup tool when needed.' }] },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'lookup',
                description: 'Look up a synthetic record',
                parameters: {
                  type: 'OBJECT',
                  properties: { query: { type: 'STRING' } },
                  required: ['query'],
                },
              },
            ],
          },
        ],
        contents: [{ role: 'user', parts: [{ text: 'Find the synthetic record.' }] }],
        generationConfig: { maxOutputTokens: 512 },
      });
      expect(response.content).toBe('OK');
      expect(response.usage).toEqual({ promptTokens: 20, completionTokens: 1, totalTokens: 21 });
    }
  );
});
