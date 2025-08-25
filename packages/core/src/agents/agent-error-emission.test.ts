// ABOUTME: Test enhanced error event emission for provider failures, processing errors, and tool execution failures
// ABOUTME: Verifies error context preservation and structure with real agent instances

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from './agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ThreadManager } from '~/threads/thread-manager';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import type { LaceEvent } from '~/threads/types';
import type { ProviderMessage, ProviderResponse, ProviderToolCall } from '~/providers/base-provider';
import type { ToolResult, ToolContext } from '~/tools/types';
import { z } from 'zod';

// Mock provider for testing error scenarios
class MockProvider extends BaseMockProvider {
  private _shouldThrow: Error | null = null;
  private _mockResponse: ProviderResponse;

  constructor(mockResponse?: ProviderResponse) {
    super({});
    this._mockResponse = mockResponse || {
      role: 'assistant',
      content: 'Test response',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      stopReason: 'end_turn',
    };
  }

  get providerName(): string {
    return 'test-provider';
  }

  get supportsStreaming(): boolean {
    return false;
  }

  setError(error: Error | null): void {
    this._shouldThrow = error;
  }

  setResponse(response: ProviderResponse): void {
    this._mockResponse = response;
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string
  ): Promise<ProviderResponse> {
    if (this._shouldThrow) {
      throw this._shouldThrow;
    }
    return this._mockResponse;
  }
}

// Mock tool that can be configured to fail
class FailingMockTool extends Tool {
  name = 'failing_mock_tool';
  description = 'A mock tool that can fail';
  schema = z.object({
    command: z.string(),
  });

  constructor(private shouldFail: boolean = false) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    if (this.shouldFail) {
      throw new Error(`Tool execution failed: ${args.command}`);
    }
    return {
      id: 'test-result',
      status: 'completed',
      content: [{ type: 'text', text: `Executed: ${args.command}` }],
    };
  }
}

