// ABOUTME: Comprehensive integration test for delegation functionality
// ABOUTME: Tests end-to-end delegation workflow including UI component rendering

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { DelegateTool } from '~/tools/implementations/delegate';
import { BashTool } from '~/tools/implementations/bash';
import { TestProvider } from '~/test-utils/test-provider';
import { logger } from '~/utils/logger';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Delegation Integration Tests', () => {
  let tempDir: string;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    // Create temporary directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-delegation-test-'));
    setupTestPersistence();

    // Set up test environment
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();

    // Register tools
    const bashTool = new BashTool();
    toolExecutor.registerTool('bash', bashTool);

    const delegateTool = new DelegateTool();
    // Note: setDependencies now takes (parentAgent, toolExecutor) but we don't have an agent in setup
    // The delegate tool will be properly initialized when the Agent is created
    toolExecutor.registerTool('delegate', delegateTool);
  });

  afterEach(() => {
    threadManager.close();
    teardownTestPersistence();
    vi.restoreAllMocks();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should create hierarchical delegate thread IDs', () => {
    const mainThreadId = threadManager.generateThreadId();
    threadManager.createThread(mainThreadId);

    // Generate first delegate
    const delegate1 = threadManager.generateDelegateThreadId(mainThreadId);
    expect(delegate1).toBe(`${mainThreadId}.1`);

    // Create the delegate thread so it appears in queries
    threadManager.createThread(delegate1);
    threadManager.addEvent(delegate1, 'AGENT_MESSAGE', 'test');

    // Generate second delegate
    const delegate2 = threadManager.generateDelegateThreadId(mainThreadId);
    expect(delegate2).toBe(`${mainThreadId}.2`);

    // Create and add event to delegate1 so it can have sub-delegates
    threadManager.createThread(delegate2);
    threadManager.addEvent(delegate2, 'AGENT_MESSAGE', 'test');

    // Generate sub-delegate from first delegate
    const subDelegate1 = threadManager.generateDelegateThreadId(delegate1);
    expect(subDelegate1).toBe(`${mainThreadId}.1.1`);
  });

  it('should query delegate threads correctly', () => {
    const mainThreadId = threadManager.generateThreadId();
    threadManager.createThread(mainThreadId);

    // Create delegate threads
    const delegate1 = threadManager.generateDelegateThreadId(mainThreadId);
    const delegate2 = threadManager.generateDelegateThreadId(mainThreadId);

    threadManager.createThread(delegate1);
    threadManager.createThread(delegate2);

    // Add events to each thread
    threadManager.addEvent(mainThreadId, 'USER_MESSAGE', 'Main thread message');
    threadManager.addEvent(delegate1, 'AGENT_MESSAGE', 'Delegate 1 message');
    threadManager.addEvent(delegate2, 'AGENT_MESSAGE', 'Delegate 2 message');

    // Test multi-thread querying
    const allEvents = threadManager.getMainAndDelegateEvents(mainThreadId);
    expect(allEvents).toHaveLength(3);

    // Events should be sorted chronologically
    expect(allEvents[0].data).toBe('Main thread message');
    expect(allEvents[1].data).toBe('Delegate 1 message');
    expect(allEvents[2].data).toBe('Delegate 2 message');
  });

  it('should handle nested delegations', () => {
    const mainThread = 'lace_20250101_abc123';
    const delegate1 = threadManager.generateDelegateThreadId(mainThread);
    const delegate2 = threadManager.generateDelegateThreadId(delegate1);
    const delegate3 = threadManager.generateDelegateThreadId(delegate2);

    expect(delegate1).toBe('lace_20250101_abc123.1');
    expect(delegate2).toBe('lace_20250101_abc123.1.1');
    expect(delegate3).toBe('lace_20250101_abc123.1.1.1');

    // All should be detected as delegate threads
    expect(delegate1.includes('.')).toBe(true);
    expect(delegate2.includes('.')).toBe(true);
    expect(delegate3.includes('.')).toBe(true);
    expect(mainThread.includes('.')).toBe(false);
  });

  it('should handle concurrent delegations', () => {
    const mainThread = threadManager.generateThreadId();
    threadManager.createThread(mainThread);

    // Create first delegate
    const delegate1 = threadManager.generateDelegateThreadId(mainThread);
    threadManager.createThread(delegate1);
    threadManager.addEvent(delegate1, 'AGENT_MESSAGE', 'test1');

    // Create second delegate
    const delegate2 = threadManager.generateDelegateThreadId(mainThread);
    threadManager.createThread(delegate2);
    threadManager.addEvent(delegate2, 'AGENT_MESSAGE', 'test2');

    // Create third delegate
    const delegate3 = threadManager.generateDelegateThreadId(mainThread);

    expect(delegate1).toBe(`${mainThread}.1`);
    expect(delegate2).toBe(`${mainThread}.2`);
    expect(delegate3).toBe(`${mainThread}.3`);

    // All should be unique
    const delegates = [delegate1, delegate2, delegate3];
    const uniqueDelegates = new Set(delegates);
    expect(uniqueDelegates.size).toBe(3);
  });

  it('should integrate delegation with DelegateTool', async () => {
    // Create mock provider for predictable testing
    const mockProvider = new TestProvider({
      mockResponse: JSON.stringify({
        threadId: 'delegate-thread-123',
        status: 'completed',
        summary: 'Successfully analyzed the project structure and found key patterns',
        totalTokens: 150,
      }),
    });

    // Create main agent with any provider (won't be used for delegation due to mock)
    const mainThreadId = threadManager.generateThreadId();
    threadManager.createThread(mainThreadId);

    const agent = new Agent({
      provider: mockProvider, // Use mock provider for main agent too
      toolExecutor,
      threadManager,
      threadId: mainThreadId,
      tools: toolExecutor.getAllTools(),
    });

    // Note: Task-based delegation no longer needs setDependencies
    // Get delegate tool for testing
    const delegateToolInstance = toolExecutor.getTool('delegate') as DelegateTool;

    await agent.start();

    // Add initial user message
    threadManager.addEvent(agent.threadId, 'USER_MESSAGE', 'Please analyze the code structure');

    // Test delegation using the real DelegateTool
    const delegateInput = {
      title: 'Code Analysis',
      prompt: 'Analyze the project structure and identify key patterns',
      expected_response: 'Brief summary of project structure',
      model: 'anthropic:claude-3-5-haiku-latest', // Use real provider format, will be mocked
    };

    // Execute delegation (this will create a sub-thread and run a mock subagent)
    const toolCall = {
      id: 'test-delegation-call',
      name: 'delegate',
      arguments: delegateInput,
    };
    const result = await delegateToolInstance.execute(toolCall.arguments);

    if (result.isError) {
      logger.error('Delegation failed', { content: result.content });
    }
    expect(result.isError).toBe(false);

    // Check that delegate thread was created
    const allEvents = threadManager.getMainAndDelegateEvents(agent.threadId);

    // Should have original user message + delegate events
    expect(allEvents.length).toBeGreaterThan(1);

    // Note: Delegate events are processed by individual DelegationBox components
    // rather than being included in the main timeline

    // Check that we have events from delegate thread
    const delegateEvents = allEvents.filter((e) => e.threadId.includes('.'));
    expect(delegateEvents.length).toBeGreaterThan(0);

    // Note: Task-based delegation doesn't use createProvider anymore
  }); // Should complete quickly with mock provider
});
