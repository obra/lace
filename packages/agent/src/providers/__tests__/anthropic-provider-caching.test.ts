// ABOUTME: Tests for prompt caching format in AnthropicProvider
// ABOUTME: Verifies provider formats system prompt and tools with cache_control for Anthropic's caching feature

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolResult, ToolContext } from '@lace/agent/tools/types';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';

// Mock external Anthropic SDK
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

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
  },
}));

// Mock provider logging
vi.mock('../../utils/provider-logging.js', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

describe('AnthropicProvider caching format', () => {
  let provider: AnthropicProvider;
  let mockTool: Tool;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new AnthropicProvider({
      apiKey: 'test-key',
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

  it('should format system prompt with cache_control for caching', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'Test response' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const messages = [{ role: 'user' as const, content: 'Hello' }];

    await provider.createResponse(messages, [mockTool], 'claude-sonnet-4-20250514');

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;

    // System prompt should be an array with cache_control
    expect(Array.isArray(callArgs.system)).toBe(true);
    const systemBlocks = callArgs.system as Array<{
      type: string;
      text: string;
      cache_control?: { type: string };
    }>;
    expect(systemBlocks).toHaveLength(1);
    expect(systemBlocks[0].type).toBe('text');
    expect(systemBlocks[0].text).toBe('Test system prompt');
    expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('should add cache_control to the last tool for caching', async () => {
    // Create a second mock tool
    class SecondTool extends Tool {
      name = 'second_tool';
      description = 'Another test tool';
      schema = z.object({
        value: z.string().describe('A value'),
      });

      protected async executeValidated(
        args: { value: string },
        _context: ToolContext
      ): Promise<ToolResult> {
        return await Promise.resolve(this.createResult(`Value: ${args.value}`));
      }
    }
    const secondTool = new SecondTool();

    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'Test response' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const messages = [{ role: 'user' as const, content: 'Hello' }];

    await provider.createResponse(messages, [mockTool, secondTool], 'claude-sonnet-4-20250514');

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;

    // First tool should NOT have cache_control
    expect(callArgs.tools![0]).not.toHaveProperty('cache_control');

    // Last tool SHOULD have cache_control
    expect(callArgs.tools![1]).toHaveProperty('cache_control');
    expect((callArgs.tools![1] as { cache_control?: { type: string } }).cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
  });

  it('should add cache_control to single tool when only one tool provided', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'Test response' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const messages = [{ role: 'user' as const, content: 'Hello' }];

    await provider.createResponse(messages, [mockTool], 'claude-sonnet-4-20250514');

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;

    // Single tool should have cache_control
    expect(callArgs.tools![0]).toHaveProperty('cache_control');
    expect((callArgs.tools![0] as { cache_control?: { type: string } }).cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
  });

  it('should handle empty tools array without error', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'Test response' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const messages = [{ role: 'user' as const, content: 'Hello' }];

    await provider.createResponse(messages, [], 'claude-sonnet-4-20250514');

    const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;

    // Empty tools should work fine
    expect(callArgs.tools).toEqual([]);
  });
});
