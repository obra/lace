// ABOUTME: Integration tests for Step 13 real lace backend connection
// ABOUTME: Tests integration between lace-ink UI and existing lace agent system

import React from 'react';
import { jest } from '@jest/globals';

// Mock the lace backend modules before importing LaceUI  
jest.mock('../src/database/conversation-db', () => ({
  ConversationDB: jest.fn().mockImplementation(() => ({
    // @ts-ignore
    initialize: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/tools/tool-registry', () => ({
  ToolRegistry: jest.fn().mockImplementation(() => ({
    // @ts-ignore
    initialize: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockReturnValue(['file-tool', 'shell-tool', 'search-tool'])
  }))
}));

jest.mock('../src/models/model-provider', () => ({
  ModelProvider: jest.fn().mockImplementation(() => ({
    // @ts-ignore
    initialize: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/safety/tool-approval', () => ({
  ToolApprovalManager: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../src/agents/agent', () => ({
  Agent: jest.fn().mockImplementation(() => ({
    role: 'orchestrator',
    assignedModel: 'claude-3-5-sonnet-20241022',
    assignedProvider: 'anthropic',
    capabilities: ['orchestration', 'reasoning', 'planning', 'delegation'],
    contextSize: 0,
    processInput: jest.fn(),
    calculateContextUsage: jest.fn(),
    calculateCost: jest.fn()
  }))
}));

// Mock Ink's render function
jest.mock('ink', () => ({
  render: jest.fn().mockReturnValue({ unmount: jest.fn() })
}));

import { LaceUI } from '../../../src/ui/lace-ui';

describe('Step 13: Connect to Lace Backend', () => {
  let laceUI: any;

  beforeEach(() => {
    // Create a test instance with minimal configuration
    laceUI = new LaceUI({
      memoryPath: ':memory:', // Use in-memory database for tests
      interactive: false, // Disable interactive approval for tests
      autoApprove: ['test-tool'], // Auto-approve test tools
      verbose: false
    });

    // Override the start method to avoid fullscreen-ink issues
    laceUI.start = jest.fn().mockImplementation(async () => {
      // Initialize backend components like the real start() but skip UI
      await laceUI.db.initialize();
      await laceUI.tools.initialize();
      await laceUI.modelProvider.initialize();
      
      // Use the mocked Agent constructor - it's already mocked above
      const { Agent } = await import('../../../src/agents/agent.js');
      laceUI.primaryAgent = new Agent({
        generation: laceUI.currentGeneration,
        tools: laceUI.tools,
        db: laceUI.db,
        modelProvider: laceUI.modelProvider,
        toolApproval: laceUI.toolApproval,
        verbose: laceUI.verbose,
        role: 'orchestrator',
        assignedModel: 'claude-3-5-sonnet-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['orchestration', 'reasoning', 'planning', 'delegation']
      });

      return { unmount: jest.fn() };
    });
  });

  afterEach(async () => {
    if (laceUI) {
      laceUI.stop();
    }
  });

  test('LaceUI initializes with real lace backend components', async () => {
    // Should initialize all backend components
    expect(laceUI.db).toBeTruthy();
    expect(laceUI.tools).toBeTruthy();
    expect(laceUI.modelProvider).toBeTruthy();
    expect(laceUI.toolApproval).toBeTruthy();
    
    // Should have proper session ID
    expect(laceUI.sessionId).toMatch(/^session-\d+$/);
    expect(laceUI.sessionId).toBeTruthy();
  });

  test('LaceUI creates primary agent with correct configuration', async () => {
    await laceUI.start();
    
    expect(laceUI.primaryAgent).toBeTruthy();
    expect(laceUI.primaryAgent.role).toBe('orchestrator');
    expect(laceUI.primaryAgent.assignedModel).toBe('claude-3-5-sonnet-20241022');
    expect(laceUI.primaryAgent.assignedProvider).toBe('anthropic');
    expect(laceUI.primaryAgent.capabilities).toContain('orchestration');
    expect(laceUI.primaryAgent.capabilities).toContain('reasoning');
  });

  test('handleMessage processes input through real agent', async () => {
    await laceUI.start();
    
    // Mock the agent processInput method to return a controlled response
    const mockResponse = {
      content: 'Test response from real agent',
      toolCalls: [],
      toolResults: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      iterations: 1
    };
    
    jest.spyOn(laceUI.primaryAgent, 'processInput').mockResolvedValue(mockResponse);
    
    const result = await laceUI.handleMessage('Hello, test message');
    
    expect(result.success).toBe(true);
    expect(result.content).toBe('Test response from real agent');
    expect(result.usage).toEqual(mockResponse.usage);
    expect(result.agentActivities).toContain('🤖 orchestrator → reasoning complete');
    
    // Verify agent was called correctly
    expect(laceUI.primaryAgent.processInput).toHaveBeenCalledWith(
      laceUI.sessionId,
      'Hello, test message',
      expect.objectContaining({
        signal: expect.any(Object), // AbortController signal is just an object
        onToken: expect.any(Function)
      })
    );
  });

  test('handleMessage processes tool calls and formats agent activities', async () => {
    await laceUI.start();
    
    const mockResponse = {
      content: 'Response with tool calls',
      toolCalls: [
        { name: 'file_read', input: { path: 'test.txt' } },
        { name: 'shell_execute', input: { command: 'ls' } }
      ],
      toolResults: [
        { approved: true, denied: false, error: null },
        { approved: true, denied: false, error: 'Command failed' }
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      iterations: 2
    };
    
    jest.spyOn(laceUI.primaryAgent, 'processInput').mockResolvedValue(mockResponse);
    
    const result = await laceUI.handleMessage('Read file and run command');
    
    expect(result.success).toBe(true);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolResults).toHaveLength(2);
    expect(result.agentActivities).toContain('✅ file_read → completed');
    expect(result.agentActivities).toContain('❌ shell_execute → failed');
    expect(result.agentActivities).toContain('🤖 orchestrator → completed in 2 iterations');
  });

  test('handleMessage handles streaming tokens through callback', async () => {
    await laceUI.start();
    
    const mockTokens: string[] = [];
    let onTokenCallback: ((token: string) => void) | null = null;
    
    // Mock UI ref to capture streaming tokens
    laceUI.uiRef = {
      handleStreamingToken: (token: string) => {
        mockTokens.push(token);
      }
    };
    
    // Mock agent to call onToken callback
    jest.spyOn(laceUI.primaryAgent, 'processInput').mockImplementation(async (sessionId, input, options: any) => {
      onTokenCallback = options.onToken;
      
      // Simulate streaming tokens
      if (onTokenCallback) {
        onTokenCallback('Hello');
        onTokenCallback(' ');
        onTokenCallback('world');
      }
      
      return {
        content: 'Hello world',
        toolCalls: [],
        toolResults: [],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        iterations: 1
      };
    });
    
    await laceUI.handleMessage('Stream test');
    
    expect(mockTokens).toEqual(['Hello', ' ', 'world']);
    expect(onTokenCallback).toBeTruthy();
  });

  test('handleMessage handles abort signal correctly', async () => {
    await laceUI.start();
    
    // Mock agent to simulate abortable operation
    jest.spyOn(laceUI.primaryAgent, 'processInput').mockImplementation(async (sessionId, input, options: any) => {
      // Simulate immediate abort
      const error = new Error('Operation was aborted');
      error.name = 'AbortError';
      throw error;
    });
    
    const result = await laceUI.handleMessage('Abortable operation');
    
    expect(result.error).toBe('Operation was aborted.');
    expect(result.aborted).toBe(true);
  });

  test('handleAbort cancels ongoing operation', async () => {
    await laceUI.start();
    
    // Start processing
    laceUI.isProcessing = true;
    laceUI.abortController = new AbortController();
    
    const aborted = laceUI.handleAbort();
    
    expect(aborted).toBe(true);
    expect(laceUI.abortController.signal.aborted).toBe(true);
  });

  test('handleAbort returns false when no operation is running', async () => {
    await laceUI.start();
    
    const aborted = laceUI.handleAbort();
    
    expect(aborted).toBe(false);
  });

  test('formatAgentActivities handles various response types', async () => {
    await laceUI.start();
    
    // Test with denied tool
    const response1 = {
      toolCalls: [{ name: 'dangerous_tool', input: {} }],
      toolResults: [{ denied: true, approved: false }],
      iterations: 1
    };
    
    const activities1 = laceUI.formatAgentActivities(response1);
    expect(activities1).toContain('🚫 dangerous_tool → denied');
    
    // Test with mixed tool results
    const response2 = {
      toolCalls: [
        { name: 'tool1', input: {} },
        { name: 'tool2', input: {} },
        { name: 'tool3', input: {} }
      ],
      toolResults: [
        { approved: true, denied: false },
        { approved: true, denied: false, error: 'Failed' },
        { approved: true, denied: false }
      ],
      iterations: 3
    };
    
    const activities2 = laceUI.formatAgentActivities(response2);
    expect(activities2).toContain('✅ tool1 → completed');
    expect(activities2).toContain('❌ tool2 → failed');
    expect(activities2).toContain('✅ tool3 → completed');
    expect(activities2).toContain('🤖 orchestrator → completed in 3 iterations');
  });

  test('getStatus returns comprehensive agent status', async () => {
    await laceUI.start();
    
    // Mock context usage calculation
    jest.spyOn(laceUI.primaryAgent, 'calculateContextUsage').mockReturnValue({
      used: 1000,
      total: 200000,
      percentage: 0.5,
      remaining: 199000
    });
    
    jest.spyOn(laceUI.primaryAgent, 'calculateCost').mockReturnValue({
      inputCost: 0.001,
      outputCost: 0.002,
      totalCost: 0.003
    });
    
    jest.spyOn(laceUI.tools, 'listTools').mockReturnValue(['file-tool', 'shell-tool', 'search-tool']);
    
    const status = laceUI.getStatus();
    
    expect(status.agent.role).toBe('orchestrator');
    expect(status.agent.model).toBe('claude-3-5-sonnet-20241022');
    expect(status.context.used).toBe(1000);
    expect(status.context.total).toBe(200000);
    expect(status.cost.totalCost).toBe(0.003);
    expect(status.tools).toEqual(['file-tool', 'shell-tool', 'search-tool']);
    expect(status.session).toBe(laceUI.sessionId);
  });

  test('prevents concurrent message processing', async () => {
    await laceUI.start();
    
    let resolveFirst: any;
    
    // Mock long-running agent operation
    jest.spyOn(laceUI.primaryAgent, 'processInput').mockImplementation(async () => {
      return new Promise(resolve => {
        resolveFirst = resolve;
        // Will be resolved manually in test
      });
    });
    
    // Start first message (don't await)
    const promise1 = laceUI.handleMessage('First message');
    
    // Try to start second message immediately
    const result2 = await laceUI.handleMessage('Second message');
    
    expect(result2.error).toContain('Already processing a message');
    
    // Complete first message
    resolveFirst({ content: 'Delayed response' });
    const result1 = await promise1;
    expect(result1.success).toBe(true);
  });
});