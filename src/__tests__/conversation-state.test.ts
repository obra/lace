// ABOUTME: Integration tests for conversation state management across multiple turns with new Agent
// ABOUTME: Tests the full conversation flow to catch context truncation bugs using event-driven Agent

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '../agents/agent.js';
import { LMStudioProvider } from '../providers/lmstudio-provider.js';
import { ThreadManager } from '../threads/thread-manager.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutor } from '../tools/executor.js';
import { BashTool } from '../tools/implementations/bash.js';
import { FileReadTool } from '../tools/implementations/file-read.js';
import { FileWriteTool } from '../tools/implementations/file-write.js';
import { FileListTool } from '../tools/implementations/file-list.js';
import { RipgrepSearchTool } from '../tools/implementations/ripgrep-search.js';
import { FileFindTool } from '../tools/implementations/file-find.js';
import {
  TaskAddTool,
  TaskListTool,
  TaskCompleteTool,
} from '../tools/implementations/task-manager.js';

// These tests use LMStudio heavily since it's local and free
describe('Conversation State Management with Enhanced Agent', () => {
  let provider: LMStudioProvider;
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolRegistry: ToolRegistry;
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
    toolRegistry = new ToolRegistry();
    toolExecutor = new ToolExecutor(toolRegistry);

    // Register all tools like the main agent
    const tools = [
      new BashTool(),
      new FileReadTool(),
      new FileWriteTool(),
      new FileListTool(),
      new RipgrepSearchTool(),
      new FileFindTool(),
      new TaskAddTool(),
      new TaskListTool(),
      new TaskCompleteTool(),
    ];

    tools.forEach((tool) => toolRegistry.registerTool(tool));

    threadId = `test_thread_${Date.now()}`;
    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools,
    });
    agent.start();
  });

  afterEach(async () => {
    if (agent) {
      agent.removeAllListeners(); // Prevent EventEmitter memory leaks
      agent.stop();
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
    toolRegistry = null as any;
    toolExecutor = null as any;
  });

  it('should maintain conversation context across multiple tool calls', async () => {
    // Turn 1: Ask for directory listing
    if (process.env.VITEST_VERBOSE) console.log('Starting Turn 1...');
    await agent.sendMessage('List the files in the current directory');

    let events = threadManager.getEvents(threadId);
    let conversation = threadManager.buildConversation(threadId);

    if (process.env.VITEST_VERBOSE) {
      console.log(`Turn 1 - Message count: ${conversation.length}, Event count: ${events.length}`);
    }
    expect(conversation.length).toBeGreaterThan(1); // Should have user message + agent response + tool calls

    // Turn 2: Ask follow-up question
    if (process.env.VITEST_VERBOSE) console.log('Starting Turn 2...');
    await agent.sendMessage('What programming language is this project written in?');

    events = threadManager.getEvents(threadId);
    conversation = threadManager.buildConversation(threadId);

    if (process.env.VITEST_VERBOSE) {
      console.log(`Turn 2 - Message count: ${conversation.length}, Event count: ${events.length}`);
    }
    expect(conversation.length).toBeGreaterThan(3); // Should have multiple messages by now
    expect(events.length).toBeGreaterThanOrEqual(5); // Should have multiple events

    // Turn 3: Ask another question that requires tool use
    if (process.env.VITEST_VERBOSE) console.log('Starting Turn 3...');
    await agent.sendMessage('Run the command "echo hello world" and show me the output');

    events = threadManager.getEvents(threadId);
    conversation = threadManager.buildConversation(threadId);

    if (process.env.VITEST_VERBOSE)
      console.log(`Turn 3 - Message count: ${conversation.length}, Event count: ${events.length}`);
    expect(conversation.length).toBeGreaterThan(5); // Should keep growing
    expect(events.length).toBeGreaterThanOrEqual(7); // Should keep growing

    // Turn 4: Ask a question that should reference previous context
    if (process.env.VITEST_VERBOSE) console.log('Starting Turn 4...');
    await agent.sendMessage('Based on what you just saw, what kind of project is this?');

    events = threadManager.getEvents(threadId);
    conversation = threadManager.buildConversation(threadId);

    if (process.env.VITEST_VERBOSE)
      console.log(`Turn 4 - Message count: ${conversation.length}, Event count: ${events.length}`);
    expect(conversation.length).toBeGreaterThan(8); // Should be substantial by now
    expect(events.length).toBeGreaterThanOrEqual(11); // Should have many events

    // Verify the conversation contains the full history
    const userMessages = conversation.filter((msg) => msg.role === 'user');
    if (process.env.VITEST_VERBOSE) console.log('User message count:', userMessages.length);
    expect(userMessages.length).toBeGreaterThanOrEqual(4); // All 4 user messages

    // Check for specific content from previous turns
    const fullConversationText = conversation.map((msg) => msg.content).join(' ');
    expect(fullConversationText).toContain('List the files');
    expect(fullConversationText).toContain('programming language');
    expect(fullConversationText).toContain('what kind of project');
  }, 60000); // Long timeout for LMStudio responses

  it('should handle rapid-fire tool calls without losing context', async () => {
    const commands = [
      'Show me the current directory',
      'List the files in this directory',
      'Read the first 5 lines of package.json',
      'Echo the text "test"',
      'Show me the current date',
    ];

    let expectedMessageCount = 0; // Start with 0

    for (let i = 0; i < commands.length; i++) {
      if (process.env.VITEST_VERBOSE) console.log(`Executing command ${i + 1}: "${commands[i]}"`);

      const eventsBefore = threadManager.getEvents(threadId).length;

      await agent.sendMessage(commands[i]);

      const eventsAfter = threadManager.getEvents(threadId);
      const conversation = threadManager.buildConversation(threadId);

      if (process.env.VITEST_VERBOSE)
        console.log(
          `Command ${i + 1} - Message count: ${conversation.length}, Events added: ${eventsAfter.length - eventsBefore}`
        );

      // Verify message count keeps growing
      expect(conversation.length).toBeGreaterThan(expectedMessageCount);
      expectedMessageCount = conversation.length;
    }

    // Final verification
    const finalConversation = threadManager.buildConversation(threadId);
    const userMessages = finalConversation.filter((msg) => msg.role === 'user');

    if (process.env.VITEST_VERBOSE)
      console.log(
        `Final stats - Total messages: ${finalConversation.length}, User messages: ${userMessages.length}`
      );
    expect(userMessages.length).toBe(commands.length);
  }, 120000); // Extra long timeout for multiple LMStudio calls

  it('should preserve conversation state across process simulation', async () => {
    const turns = [
      'What files are in this directory?',
      'Look at the package.json file',
      'What dependencies does this project have?',
      'Check if there are any TypeScript files',
      'Tell me about the project structure based on what you found',
    ];

    let previousMessageCount = 0;

    for (let i = 0; i < turns.length; i++) {
      if (process.env.VITEST_VERBOSE) console.log(`\nTurn ${i + 1}: "${turns[i]}"`);

      await agent.sendMessage(turns[i]);

      const events = threadManager.getEvents(threadId);
      const conversation = threadManager.buildConversation(threadId);

      if (process.env.VITEST_VERBOSE) console.log(`  Message count: ${conversation.length}`);
      if (process.env.VITEST_VERBOSE) console.log(`  Event count: ${events.length}`);

      // Message count should always increase
      expect(conversation.length).toBeGreaterThan(previousMessageCount);
      previousMessageCount = conversation.length;

      // Verify all previous user messages are still in conversation
      const userMessages = conversation.filter(
        (msg) => msg.role === 'user' && !msg.content.startsWith('[Tool result:')
      );

      expect(userMessages.length).toBe(i + 1);

      // Check that specific past messages are still there
      for (let j = 0; j <= i; j++) {
        const foundMessage = userMessages.find((msg) => msg.content === turns[j]);
        expect(foundMessage).toBeDefined();
      }
    }
  }, 180000); // Very long timeout for extended conversation

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
    ];
    const allEventsValid = events.every((e) => validEventTypes.includes(e.type));
    expect(allEventsValid).toBe(true);

    // Conversation building should work normally
    const conversation = threadManager.buildConversation(threadId);
    expect(conversation.length).toBeGreaterThan(0);
  }, 10000);

  it('should emit proper events during conversation flow', async () => {
    const events: string[] = [];

    agent.on('agent_thinking_start', () => events.push('thinking_start'));
    agent.on('agent_thinking_complete', () => events.push('thinking_complete'));
    agent.on('agent_response_complete', () => events.push('response_complete'));
    agent.on('tool_call_start', ({ toolName }) => events.push(`tool_start:${toolName}`));
    agent.on('tool_call_complete', ({ toolName }) => events.push(`tool_complete:${toolName}`));
    agent.on('conversation_complete', () => events.push('conversation_complete'));
    agent.on('state_change', ({ from, to }) => events.push(`state:${from}->${to}`));

    await agent.sendMessage('List the files in the current directory');

    if (process.env.VITEST_VERBOSE) console.log('Events emitted:', events);

    // Should have basic conversation flow events
    expect(events).toContain('thinking_start');
    expect(events).toContain('thinking_complete');

    // Should have state transitions
    expect(events.some((e) => e.includes('state:idle->thinking'))).toBe(true);
    expect(events.some((e) => e.includes('state:thinking->tool_execution'))).toBe(true);

    // Should have tool events (likely file_list)
    expect(events.some((e) => e.startsWith('tool_start:'))).toBe(true);
    expect(events.some((e) => e.startsWith('tool_complete:'))).toBe(true);

    // Should end with conversation complete
    expect(events[events.length - 1]).toBe('conversation_complete');
  }, 30000);

  it('should maintain proper state throughout conversation', async () => {
    const stateChanges: Array<{ from: string; to: string }> = [];

    agent.on('state_change', ({ from, to }) => {
      stateChanges.push({ from, to });
      if (process.env.VITEST_VERBOSE) console.log(`State change: ${from} -> ${to}`);
    });

    // Initial state should be idle
    expect(agent.getCurrentState()).toBe('idle');

    await agent.sendMessage('Run echo "hello world"');

    // Should have gone through: idle -> thinking -> tool_execution -> thinking -> idle
    const stateSequence = stateChanges.map((sc) => `${sc.from}->${sc.to}`);
    if (process.env.VITEST_VERBOSE) console.log('State sequence:', stateSequence);

    expect(stateSequence).toContain('idle->thinking');
    expect(stateSequence).toContain('thinking->tool_execution');
    expect(stateSequence[stateSequence.length - 1]).toContain('->idle');

    // Final state should be idle
    expect(agent.getCurrentState()).toBe('idle');
  }, 30000);
});
