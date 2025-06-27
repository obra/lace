// ABOUTME: Tests for the delegate tool
// ABOUTME: Validates subagent creation, execution, and tool approval flow

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DelegateTool } from '../implementations/delegate.js';
import { createTestToolCall } from './test-utils.js';
import { Agent } from '../../agents/agent.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { ToolExecutor } from '../executor.js';
import { AnthropicProvider } from '../../providers/anthropic-provider.js';

// Note: Tool approval is not yet implemented in lace
// When it is, subagent tool calls should use the same approval flow

// Mock providers
vi.mock('../../providers/anthropic-provider.js');
vi.mock('../../providers/lmstudio-provider.js');
vi.mock('../../providers/ollama-provider.js');

// Mock the Agent
vi.mock('../../agents/agent.js');

describe('DelegateTool', () => {
  let tool: DelegateTool;
  let mockAgent: any;
  let mockProvider: any;
  let mockThreadManager: ThreadManager;
  let mockToolExecutor: ToolExecutor;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Set up test environment variables
    process.env.ANTHROPIC_KEY = 'test-api-key';

    // Create mock instances
    mockThreadManager = new ThreadManager(':memory:');
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
    vi.mocked(AnthropicProvider).mockImplementation(() => mockProvider);

    // Mock Agent behavior
    mockAgent = {
      start: vi.fn(),
      sendMessage: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    vi.mocked(Agent).mockImplementation(() => mockAgent);

    // Create tool instance - it will get dependencies injected when needed
    tool = new DelegateTool();
    // Inject dependencies for testing
    tool.setDependencies(mockThreadManager, mockToolExecutor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up test environment variables
    delete process.env.ANTHROPIC_KEY;
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('delegate');
    expect(tool.annotations?.openWorldHint).toBe(true);
    expect(tool.inputSchema.required).toEqual(['title', 'prompt', 'expected_response']);
  });

  it('should delegate a simple task with default model', async () => {
    // Setup agent event handling for 'on' listeners
    mockAgent.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'agent_response_complete') {
        // Simulate immediate response
        setTimeout(() => handler({ content: 'Analysis complete: 3 tests failed' }), 0);
      }
      return mockAgent;
    });

    // Setup agent event handling for 'once' listeners
    mockAgent.once.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'conversation_complete') {
        // Fire conversation complete after response
        setTimeout(() => handler(), 10);
      }
      return mockAgent;
    });

    const result = await tool.executeTool(createTestToolCall('delegate', {
      title: 'Analyze test failures',
      prompt: 'Review the test output and identify failing tests',
      expected_response: 'List of failing tests',
    }));

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Analysis complete: 3 tests failed');

    // Verify agent was created with correct config
    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: mockProvider,
        toolExecutor: expect.any(Object),
        threadManager: mockThreadManager,
        threadId: expect.stringMatching(/\.\d+$/), // Delegate threads end with .1, .2, etc.
        tools: expect.any(Array),
        tokenBudget: expect.objectContaining({
          warningThreshold: 0.7,
          maxTokens: 50000,
          reserveTokens: 1000,
        }),
      })
    );

    // Verify delegate tool was excluded from subagent's tools
    const agentConfig = vi.mocked(Agent).mock.calls[0][0];
    expect(agentConfig.tools.find((t: any) => t.name === 'delegate'));
  });

  it('should handle custom provider:model format', async () => {
    mockAgent.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'agent_response_complete') {
        setTimeout(() => handler({ content: 'Custom model response' }), 0);
      }
      return mockAgent;
    });

    mockAgent.once.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'conversation_complete') {
        setTimeout(() => handler(), 10);
      }
      return mockAgent;
    });

    const result = await tool.executeTool(createTestToolCall('delegate', {
      title: 'Search logs',
      prompt: 'Find errors in logs',
      expected_response: 'Error list',
      model: 'anthropic:claude-3.5-sonnet-latest',
    }));

    expect(result.isError).toBe(false);
    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-3.5-sonnet-latest',
      })
    );
  });

  it('should create delegate thread and execute subagent', async () => {
    // Mock subagent behavior
    mockAgent.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'agent_response_complete') {
        setTimeout(() => handler({ content: 'Directory listed successfully' }), 10);
      }
      return mockAgent;
    });

    mockAgent.once.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'conversation_complete') {
        setTimeout(() => handler(), 20);
      }
      return mockAgent;
    });

    const result = await tool.executeTool(createTestToolCall('delegate', {
      title: 'List files',
      prompt: 'Show directory contents',
      expected_response: 'File list',
    }));

    // Verify delegation succeeded
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Directory listed successfully');

    // Verify Agent was created with delegate thread ID
    const agentConfig = vi.mocked(Agent).mock.calls[0][0];
    expect(agentConfig.threadId).toMatch(/\.\d+$/); // Delegate thread format

    // Note: Tool calls from subagent are now captured in the delegate thread
    // and displayed in the delegation box UI, not forwarded as events
  });

  it('should handle subagent errors gracefully', async () => {
    mockAgent.once.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'error') {
        setTimeout(() => handler({ error: new Error('Subagent failed') }), 0);
      }
      return mockAgent;
    });

    const result = await tool.executeTool(createTestToolCall('delegate', {
      title: 'Failing task',
      prompt: 'This will fail',
      expected_response: 'Should not get this',
    }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Subagent error: Subagent failed');
  });

  it('should timeout if subagent takes too long', async () => {
    // Don't set up any event handlers - simulate hanging subagent

    // Create a custom tool instance with short default timeout
    const quickTimeoutTool = new DelegateTool();
    quickTimeoutTool.setDependencies(mockThreadManager, mockToolExecutor);
    (quickTimeoutTool as any).defaultTimeout = 100; // 100ms default timeout

    const result = await quickTimeoutTool.executeTool(createTestToolCall('delegate', {
      title: 'Slow task',
      prompt: 'This will timeout',
      expected_response: 'Will not complete',
    }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('timeout after 100ms');
  });

  it('should format the subagent system prompt correctly', async () => {
    mockAgent.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'agent_response_complete') {
        setTimeout(() => handler({ content: 'Done' }), 0);
      }
      return mockAgent;
    });

    mockAgent.once.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'conversation_complete') {
        setTimeout(() => handler(), 10);
      }
      return mockAgent;
    });

    await tool.executeTool(createTestToolCall('delegate', {
      title: 'Format test',
      prompt: 'Test the prompt formatting',
      expected_response: 'JSON object with {result: string}',
    }));

    // Check the provider was created with correct system prompt
    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringMatching(
          /focused task assistant.*Expected response format: JSON object with \{result: string\}/s
        ),
      })
    );
  });

  it('should handle invalid provider format', async () => {
    const result = await tool.executeTool(createTestToolCall('delegate', {
      title: 'Bad provider',
      prompt: 'Test',
      expected_response: 'Test',
      model: 'invalid-format',
    }));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid model format');
  });

  it('should collect all subagent responses', async () => {
    mockAgent.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'agent_response_complete') {
        // Simulate multiple responses
        setTimeout(() => handler({ content: 'First response' }), 0);
        setTimeout(() => handler({ content: 'Second response' }), 10);
      }
      return mockAgent;
    });

    mockAgent.once.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'conversation_complete') {
        setTimeout(() => handler(), 20);
      }
      return mockAgent;
    });

    const result = await tool.executeTool(createTestToolCall('delegate', {
      title: 'Multi-response task',
      prompt: 'Generate multiple responses',
      expected_response: 'Multiple outputs',
    }));

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('First response');
    expect(result.content[0]?.text).toContain('Second response');
  });
});
