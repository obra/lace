// ABOUTME: PRI-2900 — Bedrock streams carry the same stall exposure as the
// ABOUTME: direct Anthropic path: a connection that dies after response headers
// ABOUTME: goes silent rather than erroring. A silent stream must be aborted and
// ABOUTME: surfaced as a retryable timeout, and a slow-but-alive one left alone.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BedrockProvider, BEDROCK_STREAM_IDLE_TIMEOUT_MS } from './bedrock-provider';
import type { ProviderMessage } from './base-provider';

const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockCountTokens = vi.fn();

vi.mock('@anthropic-ai/bedrock-sdk', () => {
  class MockAnthropicBedrockMantle {
    beta = {
      messages: {
        create: mockCreate,
        stream: mockStream,
        countTokens: mockCountTokens,
      },
    };
  }
  return {
    AnthropicBedrockMantle: MockAnthropicBedrockMantle,
    default: MockAnthropicBedrockMantle,
  };
});

const MODEL = 'anthropic.claude-sonnet-5';

interface StreamHandlers {
  [event: string]: Array<(...args: unknown[]) => void>;
}

/** A stream that emits nothing and only settles if its abort signal fires. */
function silentStream(): {
  stream: Record<string, unknown>;
  setSignal: (s: AbortSignal | undefined) => void;
} {
  let abortSignal: AbortSignal | undefined;
  const stream: Record<string, unknown> = {
    on: vi.fn(() => stream),
    finalMessage: vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          const rejectAborted = () => {
            const err = new Error('Request was aborted.');
            err.name = 'APIUserAbortError';
            reject(err);
          };
          if (abortSignal?.aborted) rejectAborted();
          else abortSignal?.addEventListener('abort', rejectAborted, { once: true });
        })
    ),
  };
  return {
    stream,
    setSignal: (s) => {
      abortSignal = s;
    },
  };
}

describe('PRI-2900: Bedrock stream stall guard', () => {
  let provider: BedrockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCreate.mockReset();
    mockStream.mockReset();
    provider = new BedrockProvider({
      awsRegion: 'us-west-1',
      awsAccessKeyId: 'AKIATEST',
      awsSecretAccessKey: 'secret',
    });
    provider.on('error', () => {});
    provider.on('retry_attempt', () => {});
    provider.on('retry_exhausted', () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a Bedrock stream that goes silent and reports it as a timeout', async () => {
    const silent = silentStream();
    mockStream.mockImplementation((_payload: unknown, opts: { signal?: AbortSignal }) => {
      silent.setSignal(opts.signal);
      return silent.stream;
    });

    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];
    const promise = provider.createStreamingResponse(messages, [], MODEL);
    const settled = promise.then(
      () => 'resolved',
      (err: Error) => err
    );

    // Enough for the guard to fire and the retry budget to be spent.
    await vi.advanceTimersByTimeAsync(BEDROCK_STREAM_IDLE_TIMEOUT_MS * 12);

    const result = await settled;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error & { code?: string }).code).toBe('ETIMEDOUT');
    expect(mockStream).toHaveBeenCalled();
  });

  it('leaves a slow-but-alive Bedrock stream running', async () => {
    const handlers: StreamHandlers = {};
    let resolveFinal!: (value: unknown) => void;
    let abortSignal: AbortSignal | undefined;
    const stream: Record<string, unknown> = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        (handlers[event] ??= []).push(handler);
        return stream;
      }),
      finalMessage: vi.fn(
        () =>
          new Promise((resolve, reject) => {
            resolveFinal = resolve;
            // Must honor the signal, or an over-eager guard could not fail this.
            abortSignal?.addEventListener(
              'abort',
              () => {
                const err = new Error('Request was aborted.');
                err.name = 'APIUserAbortError';
                reject(err);
              },
              { once: true }
            );
          })
      ),
    };
    mockStream.mockImplementation((_payload: unknown, opts: { signal?: AbortSignal }) => {
      abortSignal = opts.signal;
      return stream;
    });

    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];
    const promise = provider.createStreamingResponse(messages, [], MODEL);
    promise.catch(() => {});

    // Keep emitting inside the idle window: total elapsed exceeds it, but no
    // single gap does.
    const bump = Math.floor(BEDROCK_STREAM_IDLE_TIMEOUT_MS * 0.8);
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(bump);
      for (const h of handlers.streamEvent ?? []) h({ type: 'message_start' });
    }

    expect(mockStream).toHaveBeenCalledTimes(1);

    resolveFinal({
      id: 'msg_bedrock',
      content: [{ type: 'text', text: 'slow but alive' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });
    const response = await promise;
    expect(response.content).toBe('slow but alive');
  });
});
