// ABOUTME: Comprehensive tests for the enhanced event-driven Agent class
// ABOUTME: Tests conversation processing, tool execution, state management, and event emissions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, AgentConfig, AgentState } from '~/agents/agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import {
  ProviderMessage,
  ProviderResponse,
  ProviderConfig,
  ProviderToolCall,
} from '~/providers/base-provider';
import { ToolCall, ToolResult, ToolContext } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ApprovalCallback, ApprovalDecision, ApprovalPendingError } from '~/tools/approval-types';
import { EventApprovalCallback } from '~/tools/event-approval-callback';
import { ThreadManager } from '~/threads/thread-manager';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { expectEventAdded } from '~/test-utils/event-helpers';
import { BashTool } from '~/tools/implementations/bash';

// Mock provider for testing
class MockProvider extends BaseMockProvider {
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

  createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return Promise.resolve(this.mockResponse);
  }
}

// Mock tool for testing
import { z } from 'zod';

class MockTool extends Tool {
  name = 'mock_tool';
  description = 'A mock tool for testing';
  schema = z.object({
    action: z.string(),
  });

  constructor(private result: ToolResult) {
    super();
  }

  executeValidated(
    _args: z.infer<typeof this.schema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    // Return a fresh copy to avoid ID mutation issues
    return Promise.resolve({
      ...this.result,
      content: this.result.content.map((c) => ({ ...c })),
    });
  }
}

