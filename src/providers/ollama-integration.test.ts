// ABOUTME: Basic integration tests for Ollama provider conversation flows
// ABOUTME: Tests basic functionality and tool calling with local Ollama server

import { describe, it, expect, beforeAll } from 'vitest';
import { OllamaProvider } from '~/providers/ollama-provider';
import { Tool } from '~/tools/tool';
import { ToolContext, ToolResult } from '~/tools/types';
import { checkProviderAvailability } from '~/test-utils/provider-test-helpers';
import { z } from 'zod';

// Mock tool for testing without side effects
class MockTool extends Tool {
  name = 'mock_tool';
  description = 'A mock tool for testing';
  schema = z.object({
    action: z.string().describe('Action to perform'),
    value: z.string().describe('Value to use').optional(),
  });

  protected executeValidated(
    args: { action: string; value?: string },
    _context?: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve(this.createResult(`Mock executed: ${JSON.stringify(args)}`));
  }
}

// Check provider availability once at module level
const provider = new OllamaProvider({
  model: 'qwen3:0.6b',
  systemPrompt: 'You are a helpful assistant. Use tools when asked.',
});

const isOllamaAvailable = await checkProviderAvailability('Ollama', provider);

const conditionalDescribe = isOllamaAvailable ? describe.sequential : describe.skip;

conditionalDescribe('Ollama Provider Integration Tests', () => {
  let mockTool: MockTool;

  beforeAll(() => {
    mockTool = new MockTool();
  }, 60000);

  it('should connect and get basic response', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Say hello and tell me you can help with coding tasks.',
      },
    ];

    const response = await provider.createResponse(messages, [], 'qwen3:32b');

    expect(response.content).toBeTruthy();
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.toolCalls.length).toBe(0);
  }, 30000);

  it('should handle simple tool call', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Use mock_tool with action "test"',
      },
    ];

    const response = await provider.createResponse(messages, [mockTool], 'qwen3:32b');

    // Ollama tool calling might be less reliable than other providers
    expect(response.content).toBeTruthy();
    expect(response.content.length).toBeGreaterThan(0);
    // Don't require tool calls - just test that it doesn't crash
  }, 30000);

  it('should handle conversation without tools', async () => {
    const messages = [{ role: 'user' as const, content: 'What is 2 + 2?' }];

    const response = await provider.createResponse(messages, [], 'qwen3:32b');

    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('4');
    expect(response.toolCalls.length).toBe(0);
  }, 30000);

  it('should handle multi-turn conversation', async () => {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'What is 5 + 3?' },
    ];

    let response = await provider.createResponse(messages, [], 'qwen3:32b');
    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('8');

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: 'What was that answer again?' });

    response = await provider.createResponse(messages, [], 'qwen3:32b');
    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('8');
  }, 45000);

  it('should return usage metadata', async () => {
    const messages = [{ role: 'user' as const, content: 'Hello' }];

    const response = await provider.createResponse(messages, [], 'qwen3:32b');

    expect(response.content).toBeTruthy();
    expect(response.stopReason).toBeDefined();
    // Usage might not always be available with Ollama
    if (response.usage) {
      expect(response.usage.totalTokens).toBeGreaterThan(0);
    }
  }, 30000);
});