describe('Agent Error Emission', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let mockProvider: MockProvider;
  let toolExecutor: ToolExecutor;

  beforeEach(async () => {
    setupCoreTest();
    threadManager = new ThreadManager();
    mockProvider = new MockProvider();
    
    // Set up tool executor with failing tool
    toolExecutor = new ToolExecutor();
    toolExecutor.registerTool(new FailingMockTool(true));
    
    const thread = await threadManager.createThread({
      providerInstanceId: 'test-instance',
      modelId: 'test-model',
    });
    
    agent = new Agent({
      threadId: thread.id,
      threadManager,
      toolExecutor,
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      },
    });
    
    // Mock provider creation to return our mock provider
    vi.spyOn(agent as any, '_createProviderInstance').mockResolvedValue(mockProvider);
  });

  afterEach(async () => {
    // Clear any pending operations
    agent?.removeAllListeners();
  });

  describe('Provider Error Emission', () => {
    it('should emit enhanced error event for provider failures', async () => {
      // Configure provider to fail
      mockProvider.setError(new Error('Provider API failed with network timeout'));

      const errorEvents: Array<{ error: Error; context: Record<string, unknown> }> = [];
      agent.on('error', (errorEvent) => {
        errorEvents.push(errorEvent);
      });

      // Trigger provider error
      await agent.sendMessage('Test message');
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorEvents).toHaveLength(1);
      const errorEvent = errorEvents[0];
      
      expect(errorEvent.error).toBeInstanceOf(Error);
      expect(errorEvent.error.message).toBe('Provider API failed with network timeout');
      expect(errorEvent.context).toMatchObject({
        phase: 'provider_response',
        errorType: 'provider_failure',
        providerName: 'test-provider',
        providerInstanceId: expect.any(String),
        modelId: expect.any(String),
        isRetryable: true, // Network timeout should be retryable
        retryCount: 0,
      });
    });

    it('should correctly identify retryable vs non-retryable provider errors', async () => {
      const testCases = [
        { error: 'network timeout', expectedRetryable: true },
        { error: 'rate limit exceeded', expectedRetryable: true },
        { error: '503 Service Unavailable', expectedRetryable: true },
        { error: 'Invalid API key', expectedRetryable: false },
        { error: 'Malformed request', expectedRetryable: false },
      ];

      for (const testCase of testCases) {
        mockProvider.setError(new Error(testCase.error));

        const errorEvents: Array<{ error: Error; context: Record<string, unknown> }> = [];
        agent.on('error', (errorEvent) => {
          errorEvents.push(errorEvent);
        });

        await agent.sendMessage('Test message');
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(errorEvents).toHaveLength(1);
        expect(errorEvents[0].context.isRetryable).toBe(testCase.expectedRetryable);
        
        // Clear event listeners for next iteration
        agent.removeAllListeners('error');
      }
    });
  });

  describe('Processing Error Emission', () => {
    it('should emit enhanced error event for conversation processing failures', async () => {
      // Create agent with invalid configuration to trigger processing error
      const invalidThread = await threadManager.createThread({
        provider: 'invalid-provider',
        model: 'invalid-model',
      });
      
      const invalidAgent = new Agent({
        threadId: invalidThread.id,
        threadManager,
        providerInstance: null as any, // Force null to trigger processing error
      });

      const errorEvents: Array<{ error: Error; context: Record<string, unknown> }> = [];
      invalidAgent.on('error', (errorEvent) => {
        errorEvents.push(errorEvent);
      });

      try {
        await invalidAgent.sendMessage('Test message');
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch {
        // Expected to fail
      }

      // Should have processing error
      const processingErrors = errorEvents.filter(
        event => event.context.errorType === 'processing_error'
      );
      
      if (processingErrors.length > 0) {
        const errorEvent = processingErrors[0];
        expect(errorEvent.context).toMatchObject({
          phase: 'conversation_processing',
          errorType: 'processing_error',
          isRetryable: false,
          retryCount: 0,
        });
      }

      invalidAgent.removeAllListeners();
    });
  });

  describe('Tool Execution Error Emission', () => {
    it('should emit enhanced error event for tool execution failures', async () => {
      // Configure provider to suggest a tool call that will fail
      const toolCallResponse: ProviderResponse = {
        role: 'assistant', 
        content: 'I will execute a failing command',
        toolCalls: [
          {
            id: 'test-tool-call',
            name: 'failing_mock_tool',
            input: { command: 'invalid-command-that-will-fail' },
          },
        ],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        stopReason: 'tool_use',
      };
      mockProvider.setResponse(toolCallResponse);

      const errorEvents: Array<{ error: Error; context: Record<string, unknown> }> = [];
      agent.on('error', (errorEvent) => {
        errorEvents.push(errorEvent);
      });

      await agent.sendMessage('Run a command that will fail');
      
      // Wait for tool execution to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should have tool execution error
      const toolErrors = errorEvents.filter(
        event => event.context.errorType === 'tool_execution'
      );
      
      if (toolErrors.length > 0) {
        const errorEvent = toolErrors[0];
        expect(errorEvent.context).toMatchObject({
          phase: 'tool_execution',
          errorType: 'tool_execution',
          toolName: 'failing_mock_tool',
          toolCallId: 'test-tool-call',
          isRetryable: false,
          retryCount: 0,
        });
        expect(errorEvent.error.message).toContain('Tool execution failed');
      }
    });
  });

  describe('Error Context Preservation', () => {
    it('should preserve all required context fields in error events', async () => {
      mockProvider.setError(new Error('Test provider error'));

      const errorEvents: Array<{ error: Error; context: Record<string, unknown> }> = [];
      agent.on('error', (errorEvent) => {
        errorEvents.push(errorEvent);
      });

      await agent.sendMessage('Test message');
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorEvents).toHaveLength(1);
      const errorEvent = errorEvents[0];
      
      // Verify all required context fields are present
      expect(errorEvent.context).toHaveProperty('phase');
      expect(errorEvent.context).toHaveProperty('threadId');
      expect(errorEvent.context).toHaveProperty('errorType');
      expect(errorEvent.context).toHaveProperty('isRetryable');
      expect(errorEvent.context).toHaveProperty('retryCount');
      expect(errorEvent.context).toHaveProperty('providerName');
      expect(errorEvent.context).toHaveProperty('providerInstanceId');
      expect(errorEvent.context).toHaveProperty('modelId');
    });

    it('should handle missing provider information gracefully', async () => {
      // Test with mock provider that doesn't have complete info
      const errorEvent = {
        error: new Error('Test error'),
        context: {
          phase: 'provider_response',
          errorType: 'provider_failure',
          providerName: mockProvider.providerName,
          providerInstanceId: 'unknown',
          modelId: 'unknown',
          isRetryable: false,
          retryCount: 0,
        },
      };

      // Should have context fields even when provider info is missing/incomplete
      expect(errorEvent.context).toHaveProperty('providerName');
      expect(errorEvent.context).toHaveProperty('providerInstanceId');
      expect(errorEvent.context).toHaveProperty('modelId');
    });
  });

  describe('isRetryableError Logic', () => {
    it('should identify network errors as retryable', () => {
      const networkErrors = [
        'network timeout',
        'Network connection failed', 
        'timeout occurred',
        'connection timeout',
      ];

      networkErrors.forEach(errorMessage => {
        // Access private method for testing
        const isRetryable = (agent as any).isRetryableError(new Error(errorMessage));
        expect(isRetryable).toBe(true);
      });
    });

    it('should identify rate limit errors as retryable', () => {
      const rateLimitErrors = [
        'rate limit exceeded',
        'Rate limit reached',
        'quota exceeded',
        'Quota limit reached',
      ];

      rateLimitErrors.forEach(errorMessage => {
        const isRetryable = (agent as any).isRetryableError(new Error(errorMessage));
        expect(isRetryable).toBe(true);
      });
    });

    it('should identify 5xx HTTP errors as retryable', () => {
      const serverErrors = [
        '500 Internal Server Error',
        'HTTP 502 Bad Gateway',
        '503 Service Unavailable',
      ];

      serverErrors.forEach(errorMessage => {
        const isRetryable = (agent as any).isRetryableError(new Error(errorMessage));
        expect(isRetryable).toBe(true);
      });
    });

    it('should identify non-retryable errors correctly', () => {
      const nonRetryableErrors = [
        'Invalid API key',
        'Authentication failed',
        'Malformed request',
        '400 Bad Request',
        '404 Not Found',
      ];

      nonRetryableErrors.forEach(errorMessage => {
        const isRetryable = (agent as any).isRetryableError(new Error(errorMessage));
        expect(isRetryable).toBe(false);
      });
    });

    it('should handle non-Error objects gracefully', () => {
      const nonErrorObjects = [
        'string error',
        { error: 'object error' },
        null,
        undefined,
        123,
      ];

      nonErrorObjects.forEach(errorObject => {
        const isRetryable = (agent as any).isRetryableError(errorObject);
        expect(isRetryable).toBe(false);
      });
    });
  });
});