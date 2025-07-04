// ABOUTME: Integration tests for thread compaction with Agent
// ABOUTME: Tests end-to-end compaction workflow including agent-triggered compaction

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Agent } from '../../agents/agent.js';
import { ThreadManager } from '../thread-manager.js';
import { ToolExecutor } from '../../tools/executor.js';
import { AIProvider, ProviderMessage, ProviderResponse } from '../../providers/base-provider.js';
import { Tool } from '../../tools/tool.js';
import { SummarizeStrategy } from '../compaction/summarize-strategy.js';

// Mock provider for testing
class MockProvider extends AIProvider {
  private mockResponse: ProviderResponse = {
    content: 'I understand.',
    toolCalls: [],
  };

  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  setMockResponse(content: string): void {
    this.mockResponse = {
      content,
      toolCalls: [],
    };
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return this.mockResponse;
  }
}

describe('Compaction Integration', () => {
  let tempDbPath: string;
  let threadManager: ThreadManager;
  let agent: Agent;
  let mockProvider: MockProvider;
  let toolExecutor: ToolExecutor;

  beforeEach(async () => {
    tempDbPath = path.join(os.tmpdir(), `lace-test-${Date.now()}.db`);
    threadManager = new ThreadManager(tempDbPath);
    
    // Configure compaction strategy with lower token limit for testing
    threadManager['_compactionStrategy'] = new SummarizeStrategy({ 
      maxTokens: 1000, // Much lower for testing
      preserveRecentEvents: 2 
    });
    
    mockProvider = new MockProvider();
    toolExecutor = new ToolExecutor();

    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();
  });

  afterEach(async () => {
    await agent?.stop();
    await threadManager?.close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  it('should trigger compaction automatically during conversation', async () => {
    const originalThreadId = agent.getThreadId();
    
    // Add multiple messages to trigger compaction
    const message = 'This is a message that will contribute to hitting the token limit. '.repeat(50);
    
    // Mock provider to return simple responses
    mockProvider.setMockResponse('I understand.');
    
    // Send multiple messages to trigger compaction
    for (let i = 0; i < 8; i++) {
      await agent.sendMessage(`${message} Message ${i}`);
    }

    // Check if compaction occurred (thread ID should change)
    const finalThreadId = agent.getThreadId();
    const eventsAfterCompaction = threadManager.getEvents(finalThreadId);
    
    // Should have compacted the thread
    expect(finalThreadId).not.toBe(originalThreadId);
    
    // Should have fewer events due to compaction
    expect(eventsAfterCompaction.length).toBeLessThan(16); // 8 user + 8 agent = 16, compaction should reduce this significantly
    
    // Check that we have a summary event
    const summaryEvent = eventsAfterCompaction.find(e => 
      e.type === 'LOCAL_SYSTEM_MESSAGE' && 
      typeof e.data === 'string' && 
      e.data.includes('Summarized')
    );
    expect(summaryEvent).toBeDefined();
    
    // Should maintain canonical ID mapping
    expect(threadManager.getCanonicalId(finalThreadId)).toBe(originalThreadId);
  });

  it('should continue conversation normally after compaction', async () => {
    const originalThreadId = agent.getThreadId();
    
    // Trigger compaction
    const message = 'Message that will trigger compaction. '.repeat(50);
    mockProvider.setMockResponse('Got it.');
    
    for (let i = 0; i < 5; i++) {
      await agent.sendMessage(message);
    }

    // Verify compaction occurred
    const compactedThreadId = agent.getThreadId();
    expect(compactedThreadId).not.toBe(originalThreadId);

    // Continue conversation after compaction
    mockProvider.setMockResponse('Hello there!');
    await agent.sendMessage('Hello after compaction');

    const finalEvents = threadManager.getEvents(compactedThreadId);
    const lastEvent = finalEvents[finalEvents.length - 1];
    
    expect(lastEvent.type).toBe('AGENT_MESSAGE');
    expect(lastEvent.data).toBe('Hello there!');
  });
});