describe('Enhanced Agent', () => {
  let mockProvider: MockProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;
  let agent: Agent;

  beforeEach(() => {
    setupTestPersistence();

    mockProvider = new MockProvider({
      content: 'Test response',
      toolCalls: [],
    });

    // Create approval callback that auto-approves for tests
    const autoApprovalCallback: ApprovalCallback = {
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    };

    toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    toolExecutor.setApprovalCallback(autoApprovalCallback);
    threadManager = new ThreadManager();
    threadId = 'test_thread_123';
    threadManager.createThread(threadId);
  });

  // Helper function to create a provider that returns tool calls only once
  function createOneTimeToolProvider(
    toolCalls: ProviderToolCall[],
    content = 'I will use the tool.'
  ) {
    let callCount = 0;
    const provider = new MockProvider({ content, toolCalls });

    vi.spyOn(provider, 'createResponse').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          content,
          toolCalls,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          stopReason: 'end_turn',
        });
      } else {
        return Promise.resolve({
          content: 'Task completed.',
          toolCalls: [],
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          stopReason: 'end_turn',
        });
      }
    });

    return provider;
  }

  afterEach(() => {
    if (agent) {
      agent.removeAllListeners(); // Prevent EventEmitter memory leaks
      agent.stop();
    }
    threadManager.close();
    teardownTestPersistence();
    // Clear mock references to prevent circular references
    mockProvider = null as unknown as MockProvider;
    toolExecutor = null as unknown as ToolExecutor;
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
    it('should start and stop correctly', async () => {
      agent = createAgent();

      await agent.start();
      expect(agent.getCurrentState()).toBe('idle');

      agent.stop();
      expect(agent.getCurrentState()).toBe('idle');
    });

    it('should emit state change events', async () => {
      agent = createAgent();
      const stateChangeSpy = vi.fn();
      agent.on('state_change', stateChangeSpy);

      await agent.start();
      // Start doesn't change state (already idle), so no emission
      expect(stateChangeSpy).not.toHaveBeenCalled();
    });

    it('should auto-start when sending message before explicit start', async () => {
      agent = createAgent();
      expect(agent.isRunning).toBe(false);

      await agent.sendMessage('test');

      expect(agent.isRunning).toBe(true);
      expect(agent.getCurrentState()).toBe('idle');
    });

    it('should auto-start when continuing conversation before explicit start', async () => {
      agent = createAgent();
      expect(agent.isRunning).toBe(false);

      // Add a user message first so there's conversation to continue
      threadManager.addEvent(agent.getThreadId(), 'USER_MESSAGE', 'Previous message');

      await agent.continueConversation();

      expect(agent.isRunning).toBe(true);
      expect(agent.getCurrentState()).toBe('idle');
    });
  });

  describe('conversation processing', () => {
    beforeEach(async () => {
      agent = createAgent();
      await agent.start();
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
      await agent.start();

      const thinkingComplete = vi.fn();
      const responseComplete = vi.fn();

      agent.on('agent_thinking_complete', thinkingComplete);
      agent.on('agent_response_complete', responseComplete);

      await agent.sendMessage('Test');

      expect(thinkingComplete).toHaveBeenCalled();
      expect(responseComplete).toHaveBeenCalledWith({
        content: 'This is my response',
      });

      // Verify that raw content (with thinking blocks) is stored in thread for model context
      const events = threadManager.getEvents(threadId);
      const agentMessage = events.find((e) => e.type === 'AGENT_MESSAGE');
      expect(agentMessage?.data).toBe('<think>I need to process this</think>This is my response');
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

    beforeEach(async () => {
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
      vi.spyOn(mockProvider, 'createResponse').mockImplementation((..._args) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            content: 'I will use a tool',
            toolCalls: [
              {
                id: 'call_123',
                name: 'mock_tool',
                input: { action: 'test' },
              },
            ],
          });
        } else {
          return Promise.resolve({
            content: 'Tool completed, all done',
            toolCalls: [],
          });
        }
      });

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });
      await agent.start();
    });

    it('should execute tools and emit events', async () => {
      const events: Array<{
        type: string;
        data?:
          | {
              toolName: string;
              input: Record<string, unknown>;
              callId: string;
              result?: ToolResult;
            }
          | string;
      }> = [];

      agent.on('tool_call_start', (data) => events.push({ type: 'tool_call_start', data }));
      agent.on('tool_call_complete', (data) =>
        events.push({ type: 'tool_call_complete', data: { ...data, input: {} } })
      );
      agent.on('state_change', ({ from, to }) =>
        events.push({ type: 'state_change', data: `${from}->${to}` })
      );

      // Send message and wait for tool execution to complete
      const toolCompletePromise = new Promise<void>((resolve) => {
        agent.on('tool_call_complete', () => resolve());
      });

      await agent.sendMessage('Use the tool');

      // Wait for tool execution to complete
      await toolCompletePromise;

      const toolEvents = events.filter((e) => e.type.startsWith('tool_'));
      expect(toolEvents).toHaveLength(2);

      expect(toolEvents[0]).toEqual({
        type: 'tool_call_start',
        data: {
          toolName: 'mock_tool',
          input: { action: 'test' },
          callId: 'call_123',
        },
      });

      expect(
        (toolEvents[1].data as { toolName: string; result: ToolResult; callId: string }).toolName
      ).toBe('mock_tool');
      expect(
        (toolEvents[1].data as { toolName: string; result: ToolResult; callId: string }).callId
      ).toBe('call_123');
      expect(
        (toolEvents[1].data as { toolName: string; result: ToolResult; callId: string }).result
          .isError
      ).toBe(false);
    });

    it('should transition to tool_execution state during tool calls', async () => {
      const stateChanges: string[] = [];
      agent.on('state_change', ({ from, to }) => stateChanges.push(`${from}->${to}`));

      await agent.sendMessage('Use the tool');

      expect(stateChanges).toContain('thinking->tool_execution');
      expect(stateChanges).not.toContain('tool_execution->idle'); // Agent stays in tool_execution until tools complete
    });

    it('should add tool calls and results to thread', async () => {
      await agent.sendMessage('Use the tool');

      // Add small delay to allow async tool execution to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const events = threadManager.getEvents(threadId);

      const toolCalls = events.filter((e) => e.type === 'TOOL_CALL');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].data).toEqual({
        id: 'call_123',
        name: 'mock_tool',
        arguments: { action: 'test' },
      });

      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      const toolResult = toolResults[0].data as ToolResult;
      expect(toolResult.id).toBe('call_123');
      expect(toolResult.isError).toBe(false);
      expect(toolResult.content[0].text).toBe('Tool executed successfully');
    });

    it('should handle tool execution errors gracefully', async () => {
      const failingTool = new MockTool({
        isError: true,
        content: [{ type: 'text', text: 'Tool failed' }],
      });

      toolExecutor.registerTool(failingTool.name, failingTool);

      const errorEvents: Array<{ toolName: string; result: ToolResult; callId: string }> = [];
      agent.on('tool_call_complete', (data) => {
        if (data.result.isError) {
          errorEvents.push(data);
        }
      });

      await agent.sendMessage('Use the tool');

      // Add delay to allow async tool execution to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].result.isError).toBe(true);
      expect(errorEvents[0].result.content[0].text).toBe('Tool failed');
    });

    it('should recurse for next response after tool execution', async () => {
      // Set up provider to return different responses
      let callCount = 0;
      vi.spyOn(mockProvider, 'createResponse').mockImplementation((..._args) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            content: 'Using tool',
            toolCalls: [
              {
                id: 'call_123',
                name: 'mock_tool',
                input: { action: 'test' },
              },
            ],
          });
        } else {
          return Promise.resolve({
            content: 'Tool completed, here is the result',
            toolCalls: [],
          });
        }
      });

      const responseEvents: string[] = [];
      agent.on('agent_response_complete', ({ content }) => responseEvents.push(content));

      await agent.sendMessage('Use the tool');

      // Add delay to allow full conversation flow to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(responseEvents).toHaveLength(2);
      expect(responseEvents[0]).toBe('Using tool');
      expect(responseEvents[1]).toBe('Tool completed, here is the result');
    });

    // New tests for non-blocking behavior
    it('should stay in tool_execution state until tools complete', async () => {
      const mockProvider = createOneTimeToolProvider(
        [
          { id: 'call_1', name: 'mock_tool', input: { action: 'test1' } },
          { id: 'call_2', name: 'mock_tool', input: { action: 'test2' } },
        ],
        'I will execute the tool.'
      );

      agent = createAgent({ provider: mockProvider });
      await agent.start();

      const stateChanges: string[] = [];
      agent.on('state_change', ({ from, to }) => stateChanges.push(`${from}->${to}`));

      const conversationPromise = agent.sendMessage('Run commands');

      // sendMessage should complete quickly (event-driven)
      await conversationPromise;

      // Agent should stay in tool_execution state until tools complete
      expect(agent.getCurrentState()).toBe('tool_execution');

      // Should have transitioned to tool_execution but not back to idle yet
      expect(stateChanges).toContain('thinking->tool_execution');
      expect(stateChanges).not.toContain('tool_execution->idle');

      // Tool calls should be created but no results yet (pending approval)
      const events = threadManager.getEvents(agent.threadId);
      const toolCalls = events.filter((e) => e.type === 'TOOL_CALL');
      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');

      expect(toolCalls).toHaveLength(2);
      expect(toolResults).toHaveLength(0); // No results yet since they weren't approved
    });

    it('should create tool call events without executing tools', async () => {
      const mockProvider = createOneTimeToolProvider(
        [{ id: 'call_1', name: 'mock_tool', input: { action: 'test' } }],
        'I will execute the tool.'
      );

      agent = createAgent({ provider: mockProvider });
      await agent.start();

      const toolStartEvents: Array<{ toolName: string; input: unknown; callId: string }> = [];
      const toolCompleteEvents: unknown[] = [];

      agent.on('tool_call_start', (data) => toolStartEvents.push(data));
      agent.on('tool_call_complete', (data) => toolCompleteEvents.push(data));

      await agent.sendMessage('Run command');

      // Should emit tool_call_start but NOT tool_call_complete
      expect(toolStartEvents).toHaveLength(1);
      expect(toolCompleteEvents).toHaveLength(0);

      expect(toolStartEvents[0]).toEqual({
        toolName: 'mock_tool',
        input: { action: 'test' },
        callId: 'call_1',
      });

      // Verify tool call event was created in thread
      const events = threadManager.getEvents(agent.threadId);
      const toolCallEvents = events.filter((e) => e.type === 'TOOL_CALL');
      expect(toolCallEvents).toHaveLength(1);

      const toolCall = toolCallEvents[0].data as ToolCall;
      expect(toolCall).toEqual({
        id: 'call_1',
        name: 'mock_tool',
        arguments: { action: 'test' },
      });
    });

    it('should create multiple tool call events for multiple tool calls', async () => {
      const mockProvider = createOneTimeToolProvider(
        [
          { id: 'call_1', name: 'mock_tool', input: { action: 'test1' } },
          { id: 'call_2', name: 'mock_tool', input: { action: 'test2' } },
          { id: 'call_3', name: 'mock_tool', input: { action: 'test3' } },
        ],
        'I will execute multiple tools.'
      );

      agent = createAgent({ provider: mockProvider });
      await agent.start();

      const toolStartEvents: Array<{ toolName: string; input: unknown; callId: string }> = [];
      agent.on('tool_call_start', (data) => toolStartEvents.push(data));

      await agent.sendMessage('Run multiple commands');

      // Should emit tool_call_start for all tools but no completions
      expect(toolStartEvents).toHaveLength(3);
      expect(toolStartEvents[0].callId).toBe('call_1');
      expect(toolStartEvents[1].callId).toBe('call_2');
      expect(toolStartEvents[2].callId).toBe('call_3');

      // Verify all tool calls were created in thread events
      const events = threadManager.getEvents(agent.threadId);
      const toolCalls = events.filter((e) => e.type === 'TOOL_CALL');
      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');

      expect(toolCalls).toHaveLength(3);
      expect(toolResults).toHaveLength(0); // No execution yet

      // Verify agent stays in tool_execution state after creating tool calls
      expect(agent.getCurrentState()).toBe('tool_execution');
    });
  });

  describe('event-driven tool execution', () => {
    let mockTool: MockTool;

    beforeEach(() => {
      mockTool = new MockTool({
        isError: false,
        content: [{ type: 'text', text: 'Tool executed successfully' }],
      });

      // Register the mock tool with the toolExecutor for these tests
      toolExecutor.registerTool('mock_tool', mockTool);
    });

    it('should execute tool when TOOL_APPROVAL_RESPONSE event received', async () => {
      // Create a provider that returns tool calls only once
      const mockProvider = createOneTimeToolProvider(
        [{ id: 'call_1', name: 'mock_tool', input: { action: 'test' } }],
        'I will execute the tool.'
      );

      // Create an approval callback that requires approval (doesn't auto-approve)
      const pendingApprovalCallback: ApprovalCallback = {
        requestApproval: () => {
          throw new ApprovalPendingError('call_1');
        },
      };

      // Override the toolExecutor's approval callback for this specific test
      toolExecutor.setApprovalCallback(pendingApprovalCallback);

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });
      await agent.start();

      // Send message to create TOOL_CALL event
      await agent.sendMessage('Run command');

      // Verify tool call was created but not executed
      let events = threadManager.getEvents(agent.threadId);
      const toolCalls = events.filter((e) => e.type === 'TOOL_CALL');
      let toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolCalls).toHaveLength(1);
      expect(toolResults).toHaveLength(0);

      // Simulate approval response
      const approvalEvent = expectEventAdded(
        threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
          toolCallId: 'call_1',
          decision: 'allow_once',
        })
      );

      // Emit the event to trigger execution
      agent.emit('thread_event_added', { event: approvalEvent, threadId: agent.threadId });

      // Wait for async execution to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify tool was executed
      events = threadManager.getEvents(agent.threadId);
      toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);

      const toolResult = toolResults[0].data as ToolResult;
      expect(toolResult.id).toBe('call_1');
      expect(toolResult.isError).toBe(false);

      // Restore auto-approval callback for other tests
      const autoApprovalCallback: ApprovalCallback = {
        requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
      };
      toolExecutor.setApprovalCallback(autoApprovalCallback);
    });

    it('should create error result when tool is denied', async () => {
      // Create tool call
      const mockProvider = createOneTimeToolProvider(
        [{ id: 'call_1', name: 'mock_tool', input: { action: 'test' } }],
        'I will execute the tool.'
      );

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });

      // Set up proper EventApprovalCallback for approval workflow
      const approvalCallback = new EventApprovalCallback(agent);
      toolExecutor.setApprovalCallback(approvalCallback);

      await agent.start();

      await agent.sendMessage('Run command');

      // Deny the tool
      const approvalEvent = expectEventAdded(
        threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
          toolCallId: 'call_1',
          decision: 'deny',
        })
      );

      agent.emit('thread_event_added', { event: approvalEvent, threadId: agent.threadId });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify error result was created
      const events = threadManager.getEvents(agent.threadId);
      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);

      const toolResult = toolResults[0].data as ToolResult;
      expect(toolResult.id).toBe('call_1');
      expect(toolResult.isError).toBe(true);
      expect(toolResult.content[0].text).toBe('Tool execution denied by user');
    });

    it('should execute multiple tools independently as approvals arrive', async () => {
      // Create multiple tool calls with one-time provider to prevent infinite recursion
      const mockProvider = createOneTimeToolProvider(
        [
          { id: 'call_1', name: 'mock_tool', input: { action: 'test1' } },
          { id: 'call_2', name: 'mock_tool', input: { action: 'test2' } },
          { id: 'call_3', name: 'mock_tool', input: { action: 'test3' } },
        ],
        'I will execute multiple tools.'
      );

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });

      // Set up proper EventApprovalCallback for approval workflow
      const approvalCallback = new EventApprovalCallback(agent);
      toolExecutor.setApprovalCallback(approvalCallback);

      await agent.start();

      await agent.sendMessage('Run commands');

      // Approve second tool first (out of order) - use agent's proper API
      agent.handleApprovalResponse('call_2', 'allow_once');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify only tool 2 executed
      let events = threadManager.getEvents(agent.threadId);
      let toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as ToolResult).id).toBe('call_2');

      // Approve first tool - use agent's proper API
      agent.handleApprovalResponse('call_1', 'allow_once');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify tool 1 also executed
      events = threadManager.getEvents(agent.threadId);
      toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(2);

      // Deny third tool - use agent's proper API
      agent.handleApprovalResponse('call_3', 'deny');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify all tools are done (2 successful, 1 error)
      events = threadManager.getEvents(agent.threadId);
      toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(3);

      const successResults = toolResults.filter((r) => !(r.data as ToolResult).isError);
      expect(successResults).toHaveLength(2);

      const errorResult = toolResults.find((r) => (r.data as ToolResult).id === 'call_3');
      expect((errorResult?.data as ToolResult).isError).toBe(true);
    });

    it('should emit tool_call_complete events when tools execute', async () => {
      const mockProvider = createOneTimeToolProvider(
        [{ id: 'call_1', name: 'mock_tool', input: { action: 'test' } }],
        'I will execute the tool.'
      );

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });

      // Set up proper EventApprovalCallback for approval workflow
      const approvalCallback = new EventApprovalCallback(agent);
      toolExecutor.setApprovalCallback(approvalCallback);

      await agent.start();

      const toolCompleteEvents: Array<{ toolName: string; result: ToolResult; callId: string }> =
        [];
      agent.on('tool_call_complete', (data) => toolCompleteEvents.push(data));

      await agent.sendMessage('Run command');

      // No completion events yet
      expect(toolCompleteEvents).toHaveLength(0);

      // Approve the tool
      const approvalEvent = expectEventAdded(
        threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
          toolCallId: 'call_1',
          decision: 'allow_once',
        })
      );
      agent.emit('thread_event_added', { event: approvalEvent, threadId: agent.threadId });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now should have completion event
      expect(toolCompleteEvents).toHaveLength(1);
      expect(toolCompleteEvents[0].toolName).toBe('mock_tool');
      expect(toolCompleteEvents[0].callId).toBe('call_1');
      expect(toolCompleteEvents[0].result.isError).toBe(false);
    });

    it('should attempt tool execution immediately instead of creating approval requests directly', async () => {
      // Mock ToolExecutor.executeTool to track calls
      const executeToolSpy = vi.spyOn(toolExecutor, 'executeTool');

      const mockProvider = createOneTimeToolProvider(
        [{ id: 'call_immediate', name: 'mock_tool', input: { action: 'test' } }],
        'I will execute the tool.'
      );

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });
      await agent.start();

      // Send message to trigger tool calls
      await agent.sendMessage('Run command');

      // Verify ToolExecutor.executeTool was called immediately
      expect(executeToolSpy).toHaveBeenCalledTimes(1);
      expect(executeToolSpy).toHaveBeenCalledWith(
        {
          id: 'call_immediate',
          name: 'mock_tool',
          arguments: { action: 'test' },
        },
        expect.objectContaining({
          threadId: expect.any(String) as string,
          parentThreadId: expect.any(String) as string,
          workingDirectory: expect.any(String) as string,
        }) as ToolContext
      );

      // Verify Agent should NOT create TOOL_APPROVAL_REQUEST events directly
      const events = threadManager.getEvents(agent.threadId);
      const approvalRequests = events.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
      expect(approvalRequests).toHaveLength(0); // Agent shouldn't create these directly

      executeToolSpy.mockRestore();
    });

    it('should handle pending tool results without completing batch tracking', async () => {
      const mockProvider = createOneTimeToolProvider(
        [
          { id: 'call_pending', name: 'mock_tool', input: { action: 'test' } },
          { id: 'call_pending2', name: 'mock_tool', input: { action: 'test2' } },
        ],
        'I will execute tools.'
      );

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });

      // Set up proper EventApprovalCallback to create pending approvals
      const approvalCallback = new EventApprovalCallback(agent);
      toolExecutor.setApprovalCallback(approvalCallback);

      await agent.start();

      // Track if batch completion methods are called prematurely
      const completeTurnSpy = vi.spyOn(agent as any, '_completeTurn');
      const processConversationSpy = vi.spyOn(agent as any, '_processConversation');

      // Send message to trigger tool calls
      await agent.sendMessage('Run commands');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify no TOOL_RESULT events were created (tools are pending)
      const events = threadManager.getEvents(agent.threadId);
      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(0);

      // Verify Agent stays in tool_execution state with pending tools
      expect(agent.getCurrentState()).toBe('tool_execution');

      // CRITICAL: Agent should NOT complete the batch yet
      // Batch tracking should keep pending count > 0 until approval responses arrive
      expect(completeTurnSpy).not.toHaveBeenCalled();
      expect(processConversationSpy).not.toHaveBeenCalledTimes(2); // Called once during initial processing

      completeTurnSpy.mockRestore();
      processConversationSpy.mockRestore();
    });

    it('should complete batch tracking when non-pending tools finish', async () => {
      // Mock ToolExecutor to return completed result
      const completedResult = {
        id: 'call_complete',
        isError: false,
        isPending: false,
        content: [{ type: 'text' as const, text: 'Tool completed successfully' }],
      };
      vi.spyOn(toolExecutor, 'executeTool').mockResolvedValue(completedResult);

      // Use a provider that returns tool calls once, then regular response
      class MockProviderOnce extends MockProvider {
        private hasReturnedToolCalls = false;

        async createResponse(...args: Parameters<MockProvider['createResponse']>): Promise<any> {
          if (!this.hasReturnedToolCalls) {
            this.hasReturnedToolCalls = true;
            return super.createResponse(...args);
          }
          // Return regular response without tool calls for subsequent requests
          return {
            content: 'Task completed.',
            toolCalls: [],
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            stopReason: 'end_turn',
          };
        }
      }

      const mockProvider = new MockProviderOnce({
        content: 'I will execute tools.',
        toolCalls: [{ id: 'call_complete', name: 'mock_tool', input: { action: 'test' } }],
      });

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });
      await agent.start();

      // Track if batch completion methods are called
      const completeTurnSpy = vi.spyOn(agent as any, '_completeTurn');
      const processConversationSpy = vi.spyOn(agent as any, '_processConversation');

      // Send message to trigger tool calls
      await agent.sendMessage('Run commands');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify TOOL_RESULT event was created
      const events = threadManager.getEvents(agent.threadId);
      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);

      // CRITICAL: Agent SHOULD complete the batch when all tools are done
      // This should trigger conversation continuation since no rejections occurred
      expect(completeTurnSpy).toHaveBeenCalled();
      expect(processConversationSpy).toHaveBeenCalledTimes(2); // Initial + after tool completion

      completeTurnSpy.mockRestore();
      processConversationSpy.mockRestore();
    });

    it('should handle approval responses without double-decrementing pending count', async () => {
      // Use a provider that returns tool calls once, then regular response
      class MockProviderOnce extends MockProvider {
        private hasReturnedToolCalls = false;

        async createResponse(...args: Parameters<MockProvider['createResponse']>): Promise<any> {
          if (!this.hasReturnedToolCalls) {
            this.hasReturnedToolCalls = true;
            return super.createResponse(...args);
          }
          // Return regular response without tool calls for subsequent requests
          return {
            content: 'Task completed.',
            toolCalls: [],
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            stopReason: 'end_turn',
          };
        }
      }

      const mockProvider = new MockProviderOnce({
        content: 'I will execute tools.',
        toolCalls: [{ id: 'call_approval', name: 'mock_tool', input: { action: 'test' } }],
      });

      agent = createAgent({ provider: mockProvider, tools: [mockTool] });

      // Set up proper EventApprovalCallback for approval workflow
      const approvalCallback = new EventApprovalCallback(agent);
      toolExecutor.setApprovalCallback(approvalCallback);

      await agent.start();

      // Spy on tool execute to verify call patterns (important for double-decrement detection)
      const executeToolSpy = vi.spyOn(mockTool, 'execute');

      // Send message to trigger tool execution - should wait for approval
      await agent.sendMessage('Run command');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify executeTool was NOT called yet (waiting for approval)
      expect(executeToolSpy).toHaveBeenCalledTimes(0);

      // Verify no TOOL_RESULT events yet (tool is waiting for approval)
      let events = threadManager.getEvents(agent.threadId);
      let toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(0);

      // Verify TOOL_APPROVAL_REQUEST was created
      const approvalRequests = events.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
      expect(approvalRequests).toHaveLength(1);

      // Now approve the tool
      const approvalEvent = expectEventAdded(
        threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
          toolCallId: 'call_approval',
          decision: 'allow_once',
        })
      );
      agent.emit('thread_event_added', { event: approvalEvent, threadId: agent.threadId });

      // Wait for approval processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Tool should be executed once (after approval)
      expect(executeToolSpy).toHaveBeenCalledTimes(1);

      // Should have exactly one TOOL_RESULT (no double-counting)
      events = threadManager.getEvents(agent.threadId);
      toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as ToolResult).id).toBe('call_approval');

      executeToolSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      agent = createAgent();
      await agent.start();
    });

    it('should emit error event when provider fails', async () => {
      const errorProvider = new MockProvider({
        content: '',
        toolCalls: [],
      });

      vi.spyOn(errorProvider, 'createResponse').mockRejectedValue(new Error('Provider error'));

      agent = createAgent({ provider: errorProvider });
      await agent.start();

      const errorEvents: Array<{ error: Error; context: Record<string, unknown> }> = [];
      agent.on('error', (data) => errorEvents.push(data));

      await agent.sendMessage('Test');

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].error.message).toBe('Provider error');
      expect((errorEvents[0].context as { phase: string }).phase).toBe('provider_response');
    });

    it('should return to idle state after error', async () => {
      const errorProvider = new MockProvider({
        content: '',
        toolCalls: [],
      });

      vi.spyOn(errorProvider, 'createResponse').mockRejectedValue(new Error('Provider error'));

      agent = createAgent({ provider: errorProvider });
      await agent.start();

      // Add error listener to prevent unhandled error
      agent.on('error', () => {
        // Error is expected, just consume it
      });

      await agent.sendMessage('Test');

      expect(agent.getCurrentState()).toBe('idle');
    });
  });

  describe('conversation history', () => {
    beforeEach(async () => {
      agent = createAgent();
      await agent.start();
    });

    it('should build conversation history from thread events', async () => {
      await agent.sendMessage('First message');
      await agent.sendMessage('Second message');

      const history = agent.buildThreadMessages();

      expect(history.length).toBeGreaterThanOrEqual(4); // 2 user + 2 agent messages minimum

      const userMessages = history.filter((msg) => msg.role === 'user');
      expect(userMessages).toHaveLength(2);
      expect(userMessages[0].content).toBe('First message');
      expect(userMessages[1].content).toBe('Second message');
    });

    it('should return current conversation state', async () => {
      const historyBefore = agent.buildThreadMessages();

      await agent.sendMessage('Test message');

      const historyAfter = agent.buildThreadMessages();
      expect(historyAfter.length).toBeGreaterThan(historyBefore.length);
    });

    it('should ignore LOCAL_SYSTEM_MESSAGE events in conversation', () => {
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test');
      threadManager.addEvent(threadId, 'LOCAL_SYSTEM_MESSAGE', 'System info message');
      threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Response');

      const history = agent.buildThreadMessages();

      // Should only have user and agent messages, no LOCAL_SYSTEM_MESSAGE
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('Test');
      expect(history[1].content).toBe('Response');
    });

    it('should handle orphaned tool results gracefully', () => {
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test');
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        id: 'missing-call-id',
        content: [{ type: 'text', text: 'Some output' }],
        isError: false,
      });

      // Should not throw error - orphaned tool results are now skipped
      const history = agent.buildThreadMessages();
      expect(history).toHaveLength(1); // only user message, orphaned tool result skipped
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Test');
    });

    it('should handle orphaned tool calls gracefully', () => {
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test');
      threadManager.addEvent(threadId, 'TOOL_CALL', {
        name: 'bash',
        arguments: { command: 'ls' },
        id: 'orphaned-call',
      });

      // Should not throw error
      const history = agent.buildThreadMessages();
      expect(history).toHaveLength(2); // user message + tool call as assistant message
      expect(history[1].role).toBe('assistant');
      expect(history[1].toolCalls).toBeDefined();
      expect(history[1].toolCalls).toHaveLength(1);
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
    beforeEach(async () => {
      agent = createAgent();
      await agent.start();
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
    beforeEach(async () => {
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
      vi.spyOn(mockProvider, 'createResponse').mockImplementation((..._args) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            content: 'Using multiple tools',
            toolCalls: [
              { id: 'call_1', name: 'tool_1', input: { action: 'first' } },
              { id: 'call_2', name: 'tool_2', input: { action: 'second' } },
            ],
          });
        } else {
          return Promise.resolve({
            content: 'All tools completed',
            toolCalls: [],
          });
        }
      });

      agent = createAgent({
        provider: mockProvider,
        tools: [tool1, tool2],
      });
      await agent.start();
    });

    it('should execute multiple tools in sequence', async () => {
      const toolStartEvents: Array<{
        toolName: string;
        input: Record<string, unknown>;
        callId: string;
      }> = [];
      const toolCompleteEvents: Array<{ toolName: string; result: ToolResult; callId: string }> =
        [];

      agent.on('tool_call_start', (data) => toolStartEvents.push(data));
      agent.on('tool_call_complete', (data) => toolCompleteEvents.push(data));

      await agent.sendMessage('Use multiple tools');

      // Add delay to allow multiple async tool executions to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(toolStartEvents).toHaveLength(2);
      expect(toolCompleteEvents).toHaveLength(2);

      expect(toolStartEvents[0].toolName).toBe('tool_1');
      expect(toolStartEvents[1].toolName).toBe('tool_2');

      expect(toolCompleteEvents[0].toolName).toBe('tool_1');
      expect(toolCompleteEvents[1].toolName).toBe('tool_2');
    });

    it('should add all tool calls and results to thread', async () => {
      await agent.sendMessage('Use multiple tools');

      // Add delay to allow multiple async tool executions to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const events = threadManager.getEvents(threadId);

      const toolCalls = events.filter((e) => e.type === 'TOOL_CALL');
      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');

      expect(toolCalls).toHaveLength(2);
      expect(toolResults).toHaveLength(2);

      expect((toolCalls[0].data as ToolCall).name).toBe('tool_1');
      expect((toolCalls[1].data as ToolCall).name).toBe('tool_2');
    });
  });

  describe('streaming functionality', () => {
    class MockStreamingProvider extends MockProvider {
      private _supportsStreaming = true;
      protected _config: ProviderConfig;

      constructor(config: ProviderConfig) {
        super({
          content: 'Streaming response token by token',
          toolCalls: [],
        });
        this._config = config;
      }

      get supportsStreaming(): boolean {
        return this._supportsStreaming;
      }

      get config(): ProviderConfig {
        return this._config;
      }

      createStreamingResponse(..._args: any[]): Promise<ProviderResponse> {
        // Simulate streaming by emitting tokens
        const text = 'Streaming response token by token';
        const tokens = text.split(' ');

        // Emit tokens synchronously for testing
        for (const token of tokens) {
          this.emit('token', { token: token + ' ' });
        }

        // Return final response
        return Promise.resolve({
          content: text,
          toolCalls: [],
        });
      }
    }

    class MockNonStreamingProvider extends MockProvider {
      constructor(config: ProviderConfig) {
        super({
          content: 'Non-streaming response',
          toolCalls: [],
        });
        this._config = config;
      }

      get supportsStreaming(): boolean {
        return false;
      }

      get config(): ProviderConfig {
        return this._config;
      }

      protected _config: ProviderConfig;
    }

    describe('with streaming provider', () => {
      let streamingProvider: MockStreamingProvider;

      beforeEach(async () => {
        streamingProvider = new MockStreamingProvider({ streaming: true });
        agent = createAgent({ provider: streamingProvider });
        await agent.start();
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
        const stateChanges: { from: AgentState; to: AgentState }[] = [];

        agent.on('state_change', ({ from, to }) => {
          stateChanges.push({ from, to });
        });

        await agent.sendMessage('Test streaming');

        const streamingStateChange = stateChanges.find((sc) => sc.to === 'streaming');
        expect(streamingStateChange).toBeDefined();
      });

      it('should handle streaming errors properly', async () => {
        const errorEvents: { error: Error; context: Record<string, unknown> }[] = [];

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
        expect((errorEvents[0].context as { phase: string }).phase).toBe('provider_response');
      });

      it('should clean up provider event listeners after streaming', async () => {
        const initialListenerCount = streamingProvider.listenerCount('token');

        await agent.sendMessage('Test cleanup');

        const finalListenerCount = streamingProvider.listenerCount('token');
        expect(finalListenerCount).toBe(initialListenerCount);
      });

      it('should emit all tokens during streaming, thinking block extraction handled by UI layer', async () => {
        // Override the streaming provider to return content with thinking blocks
        streamingProvider.createStreamingResponse = vi.fn().mockImplementation((..._args) => {
          // Simulate streaming tokens that include thinking blocks
          const tokens = [
            '<think>',
            'I need to',
            ' think about',
            ' this</think>',
            'Here is',
            ' my response',
          ];

          for (const token of tokens) {
            streamingProvider.emit('token', { token });
          }

          return Promise.resolve({
            content: '<think>I need to think about this</think>Here is my response',
            toolCalls: [],
          });
        });

        const streamingTokens: string[] = [];

        agent.on('agent_token', ({ token }) => {
          streamingTokens.push(token);
        });

        await agent.sendMessage('Test thinking blocks in streaming');

        // Agent should emit all tokens as received (thinking blocks are handled in UI layer)
        const allTokens = streamingTokens.join('');
        expect(allTokens).toContain('<think>');
        expect(allTokens).toContain('I need to think about this');
        expect(allTokens).toContain('</think>');
        expect(allTokens).toContain('Here is my response');

        // Thread should contain raw agent message with thinking blocks for model context
        const events = threadManager.getEvents(threadId);
        const agentMessages = events.filter((e) => e.type === 'AGENT_MESSAGE');
        expect(agentMessages).toHaveLength(1);
        expect(agentMessages[0].data).toBe(
          '<think>I need to think about this</think>Here is my response'
        );

        // Verify only expected event types exist
        const eventTypes = new Set(events.map((e) => e.type));
        expect(eventTypes).not.toContain('THINKING' as any);
      });
    });

    describe('with non-streaming provider', () => {
      let nonStreamingProvider: MockNonStreamingProvider;

      beforeEach(async () => {
        nonStreamingProvider = new MockNonStreamingProvider({ streaming: false });
        agent = createAgent({ provider: nonStreamingProvider });
        await agent.start();
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
        const stateChanges: { from: AgentState; to: AgentState }[] = [];

        agent.on('state_change', ({ from, to }) => {
          stateChanges.push({ from, to });
        });

        await agent.sendMessage('Test non-streaming');

        const streamingStateChange = stateChanges.find((sc) => sc.to === 'streaming');
        expect(streamingStateChange).toBeUndefined();
      });

      it('should fall back to createResponse method', async () => {
        // Test actual behavior: should receive response from non-streaming provider
        await agent.sendMessage('Test fallback');

        // Verify the agent processed a response (state returns to idle)
        expect(agent.getCurrentState()).toBe('idle');

        // Verify response was added to thread
        const events = threadManager.getEvents(threadId);
        const agentMessages = events.filter((e) => e.type === 'AGENT_MESSAGE');
        expect(agentMessages).toHaveLength(1);
        expect(agentMessages[0].data).toBe('Non-streaming response');
      });
    });

    describe('streaming configuration', () => {
      it('should prefer streaming when both supported and configured', async () => {
        const streamingProvider = new MockStreamingProvider({ streaming: true });
        agent = createAgent({ provider: streamingProvider });
        await agent.start();

        const tokenEvents: string[] = [];
        agent.on('agent_token', ({ token }) => {
          tokenEvents.push(token);
        });

        await agent.sendMessage('Test streaming preference');

        // Verify streaming behavior occurred (tokens were emitted)
        expect(tokenEvents.length).toBeGreaterThan(0);
        expect(tokenEvents.join('')).toContain('Streaming');

        // Verify final response was processed
        expect(agent.getCurrentState()).toBe('idle');

        agent.removeAllListeners();
        streamingProvider.removeAllListeners();
      });

      it('should use non-streaming when supported but not configured', async () => {
        const streamingProvider = new MockStreamingProvider({ streaming: false });
        agent = createAgent({ provider: streamingProvider });
        await agent.start();

        const tokenEvents: string[] = [];
        agent.on('agent_token', ({ token }) => {
          tokenEvents.push(token);
        });

        await agent.sendMessage('Test non-streaming when disabled');

        // Verify non-streaming behavior (no tokens emitted)
        expect(tokenEvents).toHaveLength(0);

        // Verify final response was processed
        expect(agent.getCurrentState()).toBe('idle');
        const events = threadManager.getEvents(threadId);
        const agentMessages = events.filter((e) => e.type === 'AGENT_MESSAGE');
        expect(agentMessages).toHaveLength(1);

        agent.removeAllListeners();
        streamingProvider.removeAllListeners();
      });
    });
  });

  describe('System prompt event handling', () => {
    it('should skip SYSTEM_PROMPT and USER_SYSTEM_PROMPT events in conversation building', async () => {
      // Manually add system prompt events to thread (simulating what Agent.start() does)
      threadManager.addEvent(threadId, 'SYSTEM_PROMPT', 'You are a helpful AI assistant.');
      threadManager.addEvent(threadId, 'USER_SYSTEM_PROMPT', 'Always be concise.');

      // Add a user message
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello, how are you?');

      // Mock the provider to capture what messages it receives
      const mockCreateResponse = vi.spyOn(mockProvider, 'createResponse');
      mockCreateResponse.mockResolvedValue({
        content: 'I am doing well, thank you for asking!',
        toolCalls: [],
      });

      agent = createAgent();
      await agent.start();
      await agent.sendMessage('Hello, how are you?');

      // Verify the provider was called
      expect(mockCreateResponse).toHaveBeenCalledTimes(1);

      // Get the messages that were sent to the provider
      const [messages] = mockCreateResponse.mock.calls[0];

      // Should only contain user messages, not system prompt events
      expect(messages).toHaveLength(2); // Two user messages: existing + new one
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello, how are you?');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('Hello, how are you?');

      // Verify no assistant messages from system prompts made it through
      const assistantMessages = messages.filter((m) => m.role === 'assistant');
      expect(assistantMessages).toHaveLength(0);
    });

    describe('duplicate system prompt prevention', () => {
      it('should add SYSTEM_PROMPT events on first start with empty thread', async () => {
        agent = createAgent();

        // Verify thread is initially empty
        const initialEvents = threadManager.getEvents(threadId);
        expect(initialEvents).toHaveLength(0);

        await agent.start();

        // Should have added both system prompt events
        const events = threadManager.getEvents(threadId);
        const systemPrompts = events.filter((e) => e.type === 'SYSTEM_PROMPT');
        const userSystemPrompts = events.filter((e) => e.type === 'USER_SYSTEM_PROMPT');

        expect(systemPrompts).toHaveLength(1);
        expect(userSystemPrompts).toHaveLength(1);
        expect(events).toHaveLength(2);
      });

      it('should NOT add duplicate SYSTEM_PROMPT events on restart', async () => {
        agent = createAgent();

        // First start - should add prompts
        await agent.start();
        const afterFirstStart = threadManager.getEvents(threadId);
        expect(afterFirstStart.filter((e) => e.type === 'SYSTEM_PROMPT')).toHaveLength(1);
        expect(afterFirstStart.filter((e) => e.type === 'USER_SYSTEM_PROMPT')).toHaveLength(1);

        // Simulate agent restart by creating new agent with same thread
        const agent2 = createAgent();
        await agent2.start();

        // Should NOT have added more prompt events
        const afterRestart = threadManager.getEvents(threadId);
        expect(afterRestart.filter((e) => e.type === 'SYSTEM_PROMPT')).toHaveLength(1);
        expect(afterRestart.filter((e) => e.type === 'USER_SYSTEM_PROMPT')).toHaveLength(1);
        expect(afterRestart).toHaveLength(2); // Same total count
      });

      it('should NOT add SYSTEM_PROMPT events if conversation already started', async () => {
        // Pre-populate thread with a user message (conversation started)
        threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello there!');

        agent = createAgent();
        await agent.start();

        // Should NOT have added system prompt events since conversation exists
        const events = threadManager.getEvents(threadId);
        const systemPrompts = events.filter((e) => e.type === 'SYSTEM_PROMPT');
        const userSystemPrompts = events.filter((e) => e.type === 'USER_SYSTEM_PROMPT');

        expect(systemPrompts).toHaveLength(0);
        expect(userSystemPrompts).toHaveLength(0);
        expect(events).toHaveLength(1); // Only the original user message
      });

      it('should NOT add SYSTEM_PROMPT events if existing prompts are already present', async () => {
        // Pre-populate thread with system prompts (e.g., from previous agent run)
        threadManager.addEvent(threadId, 'SYSTEM_PROMPT', 'Existing system prompt');

        agent = createAgent();
        await agent.start();

        // Should NOT have added more prompt events
        const events = threadManager.getEvents(threadId);
        const systemPrompts = events.filter((e) => e.type === 'SYSTEM_PROMPT');
        const userSystemPrompts = events.filter((e) => e.type === 'USER_SYSTEM_PROMPT');

        expect(systemPrompts).toHaveLength(1); // Only the original one
        expect(userSystemPrompts).toHaveLength(0);
        expect(events).toHaveLength(1); // Only the original system prompt
      });

      it('should prevent duplicates across multiple rapid starts', async () => {
        agent = createAgent();

        // Simulate rapid multiple starts (race condition scenario)
        const startPromises = [agent.start(), agent.start(), agent.start()];

        await Promise.all(startPromises);

        // Should only have one set of prompts despite multiple starts
        const events = threadManager.getEvents(threadId);
        const systemPrompts = events.filter((e) => e.type === 'SYSTEM_PROMPT');
        const userSystemPrompts = events.filter((e) => e.type === 'USER_SYSTEM_PROMPT');

        expect(systemPrompts).toHaveLength(1);
        expect(userSystemPrompts).toHaveLength(1);
        expect(events).toHaveLength(2);
      });

      it('should handle complex scenarios with mixed existing events', async () => {
        // Pre-populate thread with some system messages but no conversation or prompts
        threadManager.addEvent(threadId, 'LOCAL_SYSTEM_MESSAGE', 'Connection established');

        agent = createAgent();
        await agent.start();

        // Should have added prompts since no conversation or existing prompts
        const events = threadManager.getEvents(threadId);
        const systemPrompts = events.filter((e) => e.type === 'SYSTEM_PROMPT');
        const userSystemPrompts = events.filter((e) => e.type === 'USER_SYSTEM_PROMPT');
        const localMessages = events.filter((e) => e.type === 'LOCAL_SYSTEM_MESSAGE');

        expect(systemPrompts).toHaveLength(1);
        expect(userSystemPrompts).toHaveLength(1);
        expect(localMessages).toHaveLength(1); // Original message preserved
        expect(events).toHaveLength(3); // All events present
      });

      it('should not add prompts when both conversation and existing prompts are present', async () => {
        // Pre-populate with both conversation events and existing prompts
        threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
        threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Hi there!');
        threadManager.addEvent(threadId, 'SYSTEM_PROMPT', 'You are helpful');

        agent = createAgent();
        await agent.start();

        // Should NOT have added any new prompts
        const events = threadManager.getEvents(threadId);
        const systemPrompts = events.filter((e) => e.type === 'SYSTEM_PROMPT');
        const userSystemPrompts = events.filter((e) => e.type === 'USER_SYSTEM_PROMPT');

        expect(systemPrompts).toHaveLength(1); // Only the existing one
        expect(userSystemPrompts).toHaveLength(0);
        expect(events).toHaveLength(3); // No new events added
      });
    });
  });

  describe('conversation_complete event emission', () => {
    it('should emit conversation_complete after tool execution chain completes', async () => {
      // This test currently FAILS - demonstrating the bug
      let conversationCompleteEmitted = false;

      // Create a tool that will be called
      const mockTool = new MockTool({
        isError: false,
        content: [{ type: 'text', text: 'Tool executed successfully' }],
      });

      // Create provider that returns tool calls, then a final response
      let callCount = 0;
      const mockProvider = new MockProvider({
        content: 'Initial response',
        toolCalls: [],
      });

      vi.spyOn(mockProvider, 'createResponse').mockImplementation((..._args) => {
        callCount++;
        if (callCount === 1) {
          // First call: return tool calls
          return Promise.resolve({
            content: 'Using tool',
            toolCalls: [
              {
                id: 'call_123',
                name: 'mock_tool',
                input: { action: 'test' },
              },
            ],
          });
        } else {
          // Second call: return final response with no tool calls
          return Promise.resolve({
            content: 'Final response after tool execution',
            toolCalls: [],
          });
        }
      });

      const toolExecutor = new ToolExecutor();
      toolExecutor.registerTool(mockTool.name, mockTool);
      toolExecutor.setApprovalCallback({
        requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
      });

      agent = createAgent({ provider: mockProvider, tools: [mockTool], toolExecutor });
      await agent.start();

      // Listen for conversation_complete event
      agent.once('conversation_complete', () => {
        conversationCompleteEmitted = true;
      });

      await agent.sendMessage('Use the tool');

      // Add delay to allow full tool execution chain to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // This assertion should now pass with sufficient delay
      expect(conversationCompleteEmitted).toBe(true);
    });
  });

  describe('duplicate execution prevention', () => {
    it('should not execute tool if TOOL_RESULT already exists', async () => {
      const bashTool = new BashTool();
      const toolExecutor = new ToolExecutor();
      toolExecutor.registerTool('bash', bashTool);

      const agent = createAgent({
        provider: mockProvider,
        toolExecutor,
        tools: [bashTool],
      });

      // Create tool call event
      const toolCall: ToolCall = {
        id: 'tool-123',
        name: 'bash',
        arguments: { command: 'echo "test"' },
      };

      agent.threadManager.addEvent(agent.threadId, 'TOOL_CALL', toolCall);

      // Create existing tool result (simulates tool already executed)
      const existingResult: ToolResult = {
        id: 'tool-123',
        content: [{ type: 'text', text: 'Already executed - preventing duplicate' }],
        isError: false,
      };

      agent.threadManager.addEvent(agent.threadId, 'TOOL_RESULT', existingResult);

      // Mock tool executor to track calls
      const executeSpy = vi.spyOn(bashTool, 'execute');

      // Send approval response (this should be ignored due to duplicate guard)
      const approvalEvent = expectEventAdded(
        agent.threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
          toolCallId: 'tool-123',
          decision: 'allow_once',
        })
      );

      // Simulate event processing (this triggers _handleToolApprovalResponse)
      agent['_handleToolApprovalResponse'](approvalEvent);

      // Wait for potential async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Tool executor should not have been called due to duplicate guard
      expect(executeSpy).not.toHaveBeenCalled();

      // Should still have only one TOOL_RESULT event (the original one)
      const events = agent.threadManager.getEvents(agent.threadId);
      const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]?.data).toEqual(existingResult);
    });

    it('should execute tool normally when no TOOL_RESULT exists', async () => {
      const bashTool = new BashTool();
      const toolExecutor = new ToolExecutor();
      toolExecutor.registerTool('bash', bashTool);

      const agent = createAgent({
        provider: mockProvider,
        toolExecutor,
        tools: [bashTool],
      });

      // Create tool call event
      const toolCall: ToolCall = {
        id: 'tool-456',
        name: 'bash',
        arguments: { command: 'echo "success"' },
      };

      agent.threadManager.addEvent(agent.threadId, 'TOOL_CALL', toolCall);

      // Mock tool executor to track calls
      const executeSpy = vi.spyOn(bashTool, 'execute');
      executeSpy.mockResolvedValue({
        id: 'tool-456',
        content: [{ type: 'text', text: 'Tool executed successfully' }],
        isError: false,
      });

      // Send approval response (this should execute normally)
      const approvalEvent = expectEventAdded(
        agent.threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
          toolCallId: 'tool-456',
          decision: 'allow_once',
        })
      );

      // Simulate event processing
      agent['_handleToolApprovalResponse'](approvalEvent);

      // Wait for async tool execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Tool should have been executed
      expect(executeSpy).toHaveBeenCalledWith(toolCall.arguments, expect.any(Object));
    });
  });
});
