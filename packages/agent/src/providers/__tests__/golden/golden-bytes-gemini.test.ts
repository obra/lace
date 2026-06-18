// ABOUTME: Pins the Gemini generateContent REQUEST OBJECT (JSON.stringify) for
// the shared fixture corpus. Gemini exposes no baseURL passthrough and manages
// no prompt cache, so the object lace hands the SDK is the right gate. Mirrors
// the mock in gemini-provider.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
// Factory + exported class name copied from gemini-provider.test.ts:13-20.
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    },
  })),
}));

import { GeminiProvider } from '@lace/agent/providers/gemini-provider';
import { FIXTURES } from './_fixtures';

function capture(): string {
  const call = mockGenerateContent.mock.calls.at(-1);
  if (!call) throw new Error('mockGenerateContent was not called');
  return JSON.stringify(call[0]);
}

describe('golden-bytes: Gemini request object is pinned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
  });

  for (const fixture of FIXTURES) {
    it(`pins the Gemini object for "${fixture.name}"`, async () => {
      const provider = new GeminiProvider({ apiKey: 'test-api-key' });
      provider.setSystemPrompt(fixture.systemPrompt);
      await provider.createResponse(fixture.messages, fixture.tools, 'gemini-2.5-flash');
      const a = capture();
      await provider.createResponse(fixture.messages, fixture.tools, 'gemini-2.5-flash');
      const b = capture();
      // intra-run determinism — also pins the Date.now()/Math.random() tool-id concern:
      // the converter must not re-mint ids for persisted history.
      expect(a).toBe(b);
      await expect(a).toMatchFileSnapshot(`./gemini-${fixture.name}.json`);
    });
  }
});
