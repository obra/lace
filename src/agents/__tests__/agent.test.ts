// ABOUTME: Tests for the refactored Agent class with provider abstraction
// ABOUTME: Verifies agent functionality with different AI providers

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../agent.js';
import { AIProvider, ProviderMessage, ProviderResponse } from '../../providers/types.js';
import { Tool, ToolContext } from '../../tools/types.js';

// Mock provider for testing
class MockProvider extends AIProvider {
  constructor(private mockResponse: ProviderResponse) {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return this.mockResponse;
  }
}

describe('Agent', () => {
  let mockProvider: MockProvider;
  let agent: Agent;

  beforeEach(() => {
    mockProvider = new MockProvider({
      content: 'Test response',
      toolCalls: [],
    });
    agent = new Agent({ provider: mockProvider });
  });

  describe('constructor', () => {
    it('should accept a provider in config', () => {
      expect(agent.providerName).toBe('mock');
    });
  });

  describe('createResponse', () => {
    it('should delegate to provider', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const response = await agent.createResponse(messages);

      expect(response.content).toBe('Test response');
      expect(response.toolCalls).toEqual([]);
    });

    it('should pass tools to provider', async () => {
      const createResponseSpy = vi.spyOn(mockProvider, 'createResponse');

      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const tools: Tool[] = [
        {
          name: 'test_tool',
          description: 'Test tool',
          input_schema: { type: 'object', properties: {}, required: [] },
          executeTool: async (_input: Record<string, unknown>, _context?: ToolContext) => ({
            success: true,
            content: [{ type: 'text' as const, text: 'test result' }],
          }),
        },
      ];

      await agent.createResponse(messages, tools);

      expect(createResponseSpy).toHaveBeenCalledWith(messages, tools);
    });

    it('should handle tool calls in response', async () => {
      const providerWithTools = new MockProvider({
        content: 'I will use a tool',
        toolCalls: [
          {
            id: 'call_123',
            name: 'test_tool',
            input: { param: 'value' },
          },
        ],
      });

      const agentWithTools = new Agent({ provider: providerWithTools });

      const response = await agentWithTools.createResponse([
        { role: 'user', content: 'Use a tool' },
      ]);

      expect(response.content).toBe('I will use a tool');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0].name).toBe('test_tool');
      expect(response.toolCalls[0].input).toEqual({ param: 'value' });
    });

    it('should handle empty tools array', async () => {
      const response = await agent.createResponse([{ role: 'user', content: 'Hello' }], []);

      expect(response.content).toBe('Test response');
    });
  });

  describe('providerName', () => {
    it('should return provider name', () => {
      expect(agent.providerName).toBe('mock');
    });
  });
});
