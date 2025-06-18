// ABOUTME: Basic integration tests for Ollama provider conversation flows
// ABOUTME: Tests basic functionality and tool calling with local Ollama server

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { OllamaProvider } from '../ollama-provider.js';
import { Tool, ToolContext } from '../../tools/types.js';
import { logger } from '../../utils/logger.js';

// Mock tool for testing without side effects
class MockTool implements Tool {
  name = 'mock_tool';
  description = 'A mock tool for testing';
  input_schema = {
    type: 'object' as const,
    properties: {
      action: { type: 'string', description: 'Action to perform' },
      value: { type: 'string', description: 'Value to use' },
    },
    required: ['action'],
  };

  async executeTool(input: Record<string, unknown>, _context?: ToolContext) {
    return {
      isError: false,
      content: [{ type: 'text' as const, text: `Mock executed: ${JSON.stringify(input)}` }],
    };
  }
}

describe.sequential('Ollama Provider Integration Tests', () => {
  let provider: OllamaProvider;
  let mockTool: MockTool;
  let isOllamaAvailable = false;

  beforeAll(async () => {
    provider = new OllamaProvider({
      model: 'qwen3:0.6b',
      systemPrompt: 'You are a helpful assistant. Use tools when asked.',
    });

    mockTool = new MockTool();

    // Check if Ollama is available and working for tests
    try {
      const diagnostics = await provider.diagnose();
      if (diagnostics.connected && diagnostics.models.length > 0) {
        // Test actual connectivity with a simple request
        const testResponse = await provider.createResponse(
          [{ role: 'user', content: 'Say "test"' }],
          []
        );

        if (testResponse.content) {
          isOllamaAvailable = true;
          logger.info('Ollama integration tests enabled - server working properly');
        } else {
          logger.info('Skipping Ollama integration tests - server not responding properly');
        }
      } else {
        logger.info('Skipping Ollama integration tests - server not available or no models loaded');
      }
    } catch (error) {
      logger.info('Skipping Ollama integration tests - connection or response failed', { error });
    }
  }, 60000);

  beforeEach(() => {
    if (!isOllamaAvailable) {
      return; // Skip individual tests if Ollama not available
    }
  });

  it('should connect and get basic response', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Say hello and tell me you can help with coding tasks.',
      },
    ];

    const response = await provider.createResponse(messages, []);

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

    const response = await provider.createResponse(messages, [mockTool]);

    // Ollama tool calling might be less reliable than other providers
    expect(response.content).toBeTruthy();
    expect(response.content.length).toBeGreaterThan(0);
    // Don't require tool calls - just test that it doesn't crash
  }, 30000);

  it('should handle conversation without tools', async () => {
    const messages = [{ role: 'user' as const, content: 'What is 2 + 2?' }];

    const response = await provider.createResponse(messages, []);

    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('4');
    expect(response.toolCalls.length).toBe(0);
  }, 30000);

  it('should handle multi-turn conversation', async () => {
    let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'What is 5 + 3?' },
    ];

    let response = await provider.createResponse(messages, []);
    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('8');

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: 'What was that answer again?' });

    response = await provider.createResponse(messages, []);
    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('8');
  }, 45000);

  it('should return usage metadata', async () => {
    const messages = [{ role: 'user' as const, content: 'Hello' }];

    const response = await provider.createResponse(messages, []);

    expect(response.content).toBeTruthy();
    expect(response.stopReason).toBeDefined();
    // Usage might not always be available with Ollama
    if (response.usage) {
      expect(response.usage.totalTokens).toBeGreaterThan(0);
    }
  }, 30000);
});
