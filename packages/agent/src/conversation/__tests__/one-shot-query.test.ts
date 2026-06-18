// ABOUTME: Tests for the oneShotQuery kernel primitive
// ABOUTME: Verifies provider lifecycle (build + cleanup), response adaptation, and
// ABOUTME: that it uses the STREAMING provider path (non-streaming requests 400 with
// ABOUTME: "Streaming is required" when the model's default max_tokens is large).

import { describe, it, expect, vi } from 'vitest';
import type {
  AIProvider,
  ProviderMessage,
  ProviderResponse,
} from '@lace/agent/providers/base-provider';
import { oneShotQuery } from '../one-shot-query';

function makeStubProvider(opts: {
  responseContent: string;
  usage: NonNullable<ProviderResponse['usage']>;
  throwError?: Error;
}): AIProvider {
  const createStreamingResponse = opts.throwError
    ? vi.fn().mockRejectedValue(opts.throwError)
    : vi.fn().mockResolvedValue({
        content: opts.responseContent,
        toolCalls: [],
        usage: opts.usage,
      } satisfies Partial<ProviderResponse>);

  // Non-streaming path must NOT be used: it 400s ("Streaming is required") when
  // the chosen model's default max_tokens exceeds the non-streaming ceiling.
  const createResponse = vi
    .fn()
    .mockRejectedValue(
      new Error('Streaming is required for operations that may take longer than 10 minutes.')
    );

  const cleanup = vi.fn().mockResolvedValue(undefined);

  return {
    createResponse,
    createStreamingResponse,
    cleanup,
  } as unknown as AIProvider;
}

describe('oneShotQuery', () => {
  it('streams: resolves with text and usage, calls createStreamingResponse with empty tools and chosen model', async () => {
    const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const provider = makeStubProvider({ responseContent: 'SUMMARY', usage });
    const createProviderStub = vi.fn().mockResolvedValue(provider);

    const messages: ProviderMessage[] = [{ role: 'user', content: 'hi' }];
    const result = await oneShotQuery(
      { connectionId: 'c', model: 'm', messages },
      { createProviderForTurn: createProviderStub }
    );

    expect(result).toEqual({ text: 'SUMMARY', usage });
    expect(createProviderStub).toHaveBeenCalledWith({ connectionId: 'c', modelId: 'm' });
    expect(provider.createStreamingResponse).toHaveBeenCalledWith(messages, [], 'm', undefined);
    // Regression guard: never use the non-streaming path (it 400s on large max_tokens).
    expect(provider.createResponse).not.toHaveBeenCalled();
    expect(provider.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects when the streaming call throws, but still calls cleanup exactly once', async () => {
    const error = new Error('LLM failure');
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const provider = makeStubProvider({ responseContent: '', usage, throwError: error });
    const createProviderStub = vi.fn().mockResolvedValue(provider);

    const messages: ProviderMessage[] = [{ role: 'user', content: 'hi' }];
    await expect(
      oneShotQuery(
        { connectionId: 'c', model: 'm', messages },
        { createProviderForTurn: createProviderStub }
      )
    ).rejects.toThrow('LLM failure');

    expect(provider.cleanup).toHaveBeenCalledTimes(1);
  });

  it('forwards AbortSignal as the 4th argument to createStreamingResponse', async () => {
    const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const provider = makeStubProvider({ responseContent: 'OK', usage });
    const createProviderStub = vi.fn().mockResolvedValue(provider);

    const controller = new AbortController();
    const messages: ProviderMessage[] = [{ role: 'user', content: 'hi' }];
    await oneShotQuery(
      { connectionId: 'c', model: 'm', messages, signal: controller.signal },
      { createProviderForTurn: createProviderStub }
    );

    expect(provider.createStreamingResponse).toHaveBeenCalledWith(
      messages,
      [],
      'm',
      controller.signal
    );
  });
});
