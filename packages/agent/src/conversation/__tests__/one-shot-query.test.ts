// ABOUTME: Tests for the oneShotQuery kernel primitive
// ABOUTME: Verifies provider lifecycle (build + cleanup) and response adaptation

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
  const createResponse = opts.throwError
    ? vi.fn().mockRejectedValue(opts.throwError)
    : vi.fn().mockResolvedValue({
        content: opts.responseContent,
        toolCalls: [],
        usage: opts.usage,
      } satisfies Partial<ProviderResponse>);

  const cleanup = vi.fn().mockResolvedValue(undefined);

  return {
    createResponse,
    cleanup,
  } as unknown as AIProvider;
}

describe('oneShotQuery', () => {
  it('resolves with text and usage, calls createResponse with empty tools and chosen model', async () => {
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
    expect(provider.createResponse).toHaveBeenCalledWith(messages, [], 'm', undefined);
    expect(provider.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects when createResponse throws, but still calls cleanup exactly once', async () => {
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

  it('forwards AbortSignal as the 4th argument to createResponse', async () => {
    const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const provider = makeStubProvider({ responseContent: 'OK', usage });
    const createProviderStub = vi.fn().mockResolvedValue(provider);

    const controller = new AbortController();
    const messages: ProviderMessage[] = [{ role: 'user', content: 'hi' }];
    await oneShotQuery(
      { connectionId: 'c', model: 'm', messages, signal: controller.signal },
      { createProviderForTurn: createProviderStub }
    );

    expect(provider.createResponse).toHaveBeenCalledWith(messages, [], 'm', controller.signal);
  });
});
