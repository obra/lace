// ABOUTME: Tests refusal-item capture from the OpenAI Responses API streaming path
// ABOUTME: Verifies ResponseRefusalDoneEvent text plumbs through normalizeOpenAIResponsesStop to stopReason='refusal'

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

describe('OpenAIProvider Responses API refusal-item capture', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider({ apiKey: 'test-key' });
    provider.setSystemPrompt('Test system prompt');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  it("captures refusal text from response.refusal.done and surfaces stopReason='refusal'", async () => {
    const refusalText = "I can't help with that.";

    // Per Chunk F spec: 7-event sequence
    const streamEvents = [
      // 1. response.created
      {
        type: 'response.created',
        response: { id: 'resp_refusal_1', status: 'in_progress' },
      },
      // 2. response.in_progress
      {
        type: 'response.in_progress',
        response: { id: 'resp_refusal_1', status: 'in_progress' },
      },
      // 3. response.output_item.added (a message item)
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1' },
      },
      // 4. response.refusal.delta (chunk 1)
      {
        type: 'response.refusal.delta',
        content_index: 0,
        item_id: 'msg_1',
        output_index: 0,
        sequence_number: 1,
        delta: "I can't help",
      },
      // 5. response.refusal.delta (chunk 2)
      {
        type: 'response.refusal.delta',
        content_index: 0,
        item_id: 'msg_1',
        output_index: 0,
        sequence_number: 2,
        delta: ' with that.',
      },
      // 6. response.refusal.done
      {
        type: 'response.refusal.done',
        content_index: 0,
        item_id: 'msg_1',
        output_index: 0,
        sequence_number: 3,
        refusal: refusalText,
      },
      // 7. response.completed (status: 'completed' — but refusal item wins per spec)
      {
        type: 'response.completed',
        response: {
          id: 'resp_refusal_1',
          status: 'completed',
          usage: {
            input_tokens: 10,
            output_tokens: 8,
            total_tokens: 18,
          },
        },
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
      [{ role: 'user' as const, content: 'Tell me something disallowed' }],
      [],
      'gpt-4o'
    );

    // Acceptance criteria from chunk F:
    //   stopReason='refusal', source='openai_responses_refusal_item',
    //   explanation==refusal text, content==''.
    expect(response.stopReason).toBe('refusal');
    expect(response.stopDetails).toMatchObject({
      type: 'refusal',
      explanation: refusalText,
      source: 'openai_responses_refusal_item',
    });

    // Refusal text is a policy refusal, NOT assistant output — must not pollute content.
    expect(response.content).toBe('');

    // No tool calls in this scenario.
    expect(response.toolCalls).toEqual([]);
  });

  it('preserves captured refusal across subsequent output_item.added boundaries', async () => {
    // A refusal-done finalizes in output item 0, then a NEW output_item.added (item 1)
    // begins. The earlier refusal must remain captured — the normalizer should still
    // report stopReason='refusal' with the original text. (No second refusal arrives.)

    const firstRefusal = "I can't do that.";

    const streamEvents = [
      { type: 'response.created', response: { id: 'r1', status: 'in_progress' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1' },
      },
      {
        type: 'response.refusal.delta',
        content_index: 0,
        item_id: 'msg_1',
        output_index: 0,
        sequence_number: 1,
        delta: firstRefusal,
      },
      {
        type: 'response.refusal.done',
        content_index: 0,
        item_id: 'msg_1',
        output_index: 0,
        sequence_number: 2,
        refusal: firstRefusal,
      },
      // New output item — resets in-flight buffer but the prior refusal-done was already captured.
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'message', id: 'msg_2' },
      },
      {
        type: 'response.completed',
        response: {
          id: 'r1',
          status: 'completed',
          usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 },
        },
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
      [{ role: 'user' as const, content: 'Bad prompt' }],
      [],
      'gpt-4o'
    );

    expect(response.stopReason).toBe('refusal');
    expect(response.stopDetails).toMatchObject({
      type: 'refusal',
      explanation: firstRefusal,
      source: 'openai_responses_refusal_item',
    });
    expect(response.content).toBe('');
  });

  it('when multiple output items each emit refusal.done, the last refusal wins', async () => {
    // Pins the documented "last refusal-done wins" semantic at openai-provider.ts:1197-1206.
    // Two output items each finalize their own refusal text; the normalizer should
    // surface item 1's text (the most recently finalized) as the canonical refusal.

    const firstRefusal = "I can't do that.";
    const secondRefusal = "I won't help with that either.";

    const streamEvents = [
      { type: 'response.created', response: { id: 'r3', status: 'in_progress' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1' },
      },
      {
        type: 'response.refusal.delta',
        content_index: 0,
        item_id: 'msg_1',
        output_index: 0,
        sequence_number: 1,
        delta: firstRefusal,
      },
      {
        type: 'response.refusal.done',
        content_index: 0,
        item_id: 'msg_1',
        output_index: 0,
        sequence_number: 2,
        refusal: firstRefusal,
      },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'message', id: 'msg_2' },
      },
      {
        type: 'response.refusal.delta',
        content_index: 0,
        item_id: 'msg_2',
        output_index: 1,
        sequence_number: 3,
        delta: secondRefusal,
      },
      {
        type: 'response.refusal.done',
        content_index: 0,
        item_id: 'msg_2',
        output_index: 1,
        sequence_number: 4,
        refusal: secondRefusal,
      },
      {
        type: 'response.completed',
        response: {
          id: 'r3',
          status: 'completed',
          usage: { input_tokens: 6, output_tokens: 9, total_tokens: 15 },
        },
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
      [{ role: 'user' as const, content: 'Two bad prompts' }],
      [],
      'gpt-4o'
    );

    expect(response.stopReason).toBe('refusal');
    expect(response.stopDetails).toMatchObject({
      type: 'refusal',
      explanation: secondRefusal,
      source: 'openai_responses_refusal_item',
    });
    expect(response.content).toBe('');
  });

  it('falls through to end_turn when no refusal events are emitted', async () => {
    // Sanity check: the refusal capture path doesn't accidentally trigger on a clean stream.
    const streamEvents = [
      { type: 'response.created', response: { id: 'r2', status: 'in_progress' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1' },
      },
      { type: 'response.output_text.delta', delta: 'Hello!' },
      {
        type: 'response.completed',
        response: {
          id: 'r2',
          status: 'completed',
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        },
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
      [{ role: 'user' as const, content: 'Hi' }],
      [],
      'gpt-4o'
    );

    expect(response.stopReason).toBe('end_turn');
    expect(response.content).toBe('Hello!');
  });
});
