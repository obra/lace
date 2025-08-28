// ABOUTME: Tests InfrastructureHelper provider resolution, whitelist enforcement, error/abort handling, and model tier mapping
// ABOUTME: Validates tool blocking, bypass approval, custom working directory, and graceful error handling
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InfrastructureHelper } from './infrastructure-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { Tool } from '~/tools/tool';
import type { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { z } from 'zod';

// Mock modules
vi.mock('~/config/global-config');
vi.mock('~/providers/instance/manager');

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
  
  protected async executeValidated(_args: { input: string }) {
    return this.createResult(`Result: ${_args.input}`);
  }
}

class UnapprovedTool extends Tool {
  name = 'unapproved_tool';
  description = 'Tool not in whitelist';
  schema = z.object({ input: z.string() });
  
  protected async executeValidated(_args: { input: string }) {
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

    // Mock provider instance manager
    const mockInstanceManager: Pick<InstanceType<typeof ProviderInstanceManager>, 'getInstance'> = {
      getInstance: vi.fn().mockResolvedValue(mockProvider)
    };
    vi.mocked(ProviderInstanceManager).mockImplementation(() => mockInstanceManager as InstanceType<typeof ProviderInstanceManager>);
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
    it('should block non-whitelisted tools', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: [] // Empty whitelist - all tools blocked
      });

      // Mock provider response with tool call
      mockProvider.addMockResponse({
        content: 'I will try to use a tool',
        toolCalls: [
          {
            id: 'call_1',
            name: 'some_tool',
            arguments: { input: 'test' }
          }
        ]
      });

      mockProvider.addMockResponse({
        content: 'Tool was blocked',
        toolCalls: []
      });

      const result = await helper.execute('Test tool blocking');

      // Tool should be blocked
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].status).toBe('failed');
      expect(result.toolResults[0].content[0].text).toContain('not in whitelist');
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

    it('should use custom working directory in tool context', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool'],
        workingDirectory: '/custom/work/dir'
      });
      helper['toolExecutor'] = toolExecutor;

      const executeSpy = vi.spyOn(toolExecutor, 'executeApprovedTool');

      mockProvider.addMockResponse({
        content: 'Using tool with custom directory',
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

      await helper.execute('Test custom working directory');

      // Should pass working directory in context
      expect(executeSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          workingDirectory: '/custom/work/dir'
        })
      );
    });

    it('should handle empty tool list', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: [] // Empty tool list
      });

      mockProvider.addMockResponse({
        content: 'I want to use a tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      mockProvider.addMockResponse({
        content: 'No tools available',
        toolCalls: []
      });

      const result = await helper.execute('Try to use tools');

      // Should block all tool calls due to empty whitelist
      expect(result.toolResults[0].status).toBe('failed');
      expect(result.toolResults[0].content[0].text).toContain('not in whitelist');
    });

    it('should resolve fast vs smart models correctly', async () => {
      // Test fast model
      vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValueOnce('fast-instance:fast-model');
      
      const fastHelper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });

      const fastModel = fastHelper['getModel']();
      expect(fastModel).toBe('fast-model');
      expect(GlobalConfigManager.getDefaultModel).toHaveBeenCalledWith('fast');

      // Test smart model
      vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValueOnce('smart-instance:smart-model');
      
      const smartHelper = new InfrastructureHelper({
        model: 'smart',
        tools: ['test_tool']
      });

      const smartModel = smartHelper['getModel']();
      expect(smartModel).toBe('smart-model');
      expect(GlobalConfigManager.getDefaultModel).toHaveBeenCalledWith('smart');
    });

    it('should handle abort signal during execution', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });

      const abortController = new AbortController();
      
      // Abort before execution starts
      abortController.abort();

      // Should throw when abort signal is already set
      await expect(helper.execute('Test abort', abortController.signal))
        .rejects.toThrow('Helper execution aborted');
    });

    it('should handle provider not found error', async () => {
      // Mock getInstance to return null
      const mockInstanceManager: Partial<ProviderInstanceManager> = {
        getInstance: vi.fn().mockResolvedValue(null)
      };
      vi.mocked(ProviderInstanceManager).mockImplementation(() => mockInstanceManager as unknown as ProviderInstanceManager);

      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });

      await expect(helper['getProvider']()).rejects.toThrow('Provider instance not found');
    });

    it('should handle tool execution errors gracefully', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });
      helper['toolExecutor'] = toolExecutor;

      // Mock executeApprovedTool to throw error
      vi.spyOn(toolExecutor, 'executeApprovedTool').mockRejectedValue(new Error('Tool execution failed'));

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

      const result = await helper.execute('Test error handling');

      // Should capture error as failed tool result
      expect(result.toolResults[0].status).toBe('failed');
      expect(result.toolResults[0].content[0].text).toContain('Tool execution failed');
    });
  });
});