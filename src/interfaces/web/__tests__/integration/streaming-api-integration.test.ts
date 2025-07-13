// ABOUTME: Integration tests for streaming conversation API with real Agent flow
// ABOUTME: Tests complete Server-Sent Events streaming with Agent event processing

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { POST } from '~/interfaces/web/app/api/conversations/stream/route';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/__tests__/utils/test-provider';
import { setSharedAgent } from '~/interfaces/web/lib/agent-context';

describe('Streaming API Integration', () => {
  let testDir: string;
  let agent: Agent;
  let threadManager: ThreadManager;
  let testProvider: TestProvider;

  beforeEach(async () => {
    // Create isolated test environment
    testDir = await mkdtemp(join(tmpdir(), 'streaming-integration-test-'));

    // Create ThreadManager with test database
    threadManager = new ThreadManager(join(testDir, 'test.db'));

    // Create dependencies
    testProvider = new TestProvider();
    const toolExecutor = new ToolExecutor();

    // Generate thread ID through ThreadManager
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    // Initialize Agent
    agent = new Agent({
      provider: testProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();
    setSharedAgent(agent);
  });

  afterEach(async () => {
    // Clean up to prevent memory leaks
    agent.stop();
    threadManager.close();
    await rm(testDir, { recursive: true, force: true });
    setSharedAgent(null as any);
  });

  it('should stream complete conversation flow with Agent events', async () => {
    // Configure test provider with custom response
    const customProvider = new TestProvider({
      mockResponse: 'Hello! I received your message.',
      delay: 10,
    });

    // Create new agent with custom provider
    const customThreadId = threadManager.generateThreadId();
    threadManager.createThread(customThreadId);

    const customAgent = new Agent({
      provider: customProvider,
      toolExecutor: new ToolExecutor(),
      threadManager,
      threadId: customThreadId,
      tools: [],
    });

    await customAgent.start();
    setSharedAgent(customAgent);

    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello world' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body reader');
    }

    const events: any[] = [];
    let done = false;

    // Read stream events with timeout
    const timeoutMs = 5000; // 5 second timeout
    const startTime = Date.now();

    while (!done && Date.now() - startTime < timeoutMs) {
      try {
        const { done: readerDone, value } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const eventData = JSON.parse(line.substring(6));
              events.push(eventData);

              // Stop reading after conversation_complete
              if (eventData.type === 'conversation_complete') {
                done = true;
                break;
              }
            }
          }
        }
      } catch (_error) {
        // Stream ended naturally
        break;
      }
    }

    reader.releaseLock();
    customAgent.stop();

    // Verify streaming events
    expect(events.length).toBeGreaterThan(0);

    // First event should be connection
    const connectionEvent = events[0];
    expect(connectionEvent.type).toBe('connection');
    expect(connectionEvent.threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    expect(connectionEvent.isNew).toBe(true);

    // Should have thinking events
    const thinkingStartEvent = events.find((e) => e.type === 'thinking_start');
    expect(thinkingStartEvent).toBeDefined();

    const thinkingCompleteEvent = events.find((e) => e.type === 'thinking_complete');
    expect(thinkingCompleteEvent).toBeDefined();

    // Should have response complete event
    const responseCompleteEvent = events.find((e) => e.type === 'response_complete');
    expect(responseCompleteEvent).toBeDefined();

    // Final event should be conversation complete
    const conversationCompleteEvent = events.find((e) => e.type === 'conversation_complete');
    expect(conversationCompleteEvent).toBeDefined();
    expect(conversationCompleteEvent.threadId).toBe(connectionEvent.threadId);
  });

  it('should handle tool calls in streaming response', async () => {
    // Create test provider that simulates a tool call
    const toolCallProvider = new TestProvider({
      mockResponse: 'I need to use a tool.',
      delay: 10,
    });

    // Override the createResponse method to include tool calls
    const originalCreateResponse = toolCallProvider.createResponse.bind(toolCallProvider);
    toolCallProvider.createResponse = async (messages, tools, signal) => {
      const response = await originalCreateResponse(messages, tools, signal);
      return {
        ...response,
        toolCalls: [
          {
            id: 'tool_call_123',
            name: 'file_read',
            input: { path: '/test/file.txt' },
          },
        ],
      };
    };

    // Create new agent with tool call provider
    const toolCallThreadId = threadManager.generateThreadId();
    threadManager.createThread(toolCallThreadId);

    const toolCallAgent = new Agent({
      provider: toolCallProvider,
      toolExecutor: new ToolExecutor(),
      threadManager,
      threadId: toolCallThreadId,
      tools: [],
    });

    await toolCallAgent.start();
    setSharedAgent(toolCallAgent);

    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Read a file please' }),
    });

    const response = await POST(request);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body reader');
    }

    const events: any[] = [];
    let done = false;

    // Read stream events with timeout
    const timeoutMs = 5000;
    const startTime = Date.now();

    while (!done && Date.now() - startTime < timeoutMs) {
      try {
        const { done: readerDone, value } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const eventData = JSON.parse(line.substring(6));
              events.push(eventData);

              // Stop reading after conversation_complete
              if (eventData.type === 'conversation_complete') {
                done = true;
                break;
              }
            }
          }
        }
      } catch (_error) {
        // Stream ended naturally
        break;
      }
    }

    reader.releaseLock();
    toolCallAgent.stop();

    // Should have tool call events
    const toolCallStart = events.find((e) => e.type === 'tool_call_start');
    expect(toolCallStart).toBeDefined();
    expect(toolCallStart.toolCall.name).toBe('file_read');
    expect(toolCallStart.toolCall.id).toBe('tool_call_123');

    const toolCallComplete = events.find((e) => e.type === 'tool_call_complete');
    expect(toolCallComplete).toBeDefined();
    expect(toolCallComplete.toolCall.name).toBe('file_read');
    expect(toolCallComplete.result).toBeDefined();
  });

  it('should handle Agent errors in streaming response', async () => {
    // Create test provider that throws error
    const errorProvider = new TestProvider({
      shouldError: true,
      delay: 10,
    });

    // Create new agent with error provider
    const errorThreadId = threadManager.generateThreadId();
    threadManager.createThread(errorThreadId);

    const errorAgent = new Agent({
      provider: errorProvider,
      toolExecutor: new ToolExecutor(),
      threadManager,
      threadId: errorThreadId,
      tools: [],
    });

    await errorAgent.start();
    setSharedAgent(errorAgent);

    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'This will fail' }),
    });

    const response = await POST(request);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body reader');
    }

    const events: any[] = [];
    let done = false;

    // Read stream events with timeout
    const timeoutMs = 5000;
    const startTime = Date.now();

    while (!done && Date.now() - startTime < timeoutMs) {
      try {
        const { done: readerDone, value } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const eventData = JSON.parse(line.substring(6));
              events.push(eventData);

              // Stop reading after error
              if (eventData.type === 'error') {
                done = true;
                break;
              }
            }
          }
        }
      } catch (_error) {
        // Stream ended naturally
        break;
      }
    }

    reader.releaseLock();
    errorAgent.stop();

    // Should have error event
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toContain('Mock provider error');
  });

  it('should persist conversation events to thread', async () => {
    // Create test provider with custom response
    const persistProvider = new TestProvider({
      mockResponse: 'Persistent response',
      delay: 10,
    });

    // Create new agent with persist provider
    const persistThreadId = threadManager.generateThreadId();
    threadManager.createThread(persistThreadId);

    const persistAgent = new Agent({
      provider: persistProvider,
      toolExecutor: new ToolExecutor(),
      threadManager,
      threadId: persistThreadId,
      tools: [],
    });

    await persistAgent.start();
    setSharedAgent(persistAgent);

    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Save this conversation' }),
    });

    const response = await POST(request);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body reader');
    }

    // Read entire stream
    let done = false;
    let threadId: string | null = null;

    const timeoutMs = 5000;
    const startTime = Date.now();

    while (!done && Date.now() - startTime < timeoutMs) {
      try {
        const { done: readerDone, value } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const eventData = JSON.parse(line.substring(6));
              if (eventData.type === 'connection') {
                threadId = eventData.threadId;
              }
              if (eventData.type === 'conversation_complete') {
                done = true;
                break;
              }
            }
          }
        }
      } catch (_error) {
        break;
      }
    }

    reader.releaseLock();
    persistAgent.stop();

    // Verify thread was created and has events
    expect(threadId).toBeDefined();
    const threadEvents = persistAgent.getThreadEvents(threadId!);
    expect(threadEvents.length).toBeGreaterThan(0);

    // Should have user message event
    const userMessageEvent = threadEvents.find((e) => e.type === 'USER_MESSAGE');
    expect(userMessageEvent).toBeDefined();
    expect(userMessageEvent!.data).toBe('Save this conversation');

    // Should have agent message event
    const agentMessageEvent = threadEvents.find((e) => e.type === 'AGENT_MESSAGE');
    expect(agentMessageEvent).toBeDefined();
  });
});
