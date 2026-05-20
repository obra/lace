// ABOUTME: Tests for BedrockProvider - Claude via AWS Bedrock
// ABOUTME: Mirrors the AnthropicProvider tests against the bedrock-sdk client

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BedrockProvider } from './bedrock-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolResult, ToolContext } from '@lace/agent/tools/types';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';

// Mock functions shared with the SDK mock below
const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockConstructor = vi.fn();

vi.mock('@anthropic-ai/bedrock-sdk', () => {
  class MockAnthropicBedrock {
    constructor(opts: unknown) {
      mockConstructor(opts);
    }
    messages = {
      create: mockCreate,
      stream: mockStream,
    };
  }
  return {
    AnthropicBedrock: MockAnthropicBedrock,
    default: MockAnthropicBedrock,
  };
});

const MODEL = 'anthropic.claude-sonnet-4-5-20250929-v1:0';

describe('BedrockProvider', () => {
  let provider: BedrockProvider;
  let mockTool: Tool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    mockStream.mockReset();
    mockConstructor.mockReset();

    provider = new BedrockProvider({
      awsRegion: 'us-west-1',
      awsAccessKeyId: 'AKIATEST',
      awsSecretAccessKey: 'secret',
    });
    provider.setSystemPrompt('Test system prompt');

    class TestTool extends Tool {
      name = 'test_tool';
      description = 'A test tool';
      schema = z.object({
        action: z.string().describe('Action to perform'),
      });

      protected async executeValidated(
        args: { action: string },
        _context: ToolContext
      ): Promise<ToolResult> {
        return await Promise.resolve(this.createResult(`Executed action: ${args.action}`));
      }
    }
    mockTool = new TestTool();
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('basic properties', () => {
    it('reports its provider name as bedrock', () => {
      expect(provider.providerName).toBe('bedrock');
    });

    it('supports streaming', () => {
      expect(provider.supportsStreaming).toBe(true);
    });

    it('exposes the system prompt', () => {
      expect(provider.systemPrompt).toBe('Test system prompt');
    });

    it('reports configured when explicit creds are provided', () => {
      expect(provider.isConfigured()).toBe(true);
    });

    it('reports configured when only region is supplied (default credential chain)', () => {
      const p = new BedrockProvider({ awsRegion: 'us-west-1' });
      expect(p.isConfigured()).toBe(true);
    });

    it('reports not configured when no region is supplied', () => {
      const p = new BedrockProvider({});
      expect(p.isConfigured()).toBe(false);
    });
  });

  describe('client construction', () => {
    it('passes explicit AWS credentials to the SDK', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await provider.createResponse([{ role: 'user', content: 'hi' }], [], MODEL);

      expect(mockConstructor).toHaveBeenCalledTimes(1);
      const opts = mockConstructor.mock.calls[0][0] as Record<string, unknown>;
      expect(opts).toMatchObject({
        awsRegion: 'us-west-1',
        awsAccessKey: 'AKIATEST',
        awsSecretKey: 'secret',
      });
    });

    it('omits AWS credential fields when only region is supplied', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      const p = new BedrockProvider({ awsRegion: 'us-west-1' });
      p.setSystemPrompt('s');
      await p.createResponse([{ role: 'user', content: 'hi' }], [], MODEL);

      const opts = mockConstructor.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.awsRegion).toBe('us-west-1');
      expect(opts.awsAccessKey).toBeUndefined();
      expect(opts.awsSecretKey).toBeUndefined();
      expect(opts.awsSessionToken).toBeUndefined();
    });

    it('throws when no region is configured at request time', async () => {
      const p = new BedrockProvider({});
      p.setSystemPrompt('s');
      // Defeat retries so the error surfaces immediately
      p.RETRY_CONFIG = { initialDelayMs: 1, maxDelayMs: 2 };

      await expect(p.createResponse([{ role: 'user', content: 'hi' }], [], MODEL)).rejects.toThrow(
        /region/i
      );
    });
  });

  describe('non-streaming responses', () => {
    it('returns text content from a basic response', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Test response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      const response = await provider.createResponse(
        [{ role: 'user', content: 'Hello' }],
        [mockTool],
        MODEL
      );

      expect(response.content).toBe('Test response');
      expect(response.toolCalls).toEqual([]);
      expect(response.stopReason).toBe('stop');
      expect(response.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('extracts tool_use blocks into toolCalls', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Using tool' },
          {
            type: 'tool_use',
            id: 'call_123',
            name: 'test_tool',
            input: { action: 'test' },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'tool_use',
      });

      const response = await provider.createResponse(
        [{ role: 'user', content: 'Use tool' }],
        [mockTool],
        MODEL
      );

      expect(response.content).toBe('Using tool');
      expect(response.stopReason).toBe('tool_use');
      expect(response.toolCalls).toEqual([
        { id: 'call_123', name: 'test_tool', arguments: { action: 'test' } },
      ]);
    });

    it('sends system message as cache-controlled block array and filters system from messages', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await provider.createResponse(
        [
          { role: 'system', content: 'System message' },
          { role: 'user', content: 'User message' },
          { role: 'assistant', content: 'Assistant message' },
        ],
        [],
        MODEL
      );

      const callArgs = mockCreate.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
      expect(callArgs.messages).toEqual([
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' },
      ]);
      expect(Array.isArray(callArgs.system)).toBe(true);
      const systemBlocks = callArgs.system as Array<{
        type: string;
        text: string;
        cache_control?: { type: string };
      }>;
      expect(systemBlocks[0].text).toBe('System message');
      expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('uses Bedrock-style model IDs verbatim', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await provider.createResponse([{ role: 'user', content: 'hi' }], [], MODEL);

      const callArgs = mockCreate.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
      expect(callArgs.model).toBe(MODEL);
    });
  });

  describe('streaming responses', () => {
    interface MockStream {
      on: ReturnType<typeof vi.fn>;
      finalMessage: ReturnType<typeof vi.fn>;
    }
    let stream: MockStream;

    beforeEach(() => {
      stream = {
        on: vi.fn().mockReturnThis() as ReturnType<typeof vi.fn>,
        finalMessage: vi.fn(),
      };
      mockStream.mockReturnValue(stream);
    });

    it('returns content from the final message after streaming completes', async () => {
      stream.finalMessage.mockResolvedValue({
        content: [{ type: 'text', text: 'Streaming complete' }],
        usage: { input_tokens: 15, output_tokens: 8 },
        stop_reason: 'end_turn',
      });

      const response = await provider.createStreamingResponse(
        [{ role: 'user', content: 'Stream' }],
        [],
        MODEL
      );

      expect(response.content).toBe('Streaming complete');
      expect(response.usage).toEqual({
        promptTokens: 15,
        completionTokens: 8,
        totalTokens: 23,
      });
    });

    it('emits token events as the SDK fires text events', async () => {
      stream.finalMessage.mockResolvedValue({
        content: [{ type: 'text', text: 'Complete' }],
        usage: { input_tokens: 0, output_tokens: 0 },
        stop_reason: 'end_turn',
      });

      const tokens: string[] = [];
      provider.on('token', ({ token }: { token: string }) => tokens.push(token));

      const promise = provider.createStreamingResponse(
        [{ role: 'user', content: 'Stream' }],
        [],
        MODEL
      );

      const textHandler = stream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'text'
      )?.[1] as (t: string) => void;
      textHandler('Hello ');
      textHandler('world');

      await promise;

      expect(tokens).toEqual(['Hello ', 'world']);
    });
  });

  describe('retry behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      provider.on('error', () => {});
      provider.on('retry_attempt', () => {});
      provider.on('retry_exhausted', () => {});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries on transient network errors', async () => {
      mockCreate.mockRejectedValueOnce({ code: 'ECONNREFUSED' }).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello there!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      const promise = provider.createResponse([{ role: 'user', content: 'Hello' }], [], MODEL);
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(mockCreate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(response.content).toBe('Hello there!');
    });

    it('does not retry on auth errors', async () => {
      const authError = { status: 401, message: 'Invalid credentials' };
      mockCreate.mockRejectedValue(authError);

      await expect(
        provider.createResponse([{ role: 'user', content: 'Hello' }], [], MODEL)
      ).rejects.toEqual(authError);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProviderInfo', () => {
    it('describes itself as the Bedrock provider', () => {
      const info = provider.getProviderInfo();
      expect(info.name).toBe('bedrock');
      expect(info.displayName).toMatch(/bedrock/i);
      expect(info.requiresApiKey).toBe(false);
    });
  });
});
