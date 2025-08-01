// ABOUTME: E2E test for TaskManager event duplication bug
// ABOUTME: Tests real backend with HTTP streaming to verify exactly one event per task

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionService, getSessionService } from '@/lib/server/session-service';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { Project, DatabasePersistence } from '@/lib/server/lace-imports';
import { Agent } from '@/lib/server/lace-imports';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ProviderRegistry } from '~/providers/registry';
import { asThreadId, createNewAgentSpec } from '~/threads/types';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import type { StreamEvent } from '@/types/stream-events';

// Mock provider that responds with task_add tool calls
class TaskCreatingMockProvider extends BaseMockProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'task-mock';
  }

  get defaultModel(): string {
    return 'task-mock-model';
  }

  async createResponse(_messages: ProviderMessage[], tools: Tool[]): Promise<ProviderResponse> {
    // Find the task_add tool
    const taskAddTool = tools.find((t) => t.name === 'task_add');

    if (taskAddTool) {
      // Respond with a tool call to create a task
      return {
        content: "I'll create a task for you.",
        usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
        toolCalls: [
          {
            id: 'task-call-1',
            name: 'task_add',
            arguments: {
              title: 'Test Task from E2E',
              description: 'This task was created by the E2E test',
              priority: 'medium',
            },
          },
        ],
      };
    }

    return {
      content: 'Mock response without tool calls',
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

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up test persistence
    await setupTestPersistence();

    // Track event broadcast calls
    eventCounts = new Map();
    const eventStreamManager = EventStreamManager.getInstance();
    originalBroadcast = eventStreamManager.broadcast.bind(eventStreamManager);

    // Spy on broadcast to count events
    vi.spyOn(eventStreamManager, 'broadcast').mockImplementation((event) => {
      const key = `${event.eventType}:${event.data.type}`;
      eventCounts.set(key, (eventCounts.get(key) || 0) + 1);

      // Call original to maintain functionality
      return originalBroadcast(event);
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
    if (sessionService) {
      await sessionService.stopAllAgents();
      sessionService.clearActiveSessions();
    }
    await teardownTestPersistence();
    vi.restoreAllMocks();
  });

  it('should emit exactly one task:created event per task', async () => {
    // Create session
    const sessionMetadata = await sessionService.createSession(
      'Task Deduplication Test Session',
      'task-mock',
      'task-mock-model',
      testProject.id
    );

    // Create agent
    const agentSpec = createNewAgentSpec(
      asThreadId(sessionMetadata.id),
      'task-mock',
      'task-mock-model'
    );
    const agent = new Agent(agentSpec);

    // Process user message that will trigger task creation
    await agent.processUserMessage('Please create a task for testing event deduplication');

    // Wait for async events to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));

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
      testProject.id
    );

    // Access the session multiple times (this triggers setupTaskManagerEventHandlers multiple times)
    const sessionId = asThreadId(sessionMetadata.id);
    await sessionService.getSession(sessionId);
    await sessionService.getSession(sessionId);
    await sessionService.getSession(sessionId);

    // Create agent and trigger task creation
    const agentSpec = createNewAgentSpec(sessionId, 'task-mock', 'task-mock-model');
    const agent = new Agent(agentSpec);

    await agent.processUserMessage('Create a task to test duplicate listeners');

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
      testProject.id
    );

    const agent1 = new Agent(
      createNewAgentSpec(asThreadId(session1.id), 'task-mock', 'task-mock-model')
    );
    await agent1.processUserMessage('Create task 1');

    // Create second session and task
    const session2 = await sessionService.createSession(
      'Session 2',
      'task-mock',
      'task-mock-model',
      testProject.id
    );

    const agent2 = new Agent(
      createNewAgentSpec(asThreadId(session2.id), 'task-mock', 'task-mock-model')
    );
    await agent2.processUserMessage('Create task 2');

    // Wait for events
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have exactly 2 task:created events (one per task)
    const taskCreatedCount = eventCounts.get('task:task:created') || 0;

    console.log('Event counts across sessions:', Object.fromEntries(eventCounts.entries()));

    expect(taskCreatedCount).toBe(2);
  });
});
