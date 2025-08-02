// ABOUTME: E2E test for TaskManager event duplication bug
// ABOUTME: Tests real backend with HTTP streaming to verify exactly one event per task

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock server-only module
vi.mock('server-only', () => ({}));
import { NextRequest } from 'next/server';
import { SessionService, getSessionService } from '@/lib/server/session-service';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { Project } from '@/lib/server/lace-imports';
import { POST as spawnAgent } from '@/app/api/sessions/[sessionId]/agents/route';
import { POST as sendMessage } from '@/app/api/threads/[threadId]/message/route';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ProviderRegistry } from '~/providers/registry';
import { asThreadId } from '~/threads/types';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { parseResponse } from '@/lib/serialization';
import type { StreamEvent } from '@/types/stream-events';
import type { ThreadId } from '@/types/core';

// Mock provider that responds with task_add tool calls ONLY ONCE per conversation
class TaskCreatingMockProvider extends BaseMockProvider {
  private createdTasksByConversation = new Set<string>();

  constructor() {
    super({});
  }

  get providerName(): string {
    return 'task-mock';
  }

  get defaultModel(): string {
    return 'task-mock-model';
  }

  async createResponse(messages: ProviderMessage[], tools: Tool[]): Promise<ProviderResponse> {
    // Find the task_add tool
    const taskAddTool = tools.find((t) => t.name === 'task_add');

    // Only create task on first user message and if we haven't created one yet
    const hasUserMessage = messages.some((m) => m.role === 'user');
    const hasToolResult = messages.some((m) => m.role === 'tool');

    // Create a conversation key based on the first user message to distinguish different conversations
    const firstUserMessage = messages.find((m) => m.role === 'user')?.content || '';
    const conversationKey = firstUserMessage.slice(0, 50); // Use first 50 chars as conversation identifier

    if (
      taskAddTool &&
      hasUserMessage &&
      !hasToolResult &&
      !this.createdTasksByConversation.has(conversationKey)
    ) {
      this.createdTasksByConversation.add(conversationKey);
      // Respond with a tool call to create a task
      const toolArgs = {
        tasks: [
          {
            title: 'Test Task from E2E',
            prompt: 'Create a test task for E2E testing of event deduplication',
          },
        ],
      };

      const toolCallsResult = [
        {
          id: 'task-call-1',
          name: 'task_add',
          input: toolArgs, // Use 'input' not 'arguments' for ProviderToolCall
        },
      ];

      return {
        content: "I'll create a task for you.",
        usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
        toolCalls: toolCallsResult,
      };
    }

    // After tool execution, just respond normally
    return {
      content: 'Task completed successfully.',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    };
  }
}

