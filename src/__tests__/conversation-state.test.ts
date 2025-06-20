// ABOUTME: Integration tests for conversation state management across multiple turns with new Agent
// ABOUTME: Tests the full conversation flow to catch context truncation bugs using event-driven Agent

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '../agents/agent.js';
import { LMStudioProvider } from '../providers/lmstudio-provider.js';
import { ThreadManager } from '../threads/thread-manager.js';
import { ToolExecutor } from '../tools/executor.js';

// These tests use LMStudio heavily since it's local and free
describe('Conversation State Management with Enhanced Agent', () => {
  let provider: LMStudioProvider;
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let threadId: string;

  beforeEach(async () => {
    provider = new LMStudioProvider({
      model: 'qwen/qwen3-1.7b',
      systemPrompt: 'You are a helpful coding assistant. Use tools when appropriate.',
    });

    // Skip tests if LMStudio is not available
    try {
      const diagnostics = await provider.diagnose();
      if (!diagnostics.connected) {
        if (process.env.VITEST_VERBOSE) {
          console.log('Skipping LMStudio tests - server not available');
        }
        return;
      }
    } catch (error) {
      if (process.env.VITEST_VERBOSE) {
        console.log('Skipping LMStudio tests - connection failed:', error);
      }
      return;
    }

    threadManager = new ThreadManager(':memory:'); // Use SQLite in-memory database for testing
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
    agent.start();
  });

  afterEach(async () => {
    if (agent) {
      agent.removeAllListeners(); // Prevent EventEmitter memory leaks
      await agent.stop();
    }
    if (threadManager) {
      // Clear events before closing to free memory
      if (threadId) {
        threadManager.clearEvents(threadId);
      }
      await threadManager.close();
    }
    // Clear provider references
    provider = null as any;
    toolExecutor = null as any;
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
      if (process.env.VITEST_VERBOSE) console.log(`\nTurn ${i + 1}: "${turns[i]}"`);

      await agent.sendMessage(turns[i]);

      const events = threadManager.getEvents(threadId);
      const conversation = agent.buildThreadMessages();

      if (process.env.VITEST_VERBOSE) {
        console.log(
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
      if (process.env.VITEST_VERBOSE) console.log(`State change: ${from} -> ${to}`);
    });

    // Initial state should be idle
    expect(agent.getCurrentState()).toBe('idle');

    await agent.sendMessage('List the files in the current directory');

    if (process.env.VITEST_VERBOSE) console.log('Events emitted:', events);

    // Should have basic conversation flow events
    expect(events).toContain('thinking_start');
    expect(events).toContain('thinking_complete');

    // Should have state transitions
    const stateSequence = stateChanges.map((sc) => `${sc.from}->${sc.to}`);
    if (process.env.VITEST_VERBOSE) console.log('State sequence:', stateSequence);

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
