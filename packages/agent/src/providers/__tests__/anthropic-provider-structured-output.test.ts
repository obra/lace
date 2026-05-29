// ABOUTME: Tests for native structured-output support in AnthropicProvider —
// ABOUTME: outputFormat in RequestOptions becomes output_config.format + the
// ABOUTME: structured-outputs beta, and JSON response text is parsed into
// ABOUTME: ProviderResponse.structuredOutput (both streaming + non-streaming).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';

const mockCreateResponse = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: vi.fn(), stream: vi.fn() };
      beta = {
        messages: {
          create: mockCreateResponse,
          stream: mockStream,
          countTokens: vi.fn().mockResolvedValue({ input_tokens: 100 }),
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

const STRUCTURED_OUTPUTS_BETA = 'structured-outputs-2025-12-15';

const DECISION_SCHEMA = {
  type: 'object',
  properties: { decision: { type: 'string' }, reason: { type: 'string' } },
  required: ['decision', 'reason'],
  additionalProperties: false,
} as const;

const OUTPUT_FORMAT = { type: 'json_schema' as const, schema: DECISION_SCHEMA };

describe('AnthropicProvider structured outputs', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({ apiKey: 'test-key' });
    provider.setSystemPrompt('sys');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  it('sends output_config.format and the structured-outputs beta when outputFormat is set', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: '{"decision":"deny","reason":"x"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse(
      [{ role: 'user', content: 'decide' }],
      [],
      'claude-opus-4-7',
      undefined,
      undefined,
      { outputFormat: OUTPUT_FORMAT }
    );

    const payload = mockCreateResponse.mock.calls[0]![0] as {
      betas?: string[];
      output_config?: { format?: unknown };
    };
    expect(payload.output_config?.format).toEqual(OUTPUT_FORMAT);
    expect(payload.betas).toContain(STRUCTURED_OUTPUTS_BETA);
  });

  it('omits output_config and the structured-outputs beta when outputFormat is absent', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-7');

    const payload = mockCreateResponse.mock.calls[0]![0] as {
      betas?: string[];
      output_config?: unknown;
    };
    expect(payload.output_config).toBeUndefined();
    expect(payload.betas).not.toContain(STRUCTURED_OUTPUTS_BETA);
  });

  it('parses JSON response text into structuredOutput (non-streaming)', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: '{"decision":"approve","reason":"trusted"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    const response = await provider.createResponse(
      [{ role: 'user', content: 'decide' }],
      [],
      'claude-opus-4-7',
      undefined,
      undefined,
      { outputFormat: OUTPUT_FORMAT }
    );

    expect(response.structuredOutput).toEqual({ decision: 'approve', reason: 'trusted' });
  });

  it('leaves structuredOutput undefined when no outputFormat is requested', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: '{"decision":"approve"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    const response = await provider.createResponse(
      [{ role: 'user', content: 'hi' }],
      [],
      'claude-opus-4-7'
    );

    expect(response.structuredOutput).toBeUndefined();
  });

  it('parses JSON response text into structuredOutput (streaming)', async () => {
    const finalMessage = {
      id: 'msg_1',
      content: [{ type: 'text', text: '{"decision":"deny","reason":"unknown fields"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    };
    mockStream.mockReturnValue({
      on: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue(finalMessage),
    });

    const response = await provider.createStreamingResponse(
      [{ role: 'user', content: 'decide' }],
      [],
      'claude-opus-4-7',
      undefined,
      undefined,
      { outputFormat: OUTPUT_FORMAT }
    );

    const payload = mockStream.mock.calls[0]![0] as {
      betas?: string[];
      output_config?: { format?: unknown };
    };
    expect(payload.output_config?.format).toEqual(OUTPUT_FORMAT);
    expect(payload.betas).toContain(STRUCTURED_OUTPUTS_BETA);
    expect(response.structuredOutput).toEqual({ decision: 'deny', reason: 'unknown fields' });
  });
});
