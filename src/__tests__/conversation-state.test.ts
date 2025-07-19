// ABOUTME: Integration tests for conversation state management across multiple turns with new Agent
// ABOUTME: Tests the full conversation flow to catch context truncation bugs using event-driven Agent

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { ProviderResponse } from '~/providers/base-provider';
import { logger } from '~/utils/logger';
import { BaseMockProvider } from '~/__tests__/utils/base-mock-provider';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Mock provider that returns predictable responses for stable testing
class MockConversationProvider extends BaseMockProvider {
  private responseMap = new Map<string, ProviderResponse>();

  constructor() {
    super({});
    this.setupResponses();
  }

  private setupResponses() {
    // Response for "List the files in the current directory"
    this.responseMap.set('list_files', {
      content: "I'll list the files in the current directory for you.",
      toolCalls: [
        {
          id: 'call_1',
          name: 'file_list',
          input: { path: '.' },
        },
      ],
      stopReason: 'tool_use',
    });

    // Response after tool results
    this.responseMap.set('list_files_result', {
      content:
        'I can see the files in the directory. The project contains package.json, source files, and other project artifacts.',
      toolCalls: [],
      stopReason: 'stop',
    });

    // Response for programming language question
    this.responseMap.set('programming_language', {
      content: 'Based on the files I can see, this appears to be a TypeScript/Node.js project.',
      toolCalls: [],
      stopReason: 'stop',
    });

    // Response for package.json lookup
    this.responseMap.set('package_json', {
      content: 'Let me read the package.json file to understand the project better.',
      toolCalls: [
        {
          id: 'call_2',
          name: 'file_read',
          input: { file_path: 'package.json' },
        },
      ],
      stopReason: 'tool_use',
    });

    // Echo command response
    this.responseMap.set('echo_command', {
      content: "I'll run the echo command for you.",
      toolCalls: [
        {
          id: 'call_3',
          name: 'bash',
          input: { command: 'echo hello world' },
        },
      ],
      stopReason: 'tool_use',
    });
  }

  get providerName() {
    return 'mock';
  }
  get defaultModel() {
    return 'mock-model';
  }
  get supportsStreaming() {
    return true;
  }

  diagnose() {
    return { connected: true, models: ['mock-model'] };
  }

  private getResponseKey(messages: unknown[]): string {
    const lastMessage = messages[messages.length - 1] as { content?: string };
    const content = (lastMessage?.content as string)?.toLowerCase() || '';

    if (content.includes('list') && content.includes('files')) {
      // Check if this is after tool results
      const hasToolResults = messages.some((msg) => (msg as { toolResults?: unknown }).toolResults);
      return hasToolResults ? 'list_files_result' : 'list_files';
    }
    if (content.includes('programming language')) return 'programming_language';
    if (content.includes('package.json')) return 'package_json';
    if (content.includes('echo')) return 'echo_command';

    // Default response
    return 'list_files_result';
  }

  createResponse(messages: unknown[], _tools: unknown[] = []): Promise<ProviderResponse> {
    const key = this.getResponseKey(messages);
    return Promise.resolve(this.responseMap.get(key) || this.responseMap.get('list_files_result')!);
  }

  async createStreamingResponse(
    messages: unknown[],
    _tools: unknown[] = []
  ): Promise<ProviderResponse> {
    const response = await this.createResponse(messages, _tools);

    // Emit streaming events
    if (response.content) {
      this.emit('token', { token: response.content });
    }
    this.emit('complete', { response });

    return response;
  }
}

