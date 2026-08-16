// ABOUTME: PRI-2900 — the stall guard shipped for streaming Anthropic left two
// ABOUTME: siblings exposed: the non-streaming path (whose body read after
// ABOUTME: headers is unbounded) and the Bedrock stream. Both must now abort a
// ABOUTME: silent request and surface it as a retryable timeout.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider, NONSTREAMING_TIMEOUT_MS } from './anthropic-provider';
import { ProviderMessage } from './base-provider';
import { anthropicBaseMessagesTrap } from '@lace/agent/test-utils/anthropic-base-namespace-trap';

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: anthropicBaseMessagesTrap(),
    beta: {
      messages: {
        create: mockCreate,
        stream: mockStream,
        countTokens: vi.fn().mockResolvedValue({ input_tokens: 100 }),
      },
    },
  }));
  return { default: MockAnthropic };
});

/** A call that never settles unless the signal it was handed aborts. */
function hangUntilAborted(): (payload: unknown, opts: { signal?: AbortSignal }) => Promise<never> {
  return (_payload, opts) =>
    new Promise((_resolve, reject) => {
      const rejectAborted = () => {
        const err = new Error('Request was aborted.');
        err.name = 'APIUserAbortError';
        reject(err);
      };
      if (opts.signal?.aborted) rejectAborted();
      else opts.signal?.addEventListener('abort', rejectAborted, { once: true });
    });
}

describe('PRI-2900: stall coverage on the non-streaming path', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCreate.mockReset();
    mockStream.mockReset();
    provider = new AnthropicProvider({ apiKey: 'test-key' });
    provider.on('error', () => {});
    provider.on('retry_attempt', () => {});
    provider.on('retry_exhausted', () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a non-streaming request that never responds', async () => {
    // Before the fix this hung indefinitely: the SDK's timer stops at response
    // headers, so a dead connection during the body read produced no error.
    mockCreate.mockImplementation(hangUntilAborted());

    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];
    const promise = provider.createResponse(messages, [], 'claude-3-5-haiku-20241022');
    const settled = promise.then(
      () => 'resolved',
      (err: Error) => err
    );

    // Each attempt stalls for the full deadline and is retried (the error is
    // retryable by design), so the turn fails only once the attempt budget is
    // spent. Advance past all of them.
    await vi.advanceTimersByTimeAsync(NONSTREAMING_TIMEOUT_MS * 12);

    const result = await settled;
    expect(result).toBeInstanceOf(Error);
    // Retryable, so withRetry treats it as a transient fault rather than
    // failing the turn outright.
    expect((result as Error & { code?: string }).code).toBe('ETIMEDOUT');
    expect(mockCreate).toHaveBeenCalled();
  });

  it('passes an explicit timeout so time-to-headers is bounded too', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg_1',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];
    await provider.createResponse(messages, [], 'claude-3-5-haiku-20241022');

    const opts = mockCreate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts.timeout).toBe(NONSTREAMING_TIMEOUT_MS);
  });

  it('does not abort a non-streaming request that answers in time', async () => {
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                id: 'msg_2',
                content: [{ type: 'text', text: 'slow but fine' }],
                usage: { input_tokens: 1, output_tokens: 1 },
                stop_reason: 'end_turn',
              }),
            NONSTREAMING_TIMEOUT_MS / 2
          );
        })
    );

    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];
    const promise = provider.createResponse(messages, [], 'claude-3-5-haiku-20241022');
    await vi.advanceTimersByTimeAsync(NONSTREAMING_TIMEOUT_MS / 2 + 1_000);

    const response = await promise;
    expect(response.content).toBe('slow but fine');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
