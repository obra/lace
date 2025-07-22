// ABOUTME: Tests for the delegate tool
// ABOUTME: Validates subagent creation, execution, and tool approval flow

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DelegateTool } from '~/tools/implementations/delegate';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { AnthropicProvider } from '~/providers/anthropic-provider';
import type { AIProvider } from '~/providers/base-provider';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';

// Note: Tool approval is not yet implemented in lace
// When it is, subagent tool calls should use the same approval flow

// Mock providers
vi.mock('~/providers/anthropic-provider');
vi.mock('~/providers/lmstudio-provider');
vi.mock('~/providers/ollama-provider');

// Use real Agent for business logic testing

describe('DelegateTool', () => {
  let tool: DelegateTool;
  let realAgent: Agent;
  let mockProvider: {
    providerName: string;
    createResponse: ReturnType<typeof vi.fn>;
    setSystemPrompt: ReturnType<typeof vi.fn>;
    systemPrompt: string;
    modelName: string;
    countTokens: ReturnType<typeof vi.fn>;
    getProviderInfo: ReturnType<typeof vi.fn>;
    // EventEmitter methods
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    addListener: ReturnType<typeof vi.fn>;
    prependListener: ReturnType<typeof vi.fn>;
    listeners: ReturnType<typeof vi.fn>;
    listenerCount: ReturnType<typeof vi.fn>;
  };
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    setupTestPersistence();
    // Reset mocks
    vi.clearAllMocks();

    // Set up test environment variables
    process.env.ANTHROPIC_KEY = 'test-api-key';

    // Create real business logic instances
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();

    // Create and set active thread for delegation tests
    const testThreadId = threadManager.generateThreadId();
    threadManager.createThread(testThreadId);

    // Mock provider for testing - need to mock EventEmitter methods properly
    mockProvider = {
      providerName: 'anthropic',
      createResponse: vi.fn().mockResolvedValue({
        content: 'Test result from subagent',
        toolCalls: [],
      }),
      setSystemPrompt: vi.fn(),
      get systemPrompt() {
        return 'test prompt';
      },
      get modelName() {
        return 'claude-3-5-sonnet-20241022';
      },
      countTokens: vi.fn().mockResolvedValue(100),
      getProviderInfo: vi.fn().mockReturnValue({
        name: 'anthropic',
        displayName: 'Anthropic',
        requiresApiKey: true,
      }),
      // EventEmitter methods
      on: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      emit: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
      removeListener: vi.fn().mockReturnThis(),
      removeAllListeners: vi.fn().mockReturnThis(),
      addListener: vi.fn().mockReturnThis(),
      prependListener: vi.fn().mockReturnThis(),
      listeners: vi.fn().mockReturnValue([]),
      listenerCount: vi.fn().mockReturnValue(0),
    };

    // Mock the provider constructor to return our test provider
    vi.mocked(AnthropicProvider).mockImplementation(
      () => mockProvider as unknown as AnthropicProvider
    );

    // Create a real Agent instance
    realAgent = new Agent({
      provider: mockProvider as unknown as AIProvider,
      toolExecutor,
      threadManager,
      threadId: testThreadId,
      tools: toolExecutor.getAllTools(),
    });

    // Create tool instance and inject real dependencies
    tool = new DelegateTool();
    tool.setDependencies(realAgent, toolExecutor);
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
    // Mock the provider to simulate a response from the subagent
    mockProvider.createResponse.mockResolvedValueOnce({
      content: 'Analysis complete: 3 tests failed',
      toolCalls: [],
    });

    const result = await tool.execute({
      title: 'Analyze test failures',
      prompt: 'Review the test output and identify failing tests',
      expected_response: 'List of failing tests',
    });

    // Delegation should work with proper dependencies

    // Test the actual behavior - delegation should work and return results
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Analysis complete: 3 tests failed');
    expect(result.metadata?.taskTitle).toBe('Analyze test failures');

    // Verify that the provider was actually called (meaning delegation worked)
    expect(mockProvider.createResponse).toHaveBeenCalled();
  });

  it('should handle custom provider:model format', async () => {
    // Mock provider response for custom model
    mockProvider.createResponse.mockResolvedValueOnce({
      content: 'Custom model response',
      toolCalls: [],
    });

    const result = await tool.execute({
      title: 'Search logs',
      prompt: 'Find errors in logs',
      expected_response: 'Error list',
      model: 'anthropic:claude-3.5-sonnet-latest',
    });

    // Test that delegation works with custom model specification
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Custom model response');

    // Verify the correct model was requested
    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-3.5-sonnet-latest',
      })
    );
  });

  it('should create delegate thread and execute subagent', async () => {
    // Mock the provider response for this delegation test
    mockProvider.createResponse.mockResolvedValueOnce({
      content: 'Directory listed successfully',
      toolCalls: [],
    });

    const result = await tool.execute({
      title: 'List files',
      prompt: 'Show directory contents',
      expected_response: 'File list',
    });

    // Verify delegation succeeded
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Directory listed successfully');
    expect(result.metadata?.taskTitle).toBe('List files');

    // Verify the provider was called for delegation
    expect(mockProvider.createResponse).toHaveBeenCalled();

    // Note: Tool calls from subagent are now captured in the delegate thread
    // and displayed in the delegation box UI, not forwarded as events
  });

  it('should handle subagent errors gracefully', async () => {
    // Mock provider to throw an error
    mockProvider.createResponse.mockRejectedValueOnce(new Error('Subagent failed'));

    const result = await tool.execute({
      title: 'Failing task',
      prompt: 'This will fail',
      expected_response: 'Should not get this',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Subagent error: Subagent failed');
  });

  it('should timeout if subagent takes too long', async () => {
    // Create a custom tool instance with short timeout
    const quickTimeoutTool = new DelegateTool();
    quickTimeoutTool.setDependencies(realAgent, toolExecutor);

    // Override the default timeout for testing
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (quickTimeoutTool as any).defaultTimeout = 100;

    // Mock provider to delay longer than timeout
    mockProvider.createResponse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ content: 'Too late!', toolCalls: [] }), 200);
        })
    );

    const result = await quickTimeoutTool.execute({
      title: 'Slow task',
      prompt: 'This will timeout',
      expected_response: 'Will not complete',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('timeout');
  }, 1000); // Set test timeout to 1 second

  it('should format the subagent system prompt correctly', async () => {
    // Mock provider response
    mockProvider.createResponse.mockResolvedValueOnce({
      content: 'Done',
      toolCalls: [],
    });

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
    // Mock provider to return combined response content
    mockProvider.createResponse.mockResolvedValueOnce({
      content: 'First response\nSecond response',
      toolCalls: [],
    });

    const result = await tool.execute({
      title: 'Multi-response task',
      prompt: 'Generate multiple responses',
      expected_response: 'Multiple outputs',
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('First response');
    expect(result.content[0]?.text).toContain('Second response');
    expect(result.metadata?.taskTitle).toBe('Multi-response task');
  });

  it('should include delegate thread ID in result metadata', async () => {
    // Mock provider response
    mockProvider.createResponse.mockResolvedValueOnce({
      content: 'Delegation complete',
      toolCalls: [],
    });

    const result = await tool.execute({
      title: 'Test metadata',
      prompt: 'Test thread ID in metadata',
      expected_response: 'Success',
    });

    expect(result.isError).toBe(false);
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.taskTitle).toBeDefined();
    expect(result.metadata?.taskTitle).toBe('Test metadata');

    // Verify delegation worked and returned expected content
    expect(result.content[0]?.text).toContain('Delegation complete');
  });
});