describe('Task Event Deduplication E2E', () => {
  const _tempDir = useTempLaceDir();
  let sessionService: SessionService;
  let testProject: Project;
  let mockProvider: TaskCreatingMockProvider;
  let eventCounts: Map<string, number>;
  let originalBroadcast: (event: Omit<StreamEvent, 'id' | 'timestamp'>) => void;
  let registerSessionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up environment
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    // Set up test persistence
    setupTestPersistence();

    // Track event broadcast calls with simpler spy approach
    eventCounts = new Map();
    const eventStreamManager = EventStreamManager.getInstance();

    // Also spy on registerSession to verify it's being called
    registerSessionSpy = vi.spyOn(eventStreamManager, 'registerSession');

    // Use a simpler spy that doesn't interfere with the original function
    vi.spyOn(eventStreamManager, 'broadcast').mockImplementation((event) => {
      const key = `${event.eventType}:${event.data.type}`;
      eventCounts.set(key, (eventCounts.get(key) || 0) + 1);

      console.log(`[EVENT_SPY] Broadcasting: ${key}`);

      // Log tool calls and results to debug validation
      if (event.data.type === 'TOOL_CALL') {
        console.log(`[EVENT_SPY] Tool call:`, JSON.stringify(event.data, null, 2));
      }
      if (event.data.type === 'TOOL_RESULT') {
        console.log(`[EVENT_SPY] Tool result:`, JSON.stringify(event.data, null, 2));
      }

      // Call the original method directly on the instance
      return EventStreamManager.prototype.broadcast.call(eventStreamManager, event);
    });

    // Create real project
    testProject = Project.create(
      'Task Event Test Project',
      process.cwd(),
      'Project for testing task event deduplication'
    );

    // Set up mock provider
    mockProvider = new TaskCreatingMockProvider();

    // Mock the ProviderRegistry to return our mock provider
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(
      (_name: string, _config?: unknown) => {
        return mockProvider;
      }
    );

    // Also mock the static createWithAutoDiscovery method
    vi.spyOn(ProviderRegistry, 'createWithAutoDiscovery').mockImplementation(() => {
      const mockRegistry = {
        createProvider: () => mockProvider,
        getProvider: () => mockProvider,
        getProviderNames: () => ['task-mock'],
      } as unknown as ProviderRegistry;
      return mockRegistry;
    });

    sessionService = getSessionService();
    sessionService.clearActiveSessions();
  });

  afterEach(async () => {
    // CRITICAL: Stop agents BEFORE closing database in teardownTestPersistence
    // Just clear sessions without trying to stop agents that may be stuck
    if (sessionService) {
      sessionService.clearActiveSessions();
    }

    teardownTestPersistence();
    vi.restoreAllMocks();
  });

  it('should emit exactly one task:created event per task', async () => {
    // Create session
    const sessionMetadata = await sessionService.createSession(
      'Task Deduplication Test Session',
      'task-mock',
      'task-mock-model',
      testProject.getId()
    );

    const sessionId = sessionMetadata.id;

    // Spawn agent via API
    const spawnRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'task-creator',
        provider: 'task-mock',
        model: 'task-mock-model',
      }),
    });

    const spawnResponse = await spawnAgent(spawnRequest, {
      params: Promise.resolve({ sessionId }),
    });
    expect(spawnResponse.status).toBe(201);

    const spawnData = await parseResponse<{ agent: { threadId: ThreadId } }>(spawnResponse);
    const agentThreadId = spawnData.agent.threadId;

    // Send message via API that will trigger task creation
    const messageRequest = new NextRequest(
      `http://localhost/api/threads/${agentThreadId}/message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Please create a task for testing event deduplication' }),
      }
    );

    const messageResponse = await sendMessage(messageRequest, {
      params: Promise.resolve({ threadId: agentThreadId }),
    });
    expect(messageResponse.status).toBe(202);

    // Wait for async events to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check if registerSession was called
    console.log(`[TEST] registerSession called ${registerSessionSpy.mock.calls.length} times`);

    // Check event counts
    const taskCreatedCount = eventCounts.get('task:task:created') || 0;

    console.log('Event counts:', Object.fromEntries(eventCounts.entries()));

    // Should have exactly 1 task:created event
    expect(taskCreatedCount).toBe(1);
  });

  it('should emit exactly one event per task even with multiple session accesses', async () => {
    // Create session
    const sessionMetadata = await sessionService.createSession(
      'Multiple Access Test Session',
      'task-mock',
      'task-mock-model',
      testProject.getId()
    );

    // Access the session multiple times (this triggers setupTaskManagerEventHandlers multiple times)
    const sessionId = asThreadId(sessionMetadata.id);
    await sessionService.getSession(sessionId);
    await sessionService.getSession(sessionId);
    await sessionService.getSession(sessionId);

    // Spawn agent via API and trigger task creation
    const spawnRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'multiple-access-agent',
        provider: 'task-mock',
        model: 'task-mock-model',
      }),
    });

    const spawnResponse = await spawnAgent(spawnRequest, {
      params: Promise.resolve({ sessionId }),
    });
    expect(spawnResponse.status).toBe(201);

    const spawnData = await parseResponse<{ agent: { threadId: ThreadId } }>(spawnResponse);
    const agentThreadId = spawnData.agent.threadId;

    // Send message via API
    const messageRequest = new NextRequest(
      `http://localhost/api/threads/${agentThreadId}/message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Create a task to test duplicate listeners' }),
      }
    );

    const messageResponse = await sendMessage(messageRequest, {
      params: Promise.resolve({ threadId: agentThreadId }),
    });
    expect(messageResponse.status).toBe(202);

    // Wait for events
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check event counts - should still be exactly 1 despite multiple session accesses
    const taskCreatedCount = eventCounts.get('task:task:created') || 0;

    console.log('Event counts after multiple accesses:', Object.fromEntries(eventCounts.entries()));

    expect(taskCreatedCount).toBe(1);
  });

  it('should emit one event per task across multiple sessions', async () => {
    // Create first session and task
    const session1 = await sessionService.createSession(
      'Session 1',
      'task-mock',
      'task-mock-model',
      testProject.getId()
    );

    // Spawn agent for session 1
    const spawnRequest1 = new NextRequest(`http://localhost/api/sessions/${session1.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'session1-agent',
        provider: 'task-mock',
        model: 'task-mock-model',
      }),
    });

    const spawnResponse1 = await spawnAgent(spawnRequest1, {
      params: Promise.resolve({ sessionId: session1.id }),
    });
    expect(spawnResponse1.status).toBe(201);

    const spawnData1 = await parseResponse<{ agent: { threadId: ThreadId } }>(spawnResponse1);
    const agentThreadId1 = spawnData1.agent.threadId;

    // Send message to agent 1
    const messageRequest1 = new NextRequest(
      `http://localhost/api/threads/${agentThreadId1}/message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Create task 1' }),
      }
    );

    const messageResponse1 = await sendMessage(messageRequest1, {
      params: Promise.resolve({ threadId: agentThreadId1 }),
    });
    expect(messageResponse1.status).toBe(202);

    // Create second session and task
    const session2 = await sessionService.createSession(
      'Session 2',
      'task-mock',
      'task-mock-model',
      testProject.getId()
    );

    // Spawn agent for session 2
    const spawnRequest2 = new NextRequest(`http://localhost/api/sessions/${session2.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'session2-agent',
        provider: 'task-mock',
        model: 'task-mock-model',
      }),
    });

    const spawnResponse2 = await spawnAgent(spawnRequest2, {
      params: Promise.resolve({ sessionId: session2.id }),
    });
    expect(spawnResponse2.status).toBe(201);

    const spawnData2 = await parseResponse<{ agent: { threadId: ThreadId } }>(spawnResponse2);
    const agentThreadId2 = spawnData2.agent.threadId;

    // Send message to agent 2
    const messageRequest2 = new NextRequest(
      `http://localhost/api/threads/${agentThreadId2}/message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Create task 2' }),
      }
    );

    const messageResponse2 = await sendMessage(messageRequest2, {
      params: Promise.resolve({ threadId: agentThreadId2 }),
    });
    expect(messageResponse2.status).toBe(202);

    // Wait for events
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have exactly 2 task:created events (one per task)
    const taskCreatedCount = eventCounts.get('task:task:created') || 0;

    console.log('Event counts across sessions:', Object.fromEntries(eventCounts.entries()));

    expect(taskCreatedCount).toBe(2);
  });
});