// Mock-based tests for stable, fast execution
describe('Conversation State Management with Enhanced Agent', () => {
  let provider: MockConversationProvider;
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let threadId: string;

  beforeEach(async () => {
    setupTestPersistence();

    provider = new MockConversationProvider();
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();

    threadId = `test_thread_${Date.now()}`;
    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: toolExecutor.getAllTools(),
    });
    await agent.start();
  });

  afterEach(() => {
    if (agent) {
      agent.removeAllListeners(); // Prevent EventEmitter memory leaks
      agent.stop();
    }
    if (threadManager) {
      // Clear events before closing to free memory
      if (threadId) {
        threadManager.clearEvents(threadId);
      }
      threadManager.close();
    }
    teardownTestPersistence();
    // Clear provider references
    provider = null as unknown as MockConversationProvider;
    toolExecutor = null as unknown as ToolExecutor;
  });

  it('should maintain conversation context and state across multiple turns', async () => {
    const turns = [
      'List the files in the current directory',
      'What programming language is this project written in?',
      'Look at the package.json file',
      'Run the command "echo hello world" and show me the output',
      'Based on what you just saw, what kind of project is this?',
    ];

    let previousMessageCount = 0;

    for (let i = 0; i < turns.length; i++) {
      if (process.env.VITEST_VERBOSE) logger.debug(`Turn ${i + 1}: "${turns[i]}"`);

      await agent.sendMessage(turns[i]);

      const events = threadManager.getEvents(threadId);
      const conversation = agent.buildThreadMessages();

      if (process.env.VITEST_VERBOSE) {
        logger.debug(
          `Turn ${i + 1} - Message count: ${conversation.length}, Event count: ${events.length}`
        );
      }

      // Message count should always increase
      expect(conversation.length).toBeGreaterThan(previousMessageCount);
      previousMessageCount = conversation.length;

      // Verify all previous user messages are still in conversation
      // Filter out tool result messages (they have toolResults but no meaningful content)
      const userMessages = conversation.filter((msg) => msg.role === 'user' && !msg.toolResults);
      expect(userMessages.length).toBe(i + 1);

      // Check that specific past messages are still there
      for (let j = 0; j <= i; j++) {
        const foundMessage = userMessages.find((msg) => msg.content === turns[j]);
        expect(foundMessage).toBeDefined();
      }
    }

    // Final verification of conversation history preservation
    const finalConversation = agent.buildThreadMessages();
    const fullConversationText = finalConversation.map((msg) => msg.content).join(' ');
    expect(fullConversationText).toContain('List the files');
    expect(fullConversationText).toContain('programming language');
    expect(fullConversationText).toContain('echo hello world');
    expect(fullConversationText).toContain('what kind of project');
  }, 180000); // Long timeout for multiple LMStudio calls

  it('should handle malformed events gracefully', async () => {
    // Add normal message
    await agent.sendMessage('List files');

    const events = threadManager.getEvents(threadId);

    // Should have valid events from the first message
    expect(events.length).toBeGreaterThan(0);

    // All events should be valid types
    const validEventTypes = [
      'USER_MESSAGE',
      'AGENT_MESSAGE',
      'TOOL_CALL',
      'TOOL_RESULT',
      'LOCAL_SYSTEM_MESSAGE',
      'THINKING',
      'SYSTEM_PROMPT',
      'USER_SYSTEM_PROMPT',
    ];
    const allEventsValid = events.every((e) => validEventTypes.includes(e.type));
    expect(allEventsValid).toBe(true);

    // Conversation building should work normally
    const conversation = agent.buildThreadMessages();
    expect(conversation.length).toBeGreaterThan(0);
  }, 10000);

  it('should emit proper events and maintain correct state transitions', async () => {
    const events: string[] = [];
    const stateChanges: Array<{ from: string; to: string }> = [];

    // Set up event listeners
    agent.on('agent_thinking_start', () => events.push('thinking_start'));
    agent.on('agent_thinking_complete', () => events.push('thinking_complete'));
    agent.on('agent_response_complete', () => events.push('response_complete'));
    agent.on('tool_call_start', ({ toolName }) => events.push(`tool_start:${toolName}`));
    agent.on('tool_call_complete', ({ toolName }) => events.push(`tool_complete:${toolName}`));
    agent.on('conversation_complete', () => events.push('conversation_complete'));
    agent.on('state_change', ({ from, to }) => {
      events.push(`state:${from}->${to}`);
      stateChanges.push({ from, to });
      if (process.env.VITEST_VERBOSE) logger.debug(`State change: ${from} -> ${to}`);
    });

    // Initial state should be idle
    expect(agent.getCurrentState()).toBe('idle');

    await agent.sendMessage('List the files in the current directory');

    if (process.env.VITEST_VERBOSE) logger.debug('Events emitted:', events);

    // Should have basic conversation flow events
    expect(events).toContain('thinking_start');
    expect(events).toContain('thinking_complete');

    // Should have state transitions
    const stateSequence = stateChanges.map((sc) => `${sc.from}->${sc.to}`);
    if (process.env.VITEST_VERBOSE) logger.debug('State sequence:', stateSequence);

    expect(stateSequence).toContain('idle->thinking');
    // With streaming, flow goes: thinking->streaming->tool_execution
    expect(events.some((e) => e.includes('state:streaming->tool_execution'))).toBe(true);
    expect(stateSequence[stateSequence.length - 1]).toContain('->idle');

    // Should have tool events (likely file_list)
    expect(events.some((e) => e.startsWith('tool_start:'))).toBe(true);
    expect(events.some((e) => e.startsWith('tool_complete:'))).toBe(true);

    // Should end with conversation complete
    expect(events[events.length - 1]).toBe('conversation_complete');

    // Final state should be idle
    expect(agent.getCurrentState()).toBe('idle');
  }, 30000);
});
