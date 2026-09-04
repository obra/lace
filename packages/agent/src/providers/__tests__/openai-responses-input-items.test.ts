// ABOUTME: PRI-3079 — covers the PRODUCTION Responses-API call site, not just the pure helpers.
// ABOUTME: Every earlier test called the converters directly, so replacing the provider's
// ABOUTME: `output: toOpenAIResponsesToolOutput(...)` with `output: ''` left the whole suite
// ABOUTME: green. These assert on the payload actually handed to `openai.responses.create`,
// ABOUTME: including user-attached images, which the text-only extraction silently dropped.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai-provider';
import type { ProviderMessage } from '../base-provider';

const mockResponsesCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      responses = {
        create: mockResponsesCreate,
      };
      chat = {
        completions: {
          create: vi.fn(),
        },
      };
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../utils/provider-logging.js', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface InputItem {
  type?: string;
  role?: string;
  content?: unknown;
  output?: unknown;
}

describe('OpenAI Responses API input items', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResponsesCreate.mockResolvedValue({
      id: 'resp_1',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    provider = new OpenAIProvider({ apiKey: 'test-key' });
    provider.setSystemPrompt('Test system prompt');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  async function inputItems(messages: ProviderMessage[]): Promise<InputItem[]> {
    await provider.createResponse(messages, [], 'gpt-4o');
    const payload = mockResponsesCreate.mock.calls[0]?.[0] as { input?: InputItem[] };
    return payload.input ?? [];
  }

  it('sends the tool-result image through the real request payload', async () => {
    const items = await inputItems([
      { role: 'user', content: 'take a screenshot' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'shot', arguments: {} }],
      },
      {
        role: 'user',
        content: '',
        toolResults: [
          {
            id: 'call_1',
            status: 'completed',
            content: [
              { type: 'text', text: 'screenshot.png' },
              { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
            ],
          },
        ],
      },
    ]);

    const output = items.find((item) => item.type === 'function_call_output');
    expect(output?.output).toEqual([
      { type: 'input_text', text: 'screenshot.png' },
      { type: 'input_image', image_url: `data:image/png;base64,${PNG_1PX}` },
    ]);
  });

  it('never sends an empty tool-result output', async () => {
    const items = await inputItems([
      {
        role: 'user',
        content: '',
        toolResults: [
          {
            id: 'call_2',
            status: 'completed',
            content: [{ type: 'image', data: PNG_1PX, mimeType: 'image/png' }],
          },
        ],
      },
    ]);

    const output = items.find((item) => item.type === 'function_call_output');
    expect(output?.output).not.toBe('');
  });

  it('sends a user-attached image alongside the text', async () => {
    // The Responses API is the default path for real OpenAI, and it extracted text
    // blocks only — a pasted image never reached the model.
    const items = await inputItems([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX } },
        ],
      },
    ]);

    expect(items[0]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'what is this?' },
        { type: 'input_image', detail: 'auto', image_url: `data:image/png;base64,${PNG_1PX}` },
      ],
    });
  });

  it('sends an image-only user message instead of dropping it entirely', async () => {
    // `textContent.trim()` is empty for an image-only message, so nothing was pushed
    // at all: the turn vanished from the conversation the model saw.
    const items = await inputItems([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX } },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      role: 'user',
      content: [
        { type: 'input_image', detail: 'auto', image_url: `data:image/png;base64,${PNG_1PX}` },
      ],
    });
  });

  it('keeps a plain text message in the flat string form', async () => {
    const items = await inputItems([{ role: 'user', content: 'hello' }]);
    expect(items[0]).toEqual({ role: 'user', content: 'hello' });
  });
});
