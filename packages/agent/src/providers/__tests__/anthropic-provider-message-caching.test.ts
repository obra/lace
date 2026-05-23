// ABOUTME: Tests for message-level cache_control breakpoints in AnthropicProvider
// ABOUTME: Verifies cache_control is attached to the last message content block with 1h TTL

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolResult, ToolContext } from '@lace/agent/tools/types';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';

const mockCreateResponse = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreateResponse,
        stream: vi.fn(),
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
