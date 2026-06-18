// ABOUTME: Pins the OpenAI Chat Completions REQUEST OBJECT (JSON.stringify) for
// the shared fixture corpus. Captures the object lace hands the SDK (the thing
// we control) — OpenAI's prefix cache is server-side, so object-level fidelity
// is the right gate. Mirrors the mock in openai-provider.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import { OpenAIProvider } from '@lace/agent/providers/openai-provider';
import { FIXTURES } from './_fixtures';

function capture(): string {
  // The request object lace passed to chat.completions.create on the last call.
  const call = mockCreate.mock.calls.at(-1);
  if (!call) throw new Error('mockCreate was not called');
  return JSON.stringify(call[0]);
}

describe('golden-bytes: OpenAI request object is pinned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });

  for (const fixture of FIXTURES) {
    it(`pins the OpenAI object for "${fixture.name}"`, async () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: 'http://localhost:8080/v1',
      });
      provider.setSystemPrompt(fixture.systemPrompt);
      await provider.createResponse(fixture.messages, fixture.tools, 'gpt-4o');
      const a = capture();
      await provider.createResponse(fixture.messages, fixture.tools, 'gpt-4o');
      const b = capture();
      expect(a).toBe(b); // intra-run determinism
      await expect(a).toMatchFileSnapshot(`./openai-${fixture.name}.json`);
    });
  }
});
