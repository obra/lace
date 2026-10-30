// ABOUTME: Ensures explicit Anthropic/Bedrock cache prefixes exclude temporary text.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { BedrockProvider } from '../bedrock-provider';
import type { AIProvider, ProviderMessage } from '../base-provider';

interface Body {
  messages: Array<{ role: string; content: unknown }>;
  system: unknown;
  tools: unknown;
  diagnostics?: unknown;
}
describe('temporary context explicit cache boundaries', () => {
  afterEach(() => vi.unstubAllGlobals());
  for (const name of ['anthropic', 'bedrock'] as const) {
    it(`${name} marks only required history, independent of temporary text size`, async () => {
      const sent: Body[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        sent.push(JSON.parse(await request.text()) as Body);
        return Response.json({
          id: 'msg_fixture',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'OK' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 1 },
        });
      });
      const provider: AIProvider =
        name === 'anthropic'
          ? new AnthropicProvider({ apiKey: 'synthetic-offline-key' })
          : new BedrockProvider({
              awsRegion: 'us-east-1',
              awsAccessKeyId: 'synthetic-offline-key',
              awsSecretAccessKey: 'synthetic-offline-secret',
            });
      provider.setSystemPrompt('Stable instructions.');
      const history: ProviderMessage[] = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Required message ${i}`,
      }));
      history.push({ role: 'user', content: 'Final required input.' });
      const original = structuredClone(history);
      for (const temporaryContext of [
        undefined,
        'small temporary text',
        'large temporary text '.repeat(1000),
        null,
      ]) {
        await provider.createResponse(
          history,
          [{ name: 'lookup', description: 'Lookup', inputSchema: { type: 'object' } }],
          'claude-sonnet-4-6',
          undefined,
          { previousResponseId: 'msg_previous' },
          { temporaryContext }
        );
      }
      const baseline = sent[0];
      for (const body of sent.slice(1, 3)) {
        expect(JSON.stringify(body.messages.slice(0, -1))).toBe(JSON.stringify(baseline.messages));
        expect(body.system).toEqual(baseline.system);
        expect(body.tools).toEqual(baseline.tools);
        expect(body.messages.at(-1)).toEqual({
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                body === sent[1] ? 'small temporary text' : 'large temporary text '.repeat(1000),
            },
          ],
        });
        expect(JSON.stringify(body.messages.slice(0, -1))).toContain('cache_control');
      }
      expect(sent[3]).toEqual(baseline);
      if (name === 'anthropic')
        expect(sent[1].diagnostics).toEqual({ previous_message_id: 'msg_previous' });
      expect(history).toEqual(original);
    });
  }
});
