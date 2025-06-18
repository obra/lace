// ABOUTME: Comprehensive tests for the enhanced event-driven Agent class
// ABOUTME: Tests conversation processing, tool execution, state management, and event emissions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, AgentConfig } from '../agent.js';
import { AIProvider, ProviderMessage, ProviderResponse } from '../../providers/types.js';
import { Tool, ToolResult, ToolContext } from '../../tools/types.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ThreadManager } from '../../threads/thread-manager.js';

// Mock provider for testing
class MockProvider extends AIProvider {
  private mockResponse: ProviderResponse;

  constructor(mockResponse: ProviderResponse) {
    super({});
    this.mockResponse = mockResponse;
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return this.mockResponse;
  }
}

// Mock tool for testing
class MockTool implements Tool {
  name = 'mock_tool';
  description = 'A mock tool for testing';
  input_schema = {
    type: 'object' as const,
    properties: {
      action: { type: 'string', description: 'Action to perform' },
    },
    required: ['action'],
  };

  constructor(private result: ToolResult) {}

  async executeTool(_input: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    return this.result;
  }
}

describe('Enhanced Agent', () => {
  let mockProvider: MockProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;
  let agent: Agent;

  beforeEach(() => {
    mockProvider = new MockProvider({
      content: 'Test response',
      toolCalls: [],
    });

    toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    threadManager = new ThreadManager(':memory:');
    threadId = 'test_thread_123';
    threadManager.createThread(threadId);
  });

  afterEach(async () => {
    if (agent) {
      agent.removeAllListeners(); // Prevent EventEmitter memory leaks
      agent.stop();
    }
    // Clear mock references to prevent circular references
    mockProvider = null as any;
    toolExecutor = null as any;

    await threadManager.close();
  });

  function createAgent(config?: Partial<AgentConfig>): Agent {
    const defaultConfig: AgentConfig = {
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    };

    return new Agent({ ...defaultConfig, ...config });
  }

  describe('constructor and basic properties', () => {
    it('should create agent with correct configuration', () => {
      agent = createAgent();

      expect(agent.providerName).toBe('mock');
      expect(agent.getThreadId()).toBe(threadId);
      expect(agent.getCurrentState()).toBe('idle');
      expect(agent.getAvailableTools()).toEqual([]);
    });

    it('should return copy of tools to prevent mutation', () => {
      const tools = [new MockTool({ isError: false, content: [] })];
      agent = createAgent({ tools });

      const returnedTools = agent.getAvailableTools();
      expect(returnedTools).toEqual(tools);
      expect(returnedTools).not.toBe(tools); // Different array reference
    });

    it('should start in idle state and not running', () => {
      agent = createAgent();
      expect(agent.getCurrentState()).toBe('idle');
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start and stop correctly', () => {
      agent = createAgent();

      agent.start();
      expect(agent.getCurrentState()).toBe('idle');

      agent.stop();
      expect(agent.getCurrentState()).toBe('idle');
    });

    it('should emit state change events', () => {
      agent = createAgent();
      const stateChangeSpy = vi.fn();
      agent.on('state_change', stateChangeSpy);

      agent.start();
      // Start doesn't change state (already idle), so no emission
      expect(stateChangeSpy).not.toHaveBeenCalled();
    });

    it('should throw error when sending message before start', async () => {
      agent = createAgent();

      await expect(agent.sendMessage('test')).rejects.toThrow('Agent is not started');
    });

    it('should throw error when continuing conversation before start', async () => {
      agent = createAgent();

      await expect(agent.continueConversation()).rejects.toThrow('Agent is not started');
    });
  });

  describe('conversation processing', () => {
    beforeEach(() => {
      agent = createAgent();
      agent.start();
    });

    it('should process simple message and emit events', async () => {
      const events: string[] = [];

      agent.on('agent_thinking_start', () => events.push('thinking_start'));
      agent.on('agent_thinking_complete', () => events.push('thinking_complete'));
      agent.on('agent_response_complete', () => events.push('response_complete'));
      agent.on('conversation_complete', () => events.push('conversation_complete'));
      agent.on('state_change', ({ from, to }) => events.push(`state:${from}->${to}`));

      await agent.sendMessage('Hello');

      expect(events).toEqual([
        'state:idle->thinking',
        'thinking_start',
        'thinking_complete',
        'response_complete',
        'state:thinking->idle',
        'conversation_complete',
      ]);
    });

    it('should add user message to thread', async () => {
      await agent.sendMessage('Test message');

      const events = threadManager.getEvents(threadId);
      const userMessages = events.filter((e) => e.type === 'USER_MESSAGE');
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].data).toBe('Test message');
    });

    it('should add agent response to thread', async () => {
      await agent.sendMessage('Test message');

      const events = threadManager.getEvents(threadId);
      const agentMessages = events.filter((e) => e.type === 'AGENT_MESSAGE');
      expect(agentMessages).toHaveLength(1);
      expect(agentMessages[0].data).toBe('Test response');
    });

    it('should handle think blocks correctly', async () => {
      mockProvider = new MockProvider({
        content: '<think>I need to process this</think>This is my response',
        toolCalls: [],
      });
      agent = createAgent({ provider: mockProvider });
      agent.start();

      const thinkingComplete = vi.fn();
      const responseComplete = vi.fn();

      agent.on('agent_thinking_complete', thinkingComplete);
      agent.on('agent_response_complete', responseComplete);

      await agent.sendMessage('Test');

      expect(thinkingComplete).toHaveBeenCalledWith({
        content: '<think>I need to process this</think>This is my response',
      });
      expect(responseComplete).toHaveBeenCalledWith({
        content: 'This is my response',
      });
    });

    it('should handle empty message correctly', async () => {
      await agent.sendMessage('   '); // Whitespace only

      const events = threadManager.getEvents(threadId);
      const userMessages = events.filter((e) => e.type === 'USER_MESSAGE');
      expect(userMessages).toHaveLength(0); // Empty messages not added
    });

    it('should continue conversation without adding new user message', async () => {
      // Add a user message first
      await agent.sendMessage('Initial message');

      const eventsBefore = threadManager.getEvents(threadId).length;

      // Continue conversation
      await agent.continueConversation();

      const eventsAfter = threadManager.getEvents(threadId);
      const newEvents = eventsAfter.slice(eventsBefore);

      // Should only add agent message, no new user message
      expect(newEvents.filter((e) => e.type === 'USER_MESSAGE')).toHaveLength(0);
      expect(newEvents.filter((e) => e.type === 'AGENT_MESSAGE')).toHaveLength(1);
    });
  });

  describe('tool execution', () => {
    let mockTool: MockTool;

    beforeEach(() => {
      mockTool = new MockTool({
        isError: false,
        content: [{ type: 'text', text: 'Tool executed successfully' }],
      });

      toolExecutor.registerTool(mockTool.name, mockTool);

      // Create a provider that stops after one tool call to prevent infinite recursion
      let callCount = 0;
      mockProvider = new MockProvider({
        content: 'I will use a tool',
        toolCalls: [
          {
            id: 'call_123',
            name: 'mock_tool',
            input: { action: 'test' },
          },
        ],
      });

      // Override createResponse to stop after first call
      vi.spyOn(mockProvider, 'createResponse').mockImplementation(async (..._args) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: 'I will use a tool',
            toolCalls: [
              {
                id: 'call_123',
                name: 'mock_tool',
                input: { action: 'test' },
              },
            ],
          };
        } else {
          return {
            content: 'Tool completed, all done',
            toolCalls: [],
          };
        }
      });

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });
      agent.start();
    });

    it('should execute tools and emit events', async () => {
      const events: Array<{ type: string; data?: any }> = [];

      agent.on('tool_call_start', (data) => events.push({ type: 'tool_start', data }));
      agent.on('tool_call_complete', (data) => events.push({ type: 'tool_complete', data }));
      agent.on('state_change', ({ from, to }) =>
        events.push({ type: 'state_change', data: `${from}->${to}` })
      );

      await agent.sendMessage('Use the tool');

      const toolEvents = events.filter((e) => e.type.startsWith('tool_'));
      expect(toolEvents).toHaveLength(2);

      expect(toolEvents[0]).toEqual({
        type: 'tool_start',
        data: {
          toolName: 'mock_tool',
          input: { action: 'test' },
          callId: 'call_123',
        },
      });

      expect(toolEvents[1].data.toolName).toBe('mock_tool');
      expect(toolEvents[1].data.callId).toBe('call_123');
      expect(toolEvents[1].data.result.isError).toBe(false);
    });

    it('should transition to tool_execution state during tool calls', async () => {
      const stateChanges: string[] = [];
      agent.on('state_change', ({ from, to }) => stateChanges.push(`${from}->${to}`));

      await agent.sendMessage('Use the tool');

      expect(stateChanges).toContain('thinking->tool_execution');
      expect(stateChanges).toContain('tool_execution->thinking'); // After recursion
    });

    it('should add tool calls and results to thread', async () => {
      await agent.sendMessage('Use the tool');

      const events = threadManager.getEvents(threadId);

      const toolCalls = events.filter((e) => e.type === 'TOOL_CALL');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].data).toEqual({
        toolName: 'mock_tool',
        input: { action: 'test' },
        callId: 'call_123',
      });

      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0].data).toEqual({
        callId: 'call_123',
        output: 'Tool executed successfully',
        success: true,
        error: undefined,
      });
    });

    it('should handle tool execution errors gracefully', async () => {
      const failingTool = new MockTool({
        isError: true,
        content: [{ type: 'text', text: 'Tool failed' }],
      });

      toolExecutor.registerTool(failingTool.name, failingTool);

      // Mock tool executor to throw error
      const executeSpy = vi.spyOn(toolExecutor, 'executeTool');
      executeSpy.mockRejectedValueOnce(new Error('Execution error'));

      const errorEvents: any[] = [];
      agent.on('tool_call_complete', (data) => {
        if (data.result.isError) {
          errorEvents.push(data);
        }
      });

      await agent.sendMessage('Use the tool');

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].result.isError).toBe(true);
      expect(errorEvents[0].result.content[0].text).toBe('Execution error');
    });

    it('should recurse for next response after tool execution', async () => {
      // Set up provider to return different responses
      let callCount = 0;
      vi.spyOn(mockProvider, 'createResponse').mockImplementation(async (..._args) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: 'Using tool',
            toolCalls: [
              {
                id: 'call_123',
                name: 'mock_tool',
                input: { action: 'test' },
              },
            ],
          };
        } else {
          return {
            content: 'Tool completed, here is the result',
            toolCalls: [],
          };
        }
      });

      const responseEvents: string[] = [];
      agent.on('agent_response_complete', ({ content }) => responseEvents.push(content));

      await agent.sendMessage('Use the tool');

      expect(responseEvents).toHaveLength(2);
      expect(responseEvents[0]).toBe('Using tool');
      expect(responseEvents[1]).toBe('Tool completed, here is the result');
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      agent = createAgent();
      agent.start();
    });

    it('should emit error event when provider fails', async () => {
      const errorProvider = new MockProvider({
        content: '',
        toolCalls: [],
      });

      vi.spyOn(errorProvider, 'createResponse').mockRejectedValue(new Error('Provider error'));

      agent = createAgent({ provider: errorProvider });
      agent.start();

      const errorEvents: any[] = [];
      agent.on('error', (data) => errorEvents.push(data));

      await agent.sendMessage('Test');

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].error.message).toBe('Provider error');
      expect(errorEvents[0].context.phase).toBe('provider_response');
    });

    it('should return to idle state after error', async () => {
      const errorProvider = new MockProvider({
        content: '',
        toolCalls: [],
      });

      vi.spyOn(errorProvider, 'createResponse').mockRejectedValue(new Error('Provider error'));

      agent = createAgent({ provider: errorProvider });
      agent.start();

      // Add error listener to prevent unhandled error
      agent.on('error', () => {
        // Error is expected, just consume it
      });

      await agent.sendMessage('Test');

      expect(agent.getCurrentState()).toBe('idle');
    });
  });

  describe('conversation history', () => {
    beforeEach(() => {
      agent = createAgent();
      agent.start();
    });

    it('should build conversation history from thread events', async () => {
      await agent.sendMessage('First message');
      await agent.sendMessage('Second message');

      const history = threadManager.buildConversation(threadId);

      expect(history.length).toBeGreaterThanOrEqual(4); // 2 user + 2 agent messages minimum

      const userMessages = history.filter((msg) => msg.role === 'user');
      expect(userMessages).toHaveLength(2);
      expect(userMessages[0].content).toBe('First message');
      expect(userMessages[1].content).toBe('Second message');
    });

    it('should return current conversation state', async () => {
      const historyBefore = threadManager.buildConversation(threadId);

      await agent.sendMessage('Test message');

      const historyAfter = threadManager.buildConversation(threadId);
      expect(historyAfter.length).toBeGreaterThan(historyBefore.length);
    });
  });

  describe('pause/resume functionality', () => {
    beforeEach(() => {
      agent = createAgent();
    });

    it('should throw error for unimplemented pause', () => {
      expect(() => agent.pause()).toThrow('Pause/resume not yet implemented');
    });

    it('should throw error for unimplemented resume', () => {
      expect(() => agent.resume()).toThrow('Pause/resume not yet implemented');
    });
  });

  describe('event type safety', () => {
    beforeEach(() => {
      agent = createAgent();
      agent.start();
    });

    it('should provide type-safe event listeners', async () => {
      // This test verifies TypeScript compilation - if it compiles, types are correct
      agent.on('agent_thinking_start', () => {
        // No parameters expected
      });

      agent.on('agent_token', ({ token }) => {
        expect(typeof token).toBe('string');
      });

      agent.on('state_change', ({ from, to }) => {
        expect(typeof from).toBe('string');
        expect(typeof to).toBe('string');
      });

      agent.on('error', ({ error, context }) => {
        expect(error).toBeInstanceOf(Error);
        expect(typeof context).toBe('object');
      });

      // Trigger an event to verify listeners work
      await agent.sendMessage('Test');
    });
  });

  describe('multiple tool calls', () => {
    beforeEach(() => {
      const tool1 = new MockTool({
        isError: false,
        content: [{ type: 'text', text: 'Tool 1 result' }],
      });
      const tool2 = new MockTool({
        isError: false,
        content: [{ type: 'text', text: 'Tool 2 result' }],
      });

      tool1.name = 'tool_1';
      tool2.name = 'tool_2';

      toolExecutor.registerTool(tool1.name, tool1);
      toolExecutor.registerTool(tool2.name, tool2);

      // Create provider that stops after tool calls to prevent infinite recursion
      let callCount = 0;
      mockProvider = new MockProvider({
        content: 'Using multiple tools',
        toolCalls: [
          { id: 'call_1', name: 'tool_1', input: { action: 'first' } },
          { id: 'call_2', name: 'tool_2', input: { action: 'second' } },
        ],
      });

      // Override to stop after first tool call
      vi.spyOn(mockProvider, 'createResponse').mockImplementation(async (..._args) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: 'Using multiple tools',
            toolCalls: [
              { id: 'call_1', name: 'tool_1', input: { action: 'first' } },
              { id: 'call_2', name: 'tool_2', input: { action: 'second' } },
            ],
          };
        } else {
          return {
            content: 'All tools completed',
            toolCalls: [],
          };
        }
      });

      agent = createAgent({
        provider: mockProvider,
        tools: [tool1, tool2],
      });
      agent.start();
    });

    it('should execute multiple tools in sequence', async () => {
      const toolStartEvents: any[] = [];
      const toolCompleteEvents: any[] = [];

      agent.on('tool_call_start', (data) => toolStartEvents.push(data));
      agent.on('tool_call_complete', (data) => toolCompleteEvents.push(data));

      await agent.sendMessage('Use multiple tools');

      expect(toolStartEvents).toHaveLength(2);
      expect(toolCompleteEvents).toHaveLength(2);

      expect(toolStartEvents[0].toolName).toBe('tool_1');
      expect(toolStartEvents[1].toolName).toBe('tool_2');

      expect(toolCompleteEvents[0].toolName).toBe('tool_1');
      expect(toolCompleteEvents[1].toolName).toBe('tool_2');
    });

    it('should add all tool calls and results to thread', async () => {
      await agent.sendMessage('Use multiple tools');

      const events = threadManager.getEvents(threadId);

      const toolCalls = events.filter((e) => e.type === 'TOOL_CALL');
      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');

      expect(toolCalls).toHaveLength(2);
      expect(toolResults).toHaveLength(2);

      expect((toolCalls[0].data as any).toolName).toBe('tool_1');
      expect((toolCalls[1].data as any).toolName).toBe('tool_2');
    });
  });

  describe('streaming functionality', () => {
    class MockStreamingProvider extends MockProvider {
      private _supportsStreaming = true;
      protected _config: any;

      constructor(config: any) {
        super(config);
        this._config = config;
      }

      get supportsStreaming(): boolean {
        return this._supportsStreaming;
      }

      get config(): any {
        return this._config;
      }

      async createStreamingResponse(..._args: any[]): Promise<any> {
        // Simulate streaming by emitting tokens
        const text = 'Streaming response token by token';
        const tokens = text.split(' ');

        // Emit tokens synchronously for testing
        for (const token of tokens) {
          this.emit('token', { token: token + ' ' });
        }

        // Return final response
        return {
          content: text,
          toolCalls: [],
        };
      }
    }

    class MockNonStreamingProvider extends MockProvider {
      constructor(config: any) {
        super({
          content: 'Non-streaming response',
          toolCalls: [],
        });
        this._config = config;
      }

      get supportsStreaming(): boolean {
        return false;
      }

      get config(): any {
        return this._config;
      }

      protected _config: any;
    }

    describe('with streaming provider', () => {
      let streamingProvider: MockStreamingProvider;

      beforeEach(() => {
        streamingProvider = new MockStreamingProvider({ streaming: true });
        agent = createAgent({ provider: streamingProvider });
        agent.start();
      });

      afterEach(() => {
        agent?.removeAllListeners();
        streamingProvider?.removeAllListeners();
      });

      it('should emit agent_token events during streaming', async () => {
        const tokenEvents: string[] = [];

        agent.on('agent_token', ({ token }) => {
          tokenEvents.push(token);
        });

        await agent.sendMessage('Test streaming');

        expect(tokenEvents.length).toBeGreaterThan(0);
        expect(tokenEvents.join('')).toContain('Streaming');
      });

      it('should set state to streaming during streaming response', async () => {
        const stateChanges: any[] = [];

        agent.on('state_change', ({ from, to }) => {
          stateChanges.push({ from, to });
        });

        await agent.sendMessage('Test streaming');

        const streamingStateChange = stateChanges.find((sc) => sc.to === 'streaming');
        expect(streamingStateChange).toBeDefined();
      });

      it('should handle streaming errors properly', async () => {
        const errorEvents: any[] = [];

        agent.on('error', ({ error, context }) => {
          errorEvents.push({ error, context });
        });

        // Mock streaming error
        streamingProvider.createStreamingResponse = vi
          .fn()
          .mockRejectedValue(new Error('Streaming failed'));

        await agent.sendMessage('Trigger error');

        expect(errorEvents.length).toBeGreaterThan(0);
        expect(errorEvents[0].error.message).toBe('Streaming failed');
        expect(errorEvents[0].context.phase).toBe('provider_response');
      });

      it('should clean up provider event listeners after streaming', async () => {
        const initialListenerCount = streamingProvider.listenerCount('token');

        await agent.sendMessage('Test cleanup');

        const finalListenerCount = streamingProvider.listenerCount('token');
        expect(finalListenerCount).toBe(initialListenerCount);
      });
    });

    describe('with non-streaming provider', () => {
      let nonStreamingProvider: MockNonStreamingProvider;

      beforeEach(() => {
        nonStreamingProvider = new MockNonStreamingProvider({ streaming: false });
        agent = createAgent({ provider: nonStreamingProvider });
        agent.start();
      });

      afterEach(() => {
        agent?.removeAllListeners();
      });

      it('should not emit agent_token events with non-streaming provider', async () => {
        const tokenEvents: string[] = [];

        agent.on('agent_token', ({ token }) => {
          tokenEvents.push(token);
        });

        await agent.sendMessage('Test non-streaming');

        expect(tokenEvents).toHaveLength(0);
      });

      it('should not set state to streaming with non-streaming provider', async () => {
        const stateChanges: any[] = [];

        agent.on('state_change', ({ from, to }) => {
          stateChanges.push({ from, to });
        });

        await agent.sendMessage('Test non-streaming');

        const streamingStateChange = stateChanges.find((sc) => sc.to === 'streaming');
        expect(streamingStateChange).toBeUndefined();
      });

      it('should fall back to createResponse method', async () => {
        const createResponseSpy = vi.spyOn(nonStreamingProvider, 'createResponse');
        const createStreamingSpy = vi.spyOn(nonStreamingProvider, 'createStreamingResponse');

        await agent.sendMessage('Test fallback');

        expect(createResponseSpy).toHaveBeenCalled();
        expect(createStreamingSpy).not.toHaveBeenCalled();
      });
    });

    describe('streaming configuration', () => {
      it('should prefer streaming when both supported and configured', async () => {
        const streamingProvider = new MockStreamingProvider({ streaming: true });
        const createStreamingSpy = vi.spyOn(streamingProvider, 'createStreamingResponse');
        const createResponseSpy = vi.spyOn(streamingProvider, 'createResponse');

        agent = createAgent({ provider: streamingProvider });
        agent.start();

        await agent.sendMessage('Test streaming preference');

        expect(createStreamingSpy).toHaveBeenCalled();
        expect(createResponseSpy).not.toHaveBeenCalled();

        agent.removeAllListeners();
        streamingProvider.removeAllListeners();
      });

      it('should use non-streaming when supported but not configured', async () => {
        const streamingProvider = new MockStreamingProvider({ streaming: false });
        const createStreamingSpy = vi.spyOn(streamingProvider, 'createStreamingResponse');
        const createResponseSpy = vi.spyOn(streamingProvider, 'createResponse');

        agent = createAgent({ provider: streamingProvider });
        agent.start();

        await agent.sendMessage('Test non-streaming when disabled');

        expect(createStreamingSpy).not.toHaveBeenCalled();
        expect(createResponseSpy).toHaveBeenCalled();

        agent.removeAllListeners();
        streamingProvider.removeAllListeners();
      });
    });
  });
});
