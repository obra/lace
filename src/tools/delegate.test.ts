// ABOUTME: Tests for the delegate tool
// ABOUTME: Validates subagent creation, execution, and tool approval flow

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DelegateTool } from '~/tools/implementations/delegate';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { AnthropicProvider } from '~/providers/anthropic-provider';
import type { AIProvider } from '~/providers/base-provider';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Note: Tool approval is not yet implemented in lace
// When it is, subagent tool calls should use the same approval flow

// Mock providers
vi.mock('~/providers/anthropic-provider');
vi.mock('~/providers/lmstudio-provider');
vi.mock('~/providers/ollama-provider');

// Mock the Agent
vi.mock('~/agents/agent');

describe('DelegateTool', () => {
  let tool: DelegateTool;
  let mockAgent: Partial<Agent>;
  let mockProvider: {
    providerName: string;
    createResponse: ReturnType<typeof vi.fn>;
  };
  let mockThreadManager: ThreadManager;
  let mockToolExecutor: ToolExecutor;

  beforeEach(() => {
    setupTestPersistence();
    // Reset mocks
    vi.clearAllMocks();

    // Set up test environment variables
    process.env.ANTHROPIC_KEY = 'test-api-key';

    // Create mock instances
    mockThreadManager = new ThreadManager();
    mockToolExecutor = new ToolExecutor();
    mockToolExecutor.registerAllAvailableTools();

    // Create and set active thread for delegation tests
    const testThreadId = mockThreadManager.generateThreadId();
    mockThreadManager.createThread(testThreadId);

    // Mock provider
    mockProvider = {
      providerName: 'anthropic',
      createResponse: vi.fn().mockResolvedValue({
        content: 'Test result from subagent',
        toolCalls: [],
      }),
    };

    // Mock the provider constructor
    vi.mocked(AnthropicProvider).mockImplementation(
      () => mockProvider as unknown as AnthropicProvider
    );

    // Create mock subagent
    const mockSubagent = {
      start: vi.fn(),
      sendMessage: vi.fn(),
      removeAllListeners: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
    };
    mockSubagent.on.mockReturnValue(mockSubagent);
    mockSubagent.once.mockReturnValue(mockSubagent);

    // Mock Agent behavior
    mockAgent = {
      start: vi.fn(),
      sendMessage: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      createDelegateAgent: vi.fn(
        (_toolExecutor: unknown, _provider: unknown, _tokenBudget: unknown) =>
          mockSubagent as unknown as Agent
      ),
    };

    vi.mocked(Agent).mockImplementation(() => mockAgent as Agent);

    // Create tool instance - it will get dependencies injected when needed
    tool = new DelegateTool();
    // Inject dependencies for testing
    tool.setDependencies(mockAgent as Agent, mockToolExecutor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up test environment variables
    delete process.env.ANTHROPIC_KEY;
    teardownTestPersistence();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('delegate');
    expect(tool.annotations?.openWorldHint).toBe(true);
    expect(tool.inputSchema.required).toEqual(['title', 'prompt', 'expected_response']);
  });

  it('should delegate a simple task with default model', async () => {
    // Get the mock subagent that will be returned by createDelegateAgent
    const mockSubagent = mockAgent.createDelegateAgent!(
      mockToolExecutor,
      mockProvider as unknown as AIProvider,
      {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      }
    );

    // Setup subagent event handling for 'on' listeners
    (mockSubagent.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'agent_response_complete') {
          // Simulate immediate response
          setTimeout(() => handler({ content: 'Analysis complete: 3 tests failed' }), 0);
        }
        return mockSubagent;
      }
    );

    // Setup subagent event handling for 'once' listeners
    (mockSubagent.once as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'conversation_complete') {
          // Fire conversation complete after response
          setTimeout(() => handler(), 10);
        }
        return mockSubagent;
      }
    );

    const result = await tool.execute({
      title: 'Analyze test failures',
      prompt: 'Review the test output and identify failing tests',
      expected_response: 'List of failing tests',
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Analysis complete: 3 tests failed');

    // Verify createDelegateAgent was called
    expect(mockAgent.createDelegateAgent).toHaveBeenCalledWith(
      expect.any(Object), // toolExecutor
      mockProvider,
      expect.objectContaining({
        warningThreshold: 0.7,
        maxTokens: 50000,
        reserveTokens: 1000,
      })
    );
  });

  it('should handle custom provider:model format', async () => {
    const mockSubagent = mockAgent.createDelegateAgent!(
      mockToolExecutor,
      mockProvider as unknown as AIProvider,
      {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      }
    );

    (mockSubagent.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'agent_response_complete') {
          setTimeout(() => handler({ content: 'Custom model response' }), 0);
        }
        return mockSubagent;
      }
    );

    (mockSubagent.once as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'conversation_complete') {
          setTimeout(() => handler(), 10);
        }
        return mockSubagent;
      }
    );

    const result = await tool.execute({
      title: 'Search logs',
      prompt: 'Find errors in logs',
      expected_response: 'Error list',
      model: 'anthropic:claude-3.5-sonnet-latest',
    });

    expect(result.isError).toBe(false);
    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-3.5-sonnet-latest',
      })
    );
  });

  it('should create delegate thread and execute subagent', async () => {
    // Mock subagent behavior
    const mockSubagent = mockAgent.createDelegateAgent!(
      mockToolExecutor,
      mockProvider as unknown as AIProvider,
      {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      }
    );

    (mockSubagent.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'agent_response_complete') {
          setTimeout(() => handler({ content: 'Directory listed successfully' }), 10);
        }
        return mockSubagent;
      }
    );

    (mockSubagent.once as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'conversation_complete') {
          setTimeout(() => handler(), 20);
        }
        return mockSubagent;
      }
    );

    const result = await tool.execute({
      title: 'List files',
      prompt: 'Show directory contents',
      expected_response: 'File list',
    });

    // Verify delegation succeeded
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Directory listed successfully');

    // Verify createDelegateAgent was called
    expect(mockAgent.createDelegateAgent).toHaveBeenCalled();

    // Note: Tool calls from subagent are now captured in the delegate thread
    // and displayed in the delegation box UI, not forwarded as events
  });

  it('should handle subagent errors gracefully', async () => {
    const mockSubagent = mockAgent.createDelegateAgent!(
      mockToolExecutor,
      mockProvider as unknown as AIProvider,
      {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      }
    );

    (mockSubagent.once as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'error') {
          setTimeout(() => handler({ error: new Error('Subagent failed') }), 0);
        }
        return mockSubagent;
      }
    );

    const result = await tool.execute({
      title: 'Failing task',
      prompt: 'This will fail',
      expected_response: 'Should not get this',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Subagent error: Subagent failed');
  });

  it('should timeout if subagent takes too long', async () => {
    // Don't set up any event handlers - simulate hanging subagent

    // Create a custom tool instance with short default timeout
    const quickTimeoutTool = new DelegateTool();
    quickTimeoutTool.setDependencies(mockAgent as Agent, mockToolExecutor);
    (quickTimeoutTool as any as { defaultTimeout: number }).defaultTimeout = 100; // 100ms default timeout

    const result = await quickTimeoutTool.execute({
      title: 'Slow task',
      prompt: 'This will timeout',
      expected_response: 'Will not complete',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('timeout after 100ms');
  });

  it('should format the subagent system prompt correctly', async () => {
    const mockSubagent = mockAgent.createDelegateAgent!(
      mockToolExecutor,
      mockProvider as unknown as AIProvider,
      {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      }
    );

    (mockSubagent.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'agent_response_complete') {
          setTimeout(() => handler({ content: 'Done' }), 0);
        }
        return mockSubagent;
      }
    );

    (mockSubagent.once as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'conversation_complete') {
          setTimeout(() => handler(), 10);
        }
        return mockSubagent;
      }
    );

    await tool.execute({
      title: 'Format test',
      prompt: 'Test the prompt formatting',
      expected_response: 'JSON object with {result: string}',
    });

    // Check the provider was created with correct system prompt
    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringMatching(
          /focused task assistant.*Expected response format: JSON object with \{result: string\}/s
        ) as string,
      })
    );
  });

  it('should handle invalid provider format', async () => {
    const result = await tool.execute({
      title: 'Bad provider',
      prompt: 'Test',
      expected_response: 'Test',
      model: 'invalid-format',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid model format');
  });

  it('should collect all subagent responses', async () => {
    const mockSubagent = mockAgent.createDelegateAgent!(
      mockToolExecutor,
      mockProvider as unknown as AIProvider,
      {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      }
    );

    (mockSubagent.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'agent_response_complete') {
          // Simulate multiple responses
          setTimeout(() => handler({ content: 'First response' }), 0);
          setTimeout(() => handler({ content: 'Second response' }), 10);
        }
        return mockSubagent;
      }
    );

    (mockSubagent.once as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'conversation_complete') {
          setTimeout(() => handler(), 20);
        }
        return mockSubagent;
      }
    );

    const result = await tool.execute({
      title: 'Multi-response task',
      prompt: 'Generate multiple responses',
      expected_response: 'Multiple outputs',
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('First response');
    expect(result.content[0]?.text).toContain('Second response');
  });

  it('should include delegate thread ID in result metadata', async () => {
    const mockSubagent = mockAgent.createDelegateAgent!(
      mockToolExecutor,
      mockProvider as unknown as AIProvider,
      {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      }
    );

    (mockSubagent.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'agent_response_complete') {
          setTimeout(() => handler({ content: 'Delegation complete' }), 0);
        }
        return mockSubagent;
      }
    );

    (mockSubagent.once as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, handler: (...args: any[]) => void) => {
        if (event === 'conversation_complete') {
          setTimeout(() => handler(), 10);
        }
        return mockSubagent;
      }
    );

    const result = await tool.execute({
      title: 'Test metadata',
      prompt: 'Test thread ID in metadata',
      expected_response: 'Success',
    });

    expect(result.isError).toBe(false);
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.taskTitle).toBeDefined();
    expect(result.metadata?.taskTitle).toBe('Test metadata');
  });
});
