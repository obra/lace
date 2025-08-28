import { describe, it, expect, beforeEach } from 'vitest';
import { BaseHelper } from './base-helper';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { AIProvider, ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { TestProvider } from '~/test-utils/test-provider';
import { ToolCall, ToolResult } from '~/tools/types';
import { z } from 'zod';

// Create a simple test tool
class TestTool extends Tool {
  name = 'test_tool';
  description = 'A tool for testing';
  schema = z.object({
    input: z.string(),
  });

  protected async executeValidated(args: { input: string }) {
    return this.createResult(`Processed: ${args.input}`);
  }
}

// Create a mock provider that supports multiple queued responses
class QueuedMockProvider extends TestProvider {
  private responseQueue: ProviderResponse[] = [];
  private responseIndex = 0;

  addMockResponse(response: Partial<ProviderResponse>): void {
    this.responseQueue.push({
      content: response.content || 'Mock response',
      toolCalls: response.toolCalls || [],
      usage: response.usage || { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      stopReason: response.stopReason || 'end_turn',
    });
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model?: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (this.responseIndex >= this.responseQueue.length) {
      throw new Error('No more mock responses available');
    }
    
    const response = this.responseQueue[this.responseIndex];
    this.responseIndex++;
    return response;
  }
}

// Create a concrete implementation for testing
class TestHelper extends BaseHelper {
  constructor(
    private provider: AIProvider,
    private toolExecutor: ToolExecutor,
    private tools: Tool[]
  ) {
    super();
  }

  protected async getProvider(): Promise<AIProvider> {
    return this.provider;
  }

  protected async getTools(): Promise<Tool[]> {
    return this.tools;
  }

  protected async getToolExecutor(): Promise<ToolExecutor> {
    return this.toolExecutor;
  }

  protected async getModel(): Promise<string> {
    return 'test-model';
  }

  protected async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    // Simple implementation for testing
    const results = [];
    for (const call of toolCalls) {
      const tool = this.tools.find(t => t.name === call.name);
      if (tool) {
        const result = await tool.execute(call.arguments);
        results.push(result);
      }
    }
    return results;
  }
}

describe('BaseHelper', () => {
  let helper: TestHelper;
  let provider: QueuedMockProvider;
  let toolExecutor: ToolExecutor;
  let testTool: TestTool;

  beforeEach(() => {
    provider = new QueuedMockProvider({
      modelId: 'test-model',
      config: {}
    });
    toolExecutor = new ToolExecutor();
    testTool = new TestTool();
    toolExecutor.registerTool(testTool.name, testTool);
    
    helper = new TestHelper(provider, toolExecutor, [testTool]);
  });

  describe('execute', () => {
    it('should handle simple prompt without tools', async () => {
      provider.addMockResponse({
        content: 'Hello! How can I help?',
        toolCalls: []
      });

      const result = await helper.execute('Say hello');

      expect(result.content).toBe('Hello! How can I help?');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.toolResults).toHaveLength(0);
    });

    it('should handle single tool call', async () => {
      // First response: LLM wants to use a tool
      provider.addMockResponse({
        content: 'I will use the test tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test data' }
        }]
      });

      // Second response: LLM processes tool result
      provider.addMockResponse({
        content: 'The tool processed: test data',
        toolCalls: []
      });

      const result = await helper.execute('Use the test tool');

      expect(result.content).toBe('The tool processed: test data');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('test_tool');
      expect(result.toolResults).toHaveLength(1);
    });

    it('should handle multiple tool calls in sequence', async () => {
      // First response: LLM wants to use a tool
      provider.addMockResponse({
        content: 'Using first tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'first' }
        }]
      });

      // Second response: LLM wants another tool
      provider.addMockResponse({
        content: 'Using second tool',
        toolCalls: [{
          id: 'call_2',
          name: 'test_tool',
          arguments: { input: 'second' }
        }]
      });

      // Final response: Done with tools
      provider.addMockResponse({
        content: 'Processed both: first and second',
        toolCalls: []
      });

      const result = await helper.execute('Use tools twice');

      expect(result.content).toBe('Processed both: first and second');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolResults).toHaveLength(2);
    });

    it('should throw on infinite loop', async () => {
      // Keep returning tool calls forever
      for (let i = 0; i < 15; i++) {
        provider.addMockResponse({
          content: `Tool call ${i}`,
          toolCalls: [{
            id: `call_${i}`,
            name: 'test_tool',
            arguments: { input: `data_${i}` }
          }]
        });
      }

      await expect(helper.execute('Infinite loop')).rejects.toThrow(
        'Helper exceeded maximum turns'
      );
    });

    it('should handle abort signal', async () => {
      const controller = new AbortController();
      
      provider.addMockResponse({
        content: 'Starting',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      // Abort during execution
      setTimeout(() => controller.abort(), 10);

      await expect(
        helper.execute('Test abort', controller.signal)
      ).rejects.toThrow();
    });
  });
});