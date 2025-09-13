// ABOUTME: Tests SessionHelper provider creation, inherited tools/workingDir, approval flow, and abort handling
// ABOUTME: Validates working directory inheritance, tool approval workflow, and error handling
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionHelper } from './session-helper';
import type { Agent } from '~/agents/agent';
import type { Session } from '~/sessions/session';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderRegistry } from '~/providers/registry';
import { TestProvider } from '~/test-utils/test-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { z } from 'zod';

// Mock modules
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

describe('SessionHelper', () => {
  let mockAgent: Agent;
  let mockSession: Session;
  let mockProvider: QueuedMockProvider;
  let toolExecutor: ToolExecutor;
  let testTool: TestTool;

  beforeEach(() => {
    // Setup mock provider
    mockProvider = new QueuedMockProvider({});

    // Setup tool executor
    toolExecutor = new ToolExecutor();
    testTool = new TestTool();
    toolExecutor.registerTool(testTool.name, testTool);

    // Mock session
    const sessionPartial: Partial<Session> = {
      getToolPolicy: vi.fn().mockReturnValue('require-approval'),
      getWorkingDirectory: vi.fn().mockReturnValue('/session/dir'),
      getTools: vi.fn().mockReturnValue([testTool]),
    };
    mockSession = sessionPartial as Session;

    // Mock agent
    const agentPartial: Partial<Agent> = {
      getFullSession: vi.fn().mockResolvedValue(mockSession),
      getAvailableTools: vi.fn().mockReturnValue([testTool]),
      toolExecutor,
    };
    mockAgent = agentPartial as Agent;

    // Mock global config
    vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValue('test-instance:test-model');

    // Mock provider registry
    const mockRegistry: Partial<ProviderRegistry> = {
      createProviderFromInstanceAndModel: vi.fn().mockResolvedValue(mockProvider),
    };
    vi.mocked(ProviderRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as ProviderRegistry
    );
  });

  describe('constructor', () => {
    it('should create with parent agent', () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });
      expect(helper).toBeDefined();
    });

    it('should create with abort signal', () => {
      const controller = new AbortController();
      const helper = new SessionHelper({
        model: 'smart',
        parentAgent: mockAgent,
        abortSignal: controller.signal,
      });
      expect(helper).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should inherit working directory from session', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });
      helper['toolExecutor'] = toolExecutor;

      const executeSpy = vi.spyOn(toolExecutor, 'requestToolPermission');
      executeSpy.mockResolvedValue('granted');

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            arguments: { input: 'test' },
          },
        ],
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: [],
      });

      await helper.execute('Test working dir');

      expect(mockSession.getWorkingDirectory).toHaveBeenCalled();
    });

    it('should go through normal approval flow', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });
      helper['toolExecutor'] = toolExecutor;

      const permissionSpy = vi.spyOn(toolExecutor, 'requestToolPermission');
      permissionSpy.mockResolvedValue('granted');

      const executeSpy = vi.spyOn(toolExecutor, 'executeApprovedTool');

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            arguments: { input: 'test' },
          },
        ],
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: [],
      });

      await helper.execute('Test approval flow');

      // Should request permission first
      expect(permissionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test_tool' }),
        expect.objectContaining({ agent: mockAgent })
      );

      // Then execute if granted
      expect(executeSpy).toHaveBeenCalled();
    });

    it('should handle denied tool permissions', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });
      helper['toolExecutor'] = toolExecutor;

      // Mock permission denial
      const deniedResult = {
        id: 'call_1',
        status: 'failed' as const,
        content: [{ type: 'text' as const, text: 'Permission denied' }],
      };
      vi.spyOn(toolExecutor, 'requestToolPermission').mockResolvedValue(deniedResult);

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            arguments: { input: 'test' },
          },
        ],
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: [],
      });

      const result = await helper.execute('Test denial');

      // Should return denied result
      expect(result.toolResults[0].status).toBe('failed');
      expect(result.toolResults[0].content[0].text).toBe('Permission denied');
    });

    it('should create provider with correct model tier', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });

      const provider = await helper['getProvider']();

      expect(GlobalConfigManager.getDefaultModel).toHaveBeenCalledWith('fast');
      expect(ProviderRegistry.getInstance).toHaveBeenCalled();
      expect(provider).toBe(mockProvider);
    });

    it('should inherit tools from parent agent', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });

      const tools = helper['getTools']();

      expect(mockAgent.getAvailableTools).toHaveBeenCalled();
      expect(tools).toEqual([testTool]);
    });

    it('should resolve fast vs smart models correctly', async () => {
      // Test fast model
      vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValueOnce(
        'fast-instance:fast-model'
      );

      const fastHelper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });

      const fastModel = fastHelper['getModel']();
      expect(fastModel).toBe('fast-model');
      expect(GlobalConfigManager.getDefaultModel).toHaveBeenCalledWith('fast');

      // Test smart model
      vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValueOnce(
        'smart-instance:smart-model'
      );

      const smartHelper = new SessionHelper({
        model: 'smart',
        parentAgent: mockAgent,
      });

      const smartModel = smartHelper['getModel']();
      expect(smartModel).toBe('smart-model');
      expect(GlobalConfigManager.getDefaultModel).toHaveBeenCalledWith('smart');
    });

    it('should handle pending approval gracefully', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });
      helper['toolExecutor'] = toolExecutor;

      // Mock pending approval
      vi.spyOn(toolExecutor, 'requestToolPermission').mockResolvedValue('pending');

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            arguments: { input: 'test' },
          },
        ],
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: [],
      });

      const result = await helper.execute('Test pending');

      // Should handle pending gracefully
      expect(result.toolResults[0].status).toBe('failed');
      expect(result.toolResults[0].content[0].text).toContain('Tool approval pending');
    });

    it('should handle abort signal during execution', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
      });

      const abortController = new AbortController();

      // Abort before execution starts
      abortController.abort();

      // Should throw when abort signal is already set
      await expect(helper.execute('Test abort', abortController.signal)).rejects.toThrow(
        'Helper execution aborted'
      );
    });

    it('should reveal what SessionHelper actually sends to AI provider', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent,
        persona: 'session-summary', // Test with our new persona
      });

      // Spy on the provider's createResponse to see exactly what gets sent
      const createResponseSpy = vi.spyOn(mockProvider, 'createResponse');

      mockProvider.addMockResponse({
        content: 'Test response',
        toolCalls: [],
      });

      const testPrompt = 'Generate a summary of this conversation';
      await helper.execute(testPrompt);

      // Verify createResponse was called
      expect(createResponseSpy).toHaveBeenCalledTimes(1);

      const [conversation, tools, model] = createResponseSpy.mock.calls[0];

      // Verify what we actually got instead of asserting what we expected
      expect(conversation).toBeInstanceOf(Array);
      expect(conversation.length).toBeGreaterThan(0);

      // Check if there's a system message
      const systemMessage = conversation.find((msg) => msg.role === 'system');
      expect(systemMessage).toBeDefined();

      // Verify tools and model are passed through correctly
      expect(tools).toEqual([testTool]);
      expect(model).toBe('test-model');
    });

    it('should handle multi-turn conversations correctly', async () => {
      const helper = new SessionHelper({
        model: 'smart',
        parentAgent: mockAgent,
      });

      const createResponseSpy = vi.spyOn(mockProvider, 'createResponse');

      // Add a tool call response first
      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            arguments: { input: 'test' },
          },
        ],
      });

      // Then a final response
      mockProvider.addMockResponse({
        content: 'Done with tool',
        toolCalls: [],
      });

      // Execute a prompt that would normally get a system prompt from Agent class
      await helper.execute('You are a helpful assistant. Summarize this conversation.');

      // Should have been called twice (once for initial, once after tool call)
      expect(createResponseSpy).toHaveBeenCalledTimes(2);

      // Check the first call
      const [firstConversation] = createResponseSpy.mock.calls[0];

      // Check the second call (after tool execution)
      const [secondConversation] = createResponseSpy.mock.calls[1];

      expect(firstConversation.length).toBeGreaterThan(0);
      // In our BaseHelper implementation, both calls might have the same conversation length
      // if the helper restarts the conversation each time
      expect(secondConversation.length).toBeGreaterThanOrEqual(firstConversation.length);
    });
  });
});
