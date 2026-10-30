// ABOUTME: Exercises request-only tails through offline local-provider client boundaries.
import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../ollama-provider';
import { LMStudioProvider } from '../lmstudio-provider';
import type { ProviderMessage } from '../base-provider';

const { ollamaBodies, lmBodies } = vi.hoisted(() => ({
  ollamaBodies: [] as Array<{ messages: unknown[] }>,
  lmBodies: [] as Array<{ history: { messages: unknown[] } }>,
}));
vi.mock('ollama', () => ({
  Ollama: class {
    async list() {
      return { models: [{ name: 'test' }] };
    }
    async chat(body: { stream: boolean; messages: unknown[] }) {
      ollamaBodies.push(structuredClone(body));
      const reply = {
        message: { content: 'OK' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 1,
      };
      if (!body.stream) return reply;
      return (async function* () {
        yield reply;
      })();
    }
  },
}));
vi.mock('@lmstudio/sdk', () => ({
  LMStudioClient: class {
    llm = {
      async listLoaded() {
        return [{ identifier: 'other' }];
      },
      async load() {
        return {
          specifier: 'test',
          internalKVConfigStack: { layers: [] },
          internalIgnoreServerSessionConfig: false,
          predictionConfigInputToKVConfig: () => ({}),
          port: {
            createChannel(
              _kind: string,
              body: { history: { messages: unknown[] } },
              receive: (message: unknown) => void
            ) {
              lmBodies.push(structuredClone(body));
              receive({ type: 'success' });
            },
          },
        };
      },
    };
  },
}));

for (const method of ['createResponse', 'createStreamingResponse'] as const) {
  describe(`local temporary context ${method}`, () => {
    it('appends after required history for Ollama', async () => {
      ollamaBodies.length = 0;
      const provider = new OllamaProvider();
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Required input.' }];
      await provider[method](messages, [], 'test', undefined, undefined, {
        temporaryContext: 'Current context.',
      });
      expect(ollamaBodies[0].messages.slice(-2)).toEqual([
        { role: 'user', content: 'Required input.' },
        { role: 'user', content: 'Current context.' },
      ]);
      expect(messages).toHaveLength(1);
      await provider[method](messages, [], 'test', undefined, undefined, {
        temporaryContext: null,
      });
      expect(ollamaBodies[1].messages.at(-1)).toEqual(messages[0]);
    });
    it('appends after tool results for LMStudio and includes text in fallback usage', async () => {
      lmBodies.length = 0;
      const provider = new LMStudioProvider();
      const messages: ProviderMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'lookup', arguments: {} }],
        },
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'call_1',
              status: 'completed',
              content: [{ type: 'text', text: 'Required result.' }],
            },
          ],
        },
      ];
      const baseline = await provider[method](messages, [], 'test');
      const response = await provider[method](messages, [], 'test', undefined, undefined, {
        temporaryContext: 'x'.repeat(400),
      });
      expect(lmBodies[1].history.messages.slice(-2)).toMatchObject([
        { role: 'tool', content: [{ type: 'toolCallResult', content: 'Required result.' }] },
        { role: 'user', content: [{ type: 'text', text: 'x'.repeat(400) }] },
      ]);
      expect(response.usage!.promptTokens).toBeGreaterThanOrEqual(
        baseline.usage!.promptTokens! + 100
      );
      expect(messages).toHaveLength(2);
    });
  });
}
