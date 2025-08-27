import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InfrastructureHelper } from './infrastructure-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderRegistry } from '~/providers/registry';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { Tool } from '~/tools/tool';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { z } from 'zod';
import * as fs from 'fs';

// Mock modules
vi.mock('fs');
vi.mock('~/config/global-config');
vi.mock('~/providers/registry');

// Create a mock provider that supports multiple queued responses
class QueuedMockProvider extends TestProvider {
  private responseQueue: ProviderResponse[] = [];
  private responseIndex = 0;

  addMockResponse(response: Partial<ProviderResponse>): void {
    this.responseQueue.push({
      content: response.content || 'Mock response',
      toolCalls: response.toolCalls || [],
      usage: response.usage || { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      stopReason: response.stopReason || 'stop',
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

class TestTool extends Tool {
  name = 'test_tool';
  description = 'Test tool';
  schema = z.object({ input: z.string() });
  
  protected async executeValidated(args: { input: string }) {
    return this.createResult(`Result: ${args.input}`);
  }
}

class UnapprovedTool extends Tool {
  name = 'unapproved_tool';
  description = 'Tool not in whitelist';
  schema = z.object({ input: z.string() });
  
  protected async executeValidated(args: { input: string }) {
    return this.createResult(`Should not execute`);
  }
}

describe('InfrastructureHelper', () => {
  let toolExecutor: ToolExecutor;
  let testTool: TestTool;
  let unapprovedTool: UnapprovedTool;
  let mockProvider: QueuedMockProvider;

  beforeEach(() => {
    // Setup tool executor with test tools
    toolExecutor = new ToolExecutor();
    testTool = new TestTool();
    unapprovedTool = new UnapprovedTool();
    toolExecutor.registerTool(testTool.name, testTool);
    toolExecutor.registerTool(unapprovedTool.name, unapprovedTool);

    // Mock global config
    vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValue('test-instance:test-model');

    // Setup mock provider
    mockProvider = new QueuedMockProvider({});

    // Mock provider registry
    const mockRegistry = {
      createProviderFromInstanceAndModel: vi.fn().mockResolvedValue(mockProvider)
    };
    vi.mocked(ProviderRegistry.getInstance).mockReturnValue(mockRegistry as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with required options', () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });
      expect(helper).toBeDefined();
    });

    it('should create with optional context', () => {
      const helper = new InfrastructureHelper({
        model: 'smart',
        tools: ['test_tool'],
        workingDirectory: '/test/dir',
        processEnv: { TEST: 'value' }
      });
      expect(helper).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute with whitelisted tools only', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool'] // Only test_tool is allowed
      });

      // Set tool executor on helper (normally done in constructor)
      helper['toolExecutor'] = toolExecutor;

      // Mock provider responses
      mockProvider.addMockResponse({
        content: 'I will use both tools',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            arguments: { input: 'allowed' }
          },
          {
            id: 'call_2', 
            name: 'unapproved_tool',
            arguments: { input: 'not allowed' }
          }
        ]
      });

      mockProvider.addMockResponse({
        content: 'Done with tools',
        toolCalls: []
      });

      const result = await helper.execute('Test tool whitelist');

      // Should execute allowed tool
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolResults).toHaveLength(2);
      
      // First tool should succeed
      expect(result.toolResults[0].status).toBe('completed');
      
      // Second tool should be denied
      expect(result.toolResults[1].status).toBe('failed');
      expect(result.toolResults[1].content[0].text).toContain('not in whitelist');
    });

    it('should bypass approval for whitelisted tools', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });
      helper['toolExecutor'] = toolExecutor;

      // Spy on executeApprovedTool to verify it's called directly
      const executeSpy = vi.spyOn(toolExecutor, 'executeApprovedTool');

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: []
      });

      await helper.execute('Test bypass approval');

      // Should call executeApprovedTool directly (bypassing approval)
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test_tool' }),
        expect.any(Object)
      );
    });
  });
});