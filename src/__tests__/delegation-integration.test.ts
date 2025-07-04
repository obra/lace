// ABOUTME: Comprehensive integration test for delegation functionality
// ABOUTME: Tests end-to-end delegation workflow including UI component rendering

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from '../threads/thread-manager.js';
import { ThreadProcessor } from '../interfaces/thread-processor.js';
import { Agent } from '../agents/agent.js';
import { ToolExecutor } from '../tools/executor.js';
import { DelegateTool } from '../tools/implementations/delegate.js';
import { BashTool } from '../tools/implementations/bash.js';
import { LMStudioProvider } from '../providers/lmstudio-provider.js';
import { checkProviderAvailability } from './utils/provider-test-helpers.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Delegation Integration Tests', () => {
  let tempDir: string;
  let dbPath: string;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(async () => {
    // Create temporary directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-delegation-test-'));
    dbPath = path.join(tempDir, 'test.db');

    // Set up test environment
    threadManager = new ThreadManager(dbPath);
    toolExecutor = new ToolExecutor();

    // Register tools
    const bashTool = new BashTool();
    toolExecutor.registerTool('bash', bashTool);

    const delegateTool = new DelegateTool();
    delegateTool.setDependencies(threadManager, toolExecutor);
    toolExecutor.registerTool('delegate', delegateTool);
  });

  afterEach(async () => {
    await threadManager.close();
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

  it('should query delegate threads correctly', async () => {
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

  it('should process main thread only in ThreadProcessor', () => {
    const mainThreadId = threadManager.generateThreadId();
    const delegateThreadId = `${mainThreadId}.1`;

    // Create mixed events
    const events = [
      {
        id: 'evt1',
        threadId: mainThreadId,
        type: 'USER_MESSAGE' as const,
        timestamp: new Date('2025-01-01T10:00:00Z'),
        data: 'Main message 1',
      },
      {
        id: 'evt2',
        threadId: delegateThreadId,
        type: 'AGENT_MESSAGE' as const,
        timestamp: new Date('2025-01-01T10:01:00Z'),
        data: 'Delegate message 1',
      },
      {
        id: 'evt3',
        threadId: delegateThreadId,
        type: 'AGENT_MESSAGE' as const,
        timestamp: new Date('2025-01-01T10:02:00Z'),
        data: 'Delegate message 2',
      },
      {
        id: 'evt4',
        threadId: mainThreadId,
        type: 'AGENT_MESSAGE' as const,
        timestamp: new Date('2025-01-01T10:03:00Z'),
        data: 'Main message 2',
      },
    ];

    const processor = new ThreadProcessor();
    const result = processor.processThreads(events);

    // Should return Timeline with main thread events only (ignores delegates)
    expect(result.items).toHaveLength(2);
    expect(result.items[0].type).toBe('user_message');
    expect(result.items[1].type).toBe('agent_message');

    // Delegate events are ignored by simplified processor
    const hasDelegate = result.items.some(
      (item) =>
        'content' in item && typeof item.content === 'string' && item.content.includes('Delegate')
    );
    expect(hasDelegate).toBe(false);
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
    // Create LMStudio provider for real integration testing
    const provider = new LMStudioProvider({
      baseUrl: 'ws://localhost:1234',
      model: 'qwen/qwen3-1.7b',
    });

    // Skip this test if LMStudio is not available
    const isAvailable = await checkProviderAvailability('LMStudio', provider);
    if (!isAvailable) return;

    // Create main agent with real provider
    const mainThreadId = threadManager.generateThreadId();
    threadManager.createThread(mainThreadId);

    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId: mainThreadId,
      tools: toolExecutor.getAllTools(),
    });

    await agent.start();

    // Add initial user message
    threadManager.addEvent(agent.threadId, 'USER_MESSAGE', 'Please analyze the code structure');

    // Test delegation using the real DelegateTool
    const delegateInput = {
      title: 'Code Analysis',
      prompt: 'Analyze the project structure and identify key patterns',
      expected_response: 'Brief summary of project structure',
      model: 'lmstudio:qwen/qwen3-1.7b',
    };

    const delegateTool = toolExecutor.getTool('delegate') as DelegateTool;

    // Execute delegation (this will create a sub-thread and run a real subagent)
    const toolCall = {
      id: 'test-delegation-call',
      name: 'delegate',
      arguments: delegateInput,
    };
    const result = await delegateTool.execute(toolCall.arguments);

    // Debug: Print the result to see what went wrong
    if (result.isError) {
      console.log('Delegation failed:', result.content[0]?.text);
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
  }, 60000); // 60 second timeout for real delegation

  it('should process main thread only for UI timeline', () => {
    const mainThreadId = threadManager.generateThreadId();
    const delegateThreadId = `${mainThreadId}.1`;

    const events = [
      {
        id: 'evt1',
        threadId: mainThreadId,
        type: 'USER_MESSAGE' as const,
        timestamp: new Date(),
        data: 'Analyze this code',
      },
      {
        id: 'evt2',
        threadId: delegateThreadId,
        type: 'AGENT_MESSAGE' as const,
        timestamp: new Date(),
        data: 'Starting analysis...',
      },
      {
        id: 'evt3',
        threadId: delegateThreadId,
        type: 'TOOL_CALL' as const,
        timestamp: new Date(),
        data: { id: 'call1', name: 'bash', arguments: { command: 'find .' } },
      },
      {
        id: 'evt4',
        threadId: delegateThreadId,
        type: 'TOOL_RESULT' as const,
        timestamp: new Date(),
        data: {
          id: 'call1',
          content: [{ type: 'text' as const, text: 'Found files' }],
          isError: false,
        },
      },
      {
        id: 'evt5',
        threadId: delegateThreadId,
        type: 'AGENT_MESSAGE' as const,
        timestamp: new Date(),
        data: 'Analysis complete',
      },
    ];

    const processor = new ThreadProcessor();
    const result = processor.processThreads(events);

    // Simplified processor only returns main thread events
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('user_message');

    // Delegate events are processed separately by DelegationBox components
    // when they fetch their own delegate thread data
  });
});
