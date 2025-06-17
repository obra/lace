// ABOUTME: Tests for the delegate tool
// ABOUTME: Validates subagent creation, execution, and tool approval flow

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DelegateTool } from '../implementations/delegate.js';
import { Agent } from '../../agents/agent.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { ToolExecutor } from '../executor.js';
import { ToolRegistry } from '../registry.js';
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
  let mockToolRegistry: ToolRegistry;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock instances
    mockThreadManager = new ThreadManager(':memory:');
    mockToolRegistry = new ToolRegistry();
    mockToolExecutor = new ToolExecutor(mockToolRegistry);

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
    (tool as any).threadManager = mockThreadManager;
    (tool as any).toolRegistry = mockToolRegistry;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('delegate');
    expect(tool.destructive).toBe(false);
    expect(tool.input_schema.required).toEqual(['title', 'prompt', 'expected_response']);
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

    const result = await tool.executeTool({
      title: 'Analyze test failures',
      prompt: 'Review the test output and identify failing tests',
      expected_response: 'List of failing tests',
    });

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('Analysis complete: 3 tests failed');

    // Verify agent was created with correct config
    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: mockProvider,
        toolExecutor: mockToolExecutor,
        threadManager: mockThreadManager,
        tools: expect.any(Array),
      })
    );

    // Verify delegate tool was excluded from subagent's tools
    const agentConfig = vi.mocked(Agent).mock.calls[0][0];
    expect(agentConfig.tools.find((t: any) => t.name === 'delegate')).toBeUndefined();
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

    const result = await tool.executeTool({
      title: 'Search logs',
      prompt: 'Find errors in logs',
      expected_response: 'Error list',
      model: 'anthropic:claude-3.5-sonnet-latest',
    });

    expect(result.success).toBe(true);
    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-3.5-sonnet-latest',
      })
    );
  });

  it('should forward tool call events from subagent', async () => {
    // Track tool events
    const toolEvents: any[] = [];

    // Mock subagent making a tool call
    mockAgent.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'tool_call_start') {
        // Simulate tool call from subagent
        setTimeout(() => {
          toolEvents.push({
            event: 'tool_call_start',
            data: {
              toolName: 'bash',
              input: { command: 'ls -la' },
              callId: 'test-call-123',
            },
          });
          handler({
            toolName: 'bash',
            input: { command: 'ls -la' },
            callId: 'test-call-123',
          });
        }, 0);
      } else if (event === 'agent_response_complete') {
        setTimeout(() => handler({ content: 'Directory listed' }), 20);
      }
      return mockAgent;
    });

    mockAgent.once.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'conversation_complete') {
        setTimeout(() => handler(), 30);
      }
      return mockAgent;
    });

    await tool.executeTool({
      title: 'List files',
      prompt: 'Show directory contents',
      expected_response: 'File list',
    });

    // Verify tool events were captured
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toEqual({
      event: 'tool_call_start',
      data: {
        toolName: 'bash',
        input: { command: 'ls -la' },
        callId: 'test-call-123',
      },
    });

    // Note: When tool approval is implemented, this is where we'd verify
    // that the subagent's tool calls go through the same approval flow
  });

  it('should handle subagent errors gracefully', async () => {
    mockAgent.once.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'error') {
        setTimeout(() => handler({ error: new Error('Subagent failed') }), 0);
      }
      return mockAgent;
    });

    const result = await tool.executeTool({
      title: 'Failing task',
      prompt: 'This will fail',
      expected_response: 'Should not get this',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Subagent error: Subagent failed');
  });

  it('should timeout if subagent takes too long', async () => {
    // Don't set up any event handlers - simulate hanging subagent

    // Create a custom tool instance with short default timeout
    const quickTimeoutTool = new DelegateTool();
    (quickTimeoutTool as any).threadManager = mockThreadManager;
    (quickTimeoutTool as any).toolRegistry = mockToolRegistry;
    (quickTimeoutTool as any).defaultTimeout = 100; // 100ms default timeout

    const result = await quickTimeoutTool.executeTool({
      title: 'Slow task',
      prompt: 'This will timeout',
      expected_response: 'Will not complete',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout after 100ms');
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

    await tool.executeTool({
      title: 'Format test',
      prompt: 'Test the prompt formatting',
      expected_response: 'JSON object with {result: string}',
    });

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
    const result = await tool.executeTool({
      title: 'Bad provider',
      prompt: 'Test',
      expected_response: 'Test',
      model: 'invalid-format',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid model format');
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

    const result = await tool.executeTool({
      title: 'Multi-response task',
      prompt: 'Generate multiple responses',
      expected_response: 'Multiple outputs',
    });

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('First response');
    expect(result.content[0]?.text).toContain('Second response');
  });
});
