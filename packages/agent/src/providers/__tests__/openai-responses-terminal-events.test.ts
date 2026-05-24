// ABOUTME: Tests that response.incomplete / response.failed terminal events route through
// ABOUTME: normalizeOpenAIResponsesStop instead of falling through to incomplete_stream synthetic failure
// ABOUTME: (roborev job 803 Finding 2).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai-provider';

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

describe('OpenAIProvider Responses API — terminal incomplete/failed events', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider({ apiKey: 'test-key' });
    provider.setSystemPrompt('Test system prompt');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  it("response.incomplete with reason='max_output_tokens' maps to stopReason='max_output_tokens'", async () => {
    // Before the fix: response.incomplete fell through to default, no
    // completedResponse was captured, and the normalizer was bypassed —
    // surfacing a synthetic 'incomplete_stream' failure that lost the real
    // stop reason.
    const streamEvents = [
      { type: 'response.created', response: { id: 'resp_inc_1', status: 'in_progress' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1' },
      },
      {
        type: 'response.output_text.delta',
        delta: 'Partial output cut off at the token limit',
      },
      {
        type: 'response.incomplete',
        response: {
          id: 'resp_inc_1',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 100, output_tokens: 4096, total_tokens: 4196 },
        },
        sequence_number: 99,
      },
    ];

    mockResponsesCreate.mockImplementation(() => {
      return (async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      })();
    });

    const response = await provider.createStreamingResponse(
      [{ role: 'user' as const, content: 'Generate a lot of text' }],
      [],
      'gpt-4o'
    );

    expect(response.stopReason).toBe('max_output_tokens');
    expect(response.stopDetails).toMatchObject({
      type: 'max_output_tokens',
      source: 'openai_responses_incomplete_details',
    });
    expect(response.content).toBe('Partial output cut off at the token limit');
  });

  it("response.incomplete with reason='content_filter' maps to stopReason='refusal'", async () => {
    const streamEvents = [
      { type: 'response.created', response: { id: 'resp_inc_2', status: 'in_progress' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1' },
      },
      {
        type: 'response.output_text.delta',
        delta: 'Some output before the safety classifier kicked in',
      },
      {
        type: 'response.incomplete',
        response: {
          id: 'resp_inc_2',
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
          usage: { input_tokens: 50, output_tokens: 25, total_tokens: 75 },
        },
        sequence_number: 99,
      },
    ];

    mockResponsesCreate.mockImplementation(() => {
      return (async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      })();
    });

    const response = await provider.createStreamingResponse(
      [{ role: 'user' as const, content: 'A borderline prompt' }],
      [],
      'gpt-4o'
    );

    expect(response.stopReason).toBe('refusal');
    expect(response.stopDetails).toMatchObject({
      type: 'refusal',
      source: 'openai_responses_content_filter',
    });
  });

  it("response.failed with error.code routes through normalizer to stopReason='failed'", async () => {
    const streamEvents = [
      { type: 'response.created', response: { id: 'resp_fail_1', status: 'in_progress' } },
      {
        type: 'response.failed',
        response: {
          id: 'resp_fail_1',
          status: 'failed',
          error: {
            code: 'server_error',
            message: 'OpenAI Responses returned an internal error',
          },
          usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 },
        },
        sequence_number: 99,
      },
    ];

    mockResponsesCreate.mockImplementation(() => {
      return (async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      })();
    });

    const response = await provider.createStreamingResponse(
      [{ role: 'user' as const, content: 'Try me' }],
      [],
      'gpt-4o'
    );

    expect(response.stopReason).toBe('failed');
    expect(response.stopDetails).toMatchObject({
      type: 'failed',
      code: 'server_error',
      message: 'OpenAI Responses returned an internal error',
      source: 'openai_responses_failed_status',
    });
  });
});
