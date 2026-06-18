// ABOUTME: Reusable mock-HTTP-server harness that drives a provider's real
// createResponse() pipeline and captures the LITERAL serialized request body.
// One capture fn per provider family; each mirrors the minimal valid response
// shape that provider's parser expects (cribbed from the provider's own tests).

import { createServer, type Server } from 'node:http';
import { AnthropicProvider } from '@lace/agent/providers/anthropic-provider';
import type { GoldenFixture } from './_fixtures';

async function startServer(
  handler: (body: string, n: number) => string
): Promise<{ server: Server; baseURL: string; captured: string[] }> {
  const captured: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      captured.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(handler(body, captured.length));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return { server, baseURL: `http://127.0.0.1:${addr.port}`, captured };
}

export async function captureAnthropicBody(fixture: GoldenFixture): Promise<string> {
  const { server, baseURL, captured } = await startServer((_b, n) =>
    JSON.stringify({
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  );
  try {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });
    provider.setSystemPrompt(fixture.systemPrompt);
    await provider.createResponse(fixture.messages, fixture.tools, 'claude-sonnet-4-20250514');
    if (captured.length !== 1) throw new Error(`expected 1 request, got ${captured.length}`);
    return captured[0]!;
  } finally {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  }
}
