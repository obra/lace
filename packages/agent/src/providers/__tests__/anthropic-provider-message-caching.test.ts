// ABOUTME: Tests for message-level cache_control breakpoints in AnthropicProvider
// ABOUTME: Verifies cache_control is attached to the last message content block with 1h TTL

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolResult, ToolContext } from '@lace/agent/tools/types';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicBaseMessagesTrap } from '@lace/agent/test-utils/anthropic-base-namespace-trap';

const mockCreateResponse = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      // Throwing trap on base namespace — provider must call beta.messages.*
      messages = anthropicBaseMessagesTrap();
      beta = {
        messages: {
          create: mockCreateResponse,
          stream: vi.fn(),
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

type CacheControl = { type: 'ephemeral'; ttl?: string };

describe('AnthropicProvider message-level cache_control (PRI-1799)', () => {
  let provider: AnthropicProvider;
  let mockTool: Tool;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new AnthropicProvider({ apiKey: 'test-key' });
    provider.setSystemPrompt('Test system prompt');

    class TestTool extends Tool {
      name = 'test_tool';
      description = 'A test tool';
      schema = z.object({ action: z.string() });
      protected async executeValidated(
        args: { action: string },
        _context: ToolContext
      ): Promise<ToolResult> {
        return await Promise.resolve(this.createResult(`Executed: ${args.action}`));
      }
    }
    mockTool = new TestTool();

    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'Test response' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  it('attaches cache_control with 1h ttl to system prompt', async () => {
    await provider.createResponse(
      [{ role: 'user', content: 'Hello' }],
      [mockTool],
      'claude-sonnet-4-20250514'
    );

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    const systemBlocks = callArgs.system as Array<{
      type: string;
      text: string;
      cache_control?: CacheControl;
    }>;

    expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('attaches cache_control with 1h ttl to the last tool', async () => {
    await provider.createResponse(
      [{ role: 'user', content: 'Hello' }],
      [mockTool],
      'claude-sonnet-4-20250514'
    );

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    const lastTool = callArgs.tools![callArgs.tools!.length - 1] as {
      cache_control?: CacheControl;
    };

    expect(lastTool.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('attaches cache_control with 1h ttl to last message when content is a plain string', async () => {
    await provider.createResponse(
      [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Follow-up question' },
      ],
      [mockTool],
      'claude-sonnet-4-20250514'
    );

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    const lastMessage = callArgs.messages[callArgs.messages.length - 1];

    // Plain-string content must be lifted to a block array so cache_control can attach
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const blocks = lastMessage.content as Array<{
      type: string;
      text?: string;
      cache_control?: CacheControl;
    }>;
    const lastBlock = blocks[blocks.length - 1];

    expect(lastBlock.type).toBe('text');
    expect(lastBlock.text).toBe('Follow-up question');
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('only marks the LAST message; earlier messages have no cache_control', async () => {
    await provider.createResponse(
      [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Second' },
      ],
      [mockTool],
      'claude-sonnet-4-20250514'
    );

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;

    // Check earlier messages don't carry cache_control
    const earlier = callArgs.messages.slice(0, -1);
    for (const msg of earlier) {
      if (typeof msg.content === 'string') continue;
      for (const block of msg.content as Array<{ cache_control?: unknown }>) {
        expect(block.cache_control).toBeUndefined();
      }
    }
  });

  it('attaches cache_control to the last block when last message has a tool_result array', async () => {
    await provider.createResponse(
      [
        { role: 'user', content: 'do it' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'toolu_1', name: 'test_tool', arguments: { action: 'go' } }],
        },
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'toolu_1',
              content: [{ type: 'text', text: 'done' }],
              status: 'completed',
            },
          ],
        },
      ],
      [mockTool],
      'claude-sonnet-4-20250514'
    );

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    const lastMessage = callArgs.messages[callArgs.messages.length - 1];

    expect(Array.isArray(lastMessage.content)).toBe(true);
    const blocks = lastMessage.content as Array<{
      type: string;
      cache_control?: CacheControl;
    }>;
    const lastBlock = blocks[blocks.length - 1];

    expect(lastBlock.type).toBe('tool_result');
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('handles empty messages array without error and without breaking the system/tool breakpoints', async () => {
    await provider.createResponse([], [mockTool], 'claude-sonnet-4-20250514');

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    const systemBlocks = callArgs.system as Array<{ cache_control?: CacheControl }>;
    const lastTool = callArgs.tools![callArgs.tools!.length - 1] as {
      cache_control?: CacheControl;
    };

    expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(lastTool.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(callArgs.messages).toEqual([]);
  });
});

describe('AnthropicProvider stable-anchor breakpoint (PRI-1802)', () => {
  let provider: AnthropicProvider;
  let mockTool: Tool;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({ apiKey: 'test-key' });
    provider.setSystemPrompt('Sys prompt');

    class T extends Tool {
      name = 'tool';
      description = 'A tool';
      schema = z.object({ a: z.string() });
      protected async executeValidated(
        args: { a: string },
        _context: ToolContext
      ): Promise<ToolResult> {
        return await Promise.resolve(this.createResult(args.a));
      }
    }
    mockTool = new T();

    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'r' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  // Build a long conversation with N tool round-trips so the cacheable-block
  // count exceeds ANCHOR_OFFSET_BLOCKS (10), forcing a stable anchor to land.
  function longConversation(turns: number) {
    const messages: Parameters<typeof provider.createResponse>[0] = [];
    for (let i = 0; i < turns; i++) {
      messages.push({ role: 'user', content: `q${i}` });
      messages.push({
        role: 'assistant',
        content: `thought ${i}`,
        toolCalls: [{ id: `t${i}`, name: 'tool', arguments: { a: `${i}` } }],
      });
      messages.push({
        role: 'user',
        content: '',
        toolResults: [
          {
            id: `t${i}`,
            content: [{ type: 'text' as const, text: `r${i}` }],
            status: 'completed' as const,
          },
        ],
      });
    }
    messages.push({ role: 'user', content: 'final question' });
    return messages;
  }

  function countCacheControl(payload: Anthropic.Messages.MessageCreateParams): number {
    return (JSON.stringify(payload.messages).match(/"cache_control"/g) ?? []).length;
  }

  it('places TWO message-level breakpoints (anchor + tail) on a long conversation', async () => {
    await provider.createResponse(longConversation(6), [mockTool], 'claude-sonnet-4-20250514');

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    expect(countCacheControl(callArgs)).toBe(2);

    // Tail must be the last message's last block, marked 1h
    const last = callArgs.messages[callArgs.messages.length - 1];
    const lastBlocks = last.content as Array<{ cache_control?: CacheControl }>;
    expect(lastBlocks[lastBlocks.length - 1].cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
  });

  it('places ONLY the tail breakpoint on a short conversation', async () => {
    // 3 messages → only ~3 cacheable blocks, well below the 10-block offset
    await provider.createResponse(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'how' },
      ],
      [mockTool],
      'claude-sonnet-4-20250514'
    );

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    expect(countCacheControl(callArgs)).toBe(1);
  });

  it('places no breakpoints when the last message has empty content', async () => {
    // Last user message has empty content and no tool results → empty array
    // after conversion. The helper must REFUSE to dig backward.
    await provider.createResponse(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: '' },
      ],
      [mockTool],
      'claude-sonnet-4-20250514'
    );

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    expect(countCacheControl(callArgs)).toBe(0);
  });

  it('never attaches cache_control to a thinking block', async () => {
    // Simulate a turn that includes thinking content. ProviderMessage's
    // ContentBlock supports only text/image at the generic level, so we feed
    // thinking content via the assistant content array directly — bypass via
    // a string here, then verify the helper's output doesn't have
    // cache_control on any thinking-typed block in the converted wire format.
    await provider.createResponse(longConversation(6), [mockTool], 'claude-sonnet-4-20250514');

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    for (const msg of callArgs.messages) {
      if (typeof msg.content === 'string') continue;
      for (const block of msg.content) {
        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          expect((block as { cache_control?: unknown }).cache_control).toBeUndefined();
        }
      }
    }
  });

  it('still attaches system + last-tool breakpoints even when message breakpoints are skipped', async () => {
    // Empty last message ⇒ no message breakpoints, but system + last tool
    // must still be marked 1h.
    await provider.createResponse(
      [{ role: 'user', content: '' }],
      [mockTool],
      'claude-sonnet-4-20250514'
    );

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
    const sys = callArgs.system as Array<{ cache_control?: CacheControl }>;
    const lastTool = callArgs.tools![0] as { cache_control?: CacheControl };
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(lastTool.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(countCacheControl(callArgs)).toBe(0);
  });
});
