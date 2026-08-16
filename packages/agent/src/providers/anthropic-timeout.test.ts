// ABOUTME: PRI-2896 — a stalled Anthropic stream must fail fast, not hang for
// ABOUTME: the SDK's stacked-retry worst case (~40 min observed in production).
// ABOUTME: Pins: SDK retries disabled (lace owns retries), an explicit headers
// ABOUTME: timeout on the stream call, and an idle watchdog that aborts a
// ABOUTME: silent stream so lace's own retry loop can take over.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AnthropicProvider,
  STREAM_HEADERS_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
} from './anthropic-provider';
import { ProviderMessage } from './base-provider';
import { anthropicBaseMessagesTrap } from '@lace/agent/test-utils/anthropic-base-namespace-trap';

const mockCreate = vi.fn();
const mockStream = vi.fn();
const constructorConfigs: Array<Record<string, unknown>> = [];

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation((config: Record<string, unknown>) => {
    constructorConfigs.push(config);
    return {
      messages: anthropicBaseMessagesTrap(),
      beta: {
        messages: {
          create: mockCreate,
          stream: mockStream,
          countTokens: vi.fn().mockResolvedValue({ input_tokens: 100 }),
        },
      },
    };
  });
  return { default: MockAnthropic };
});

interface StreamHandlers {
  [event: string]: Array<(...args: unknown[]) => void>;
}

// A stream mock whose finalMessage() hangs forever unless the abort signal the
// provider passed in fires — modeling the SDK's behavior on a dead connection.
function silentStreamRespectingAbort() {
  const handlers: StreamHandlers = {};
  let abortSignal: AbortSignal | undefined;
  const stream = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(handler);
      return stream;
    }),
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
    _setSignal: (signal: AbortSignal | undefined) => {
      abortSignal = signal;
    },
    _handlers: handlers,
  };
  return stream;
}

function healthyStream(text: string) {
  const stream = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'text') handler(text);
      return stream;
    }),
    finalMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    }),
  };
  return stream;
}

describe('PRI-2896: Anthropic client timeout tuning', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    constructorConfigs.length = 0;
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

  it('disables SDK-internal retries (lace owns retries) and caps time-to-headers on streams', async () => {
    mockStream.mockReturnValue(healthyStream('hi'));
    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

    await provider.createStreamingResponse(messages, [], 'claude-3-5-haiku-20241022');

    expect(constructorConfigs.length).toBe(1);
    expect(constructorConfigs[0]?.maxRetries).toBe(0);
    const streamOpts = mockStream.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(streamOpts.timeout).toBe(STREAM_HEADERS_TIMEOUT_MS);
  });

  it('aborts a stream that goes silent so the lace retry loop can take over', async () => {
    // First attempt: a stream that never emits and never resolves — before the
    // fix this hangs until TCP gives up (~40 min observed). Second attempt: healthy.
    const silent = silentStreamRespectingAbort();
    mockStream
      .mockImplementationOnce((_payload: unknown, opts: { signal?: AbortSignal }) => {
        silent._setSignal(opts.signal);
        return silent;
      })
      .mockImplementationOnce(() => healthyStream('recovered'));

    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];
    const promise = provider.createStreamingResponse(messages, [], 'claude-3-5-haiku-20241022');
    promise.catch(() => {});

    // Just past the idle threshold (plus a watchdog poll) the silent stream is
    // aborted; then advance through the retry backoff to the healthy attempt.
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS + 15_000);
    expect(mockStream).toHaveBeenCalledTimes(2);

    const response = await promise;
    expect(response.content).toBe('recovered');
  });

  it('does not abort a stream that keeps emitting events past the idle threshold', async () => {
    const handlers: StreamHandlers = {};
    let resolveFinal!: (value: unknown) => void;
    // The stream MUST honor the abort signal, or this test cannot fail: an
    // over-eager watchdog would abort a controller nobody listens to and the
    // assertions would pass anyway.
    let abortSignal: AbortSignal | undefined;
    const stream = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        (handlers[event] ??= []).push(handler);
        return stream;
      }),
      finalMessage: vi.fn(
        () =>
          new Promise((resolve, reject) => {
            resolveFinal = resolve;
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
    mockStream.mockImplementation((_payload: unknown, opts: { signal?: AbortSignal }) => {
      abortSignal = opts.signal;
      return stream;
    });

    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];
    const promise = provider.createStreamingResponse(messages, [], 'claude-3-5-haiku-20241022');
    promise.catch(() => {});

    // Emit a stream event at ~80% of the idle threshold, twice: total elapsed
    // exceeds the threshold but the gap between events never does.
    const bump = Math.floor(STREAM_IDLE_TIMEOUT_MS * 0.8);
    await vi.advanceTimersByTimeAsync(bump);
    for (const h of handlers.streamEvent ?? []) h({ type: 'message_start' });
    await vi.advanceTimersByTimeAsync(bump);
    for (const h of handlers.streamEvent ?? []) h({ type: 'message_start' });

    expect(mockStream).toHaveBeenCalledTimes(1);

    resolveFinal({
      content: [{ type: 'text', text: 'slow but alive' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    });
    const response = await promise;
    expect(response.content).toBe('slow but alive');
  });

  it('propagates a caller abort through to the stream', async () => {
    const silent = silentStreamRespectingAbort();
    mockStream.mockImplementationOnce((_payload: unknown, opts: { signal?: AbortSignal }) => {
      silent._setSignal(opts.signal);
      return silent;
    });

    const controller = new AbortController();
    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];
    const promise = provider.createStreamingResponse(
      messages,
      [],
      'claude-3-5-haiku-20241022',
      controller.signal
    );
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected'
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await settled).toBe('rejected');
  });
});
