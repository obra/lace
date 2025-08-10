// ABOUTME: Integration tests for multi-agent task management workflows
// ABOUTME: Tests end-to-end scenarios including task creation, assignment, and collaboration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskCreateTool,
  TaskListTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/tools';
import { ToolContext } from '~/tools/types';
import { asThreadId, createNewAgentSpec } from '~/threads/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  cleanupTestProviderInstances,
  createTestProviderInstance,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ProviderRegistry } from '~/providers/registry';

// Mock provider for testing integration
class MockProvider extends BaseMockProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return Promise.resolve({
      content: 'Mock integration response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }
}

describe('Multi-Agent Task Manager Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let session: Session;
  let project: Project;
  let mockProvider: MockProvider;
  let providerInstanceId: string;
  let createTool: TaskCreateTool;
  let listTool: TaskListTool;
  let updateTool: TaskUpdateTool;
  let noteTool: TaskAddNoteTool;
  let viewTool: TaskViewTool;

  // Simulate three agents in a parent thread
  const _parentThreadId = asThreadId('lace_20250703_parent');
  const _agent2ThreadId = asThreadId('lace_20250703_parent.2');
  const _agent3ThreadId = asThreadId('lace_20250703_parent.3');
  let mainAgentContext: ToolContext;
  let agent2Context: ToolContext;
  let agent3Context: ToolContext;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Task Manager Instance',
      apiKey: 'test-anthropic-key',
    });

    // Use simpler provider defaults approach instead of setupTestProviderInstances
    mockProvider = new MockProvider();

    // TODO: Update this test to use real provider instances with mocked responses
    // instead of mocking the internal createProvider method. This would involve:
    // 1. Creating a test provider instance using createTestProviderInstance
    // 2. Mocking the HTTP responses at the network level
    // 3. Or creating a custom test provider type that can be registered
    // For now, we're using the @internal createProvider method
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(
      (_name: string, _config?: unknown) => {
        return mockProvider;
      }
    );

    // Mock the ProviderRegistry createProvider method
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(() => mockProvider);

    // Create project first with provider configuration
    project = Project.create(
      'Integration Test Project',
      '/tmp/test-integration',
      'Test project for task manager integration',
      {
        providerInstanceId, // Use real provider instance
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    // Create session - it inherits provider config from project
    session = Session.create({
      name: 'Integration Test Session',
      projectId: project.getId(),
    });

    // Get tools from session agent's toolExecutor
    const agent = session.getAgent(session.getId())!;
    const toolExecutor = agent.toolExecutor;
    createTool = toolExecutor.getTool('task_add') as TaskCreateTool;
    listTool = toolExecutor.getTool('task_list') as TaskListTool;
    updateTool = toolExecutor.getTool('task_update') as TaskUpdateTool;
    noteTool = toolExecutor.getTool('task_add_note') as TaskAddNoteTool;
    viewTool = toolExecutor.getTool('task_view') as TaskViewTool;

    // Initialize contexts - all agents share the same session/TaskManager
    // This tests are really testing task management within a single session
    // with different actors (threadIds) working on shared tasks
    mainAgentContext = {
      signal: new AbortController().signal,
      agent,
    };

    // For testing purposes, we'll use the same agent for all contexts
    // The task manager uses threadId from the task context to track
    // who created/updated tasks, not from the agent
    agent2Context = {
      signal: new AbortController().signal,
      agent,
    };
    agent3Context = {
      signal: new AbortController().signal,
      agent,
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
    session?.destroy();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
    cleanupTestProviderDefaults();
  });

  describe('Multi-agent task workflow', () => {
    it.skip('should support full lifecycle of multi-agent task collaboration', async () => {
      // SKIP: This test assumes multiple agents can exist in one session,
      // but the current architecture has one agent per session.
      // Tasks are session-scoped, not project-scoped.
      // Step 1: Main agent creates a task
      const createResult = await createTool.execute(
        {
          tasks: [
            {
              title: 'Implement user authentication',
              description: 'Add secure login functionality',
              prompt:
                'Create a JWT-based authentication system with login, logout, and session management',
              priority: 'high',
            },
          ],
        },
        mainAgentContext
      );

      expect(createResult.status).toBe('completed');
      const taskId = createResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
      expect(taskId).toBeTruthy();

      // Step 2: Main agent lists tasks
      const listResult1 = await listTool.execute(
        {
          filter: 'created',
        },
        mainAgentContext
      );

      expect(listResult1.status).toBe('completed');
      expect(listResult1.content?.[0]?.text).toContain('Implement user authentication');

      // Step 3: Main agent assigns task to agent2
      const assignResult = await updateTool.execute(
        {
          taskId,
          assignTo: agent2Context.agent!.threadId,
        },
        mainAgentContext
      );

      expect(assignResult.status).toBe('completed');

      // Step 4: Agent2 sees the task in their list (using agent2's tools)
      const agent2ListTool = agent2Context.agent!.toolExecutor.getTool('task_list') as TaskListTool;
      const listResult2 = await agent2ListTool.execute(
        {
          filter: 'mine',
        },
        agent2Context
      );

      expect(listResult2.status).toBe('completed');
      expect(listResult2.content?.[0]?.text).toContain('Implement user authentication');

      // Step 5: Agent2 updates status to in_progress
      const statusResult = await updateTool.execute(
        {
          taskId,
          status: 'in_progress',
        },
        agent2Context
      );

      expect(statusResult.status).toBe('completed');

      // Step 6: Agent2 adds a progress note
      const noteResult1 = await noteTool.execute(
        {
          taskId,
          note: 'Started implementing JWT token generation',
        },
        agent2Context
      );

      expect(noteResult1.status).toBe('completed');

      // Step 7: Main agent adds a note with additional requirements
      const noteResult2 = await noteTool.execute(
        {
          taskId,
          note: 'Please also add refresh token support',
        },
        mainAgentContext
      );

      expect(noteResult2.status).toBe('completed');

      // Step 8: Agent3 can see all tasks in the thread
      const listResult3 = await listTool.execute(
        {
          filter: 'thread',
        },
        agent3Context
      );

      expect(listResult3.status).toBe('completed');
      expect(listResult3.content?.[0]?.text).toContain('Implement user authentication');

      // Step 9: Verify task has all notes using TaskViewTool
      const finalViewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(finalViewResult.status).toBe('completed');

      const taskDetails = finalViewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('JWT token generation');
      expect(taskDetails).toContain('refresh token support');
      expect(taskDetails).toContain('in_progress');

      // Should have 2 notes in the output
      const noteMatches = taskDetails.match(/\d+\. \[lace_\d{8}_[a-z0-9]{6}(\.\d+)?\]/g);
      expect(noteMatches).toHaveLength(2);
    });
  });

  describe('New agent assignment workflow', () => {
    it('should handle task assignment to new agent specification', async () => {
      // Create task assigned to a new agent spec
      const newAgentSpec = createNewAgentSpec(providerInstanceId, 'claude-3-5-haiku-20241022');
      const createResult = await createTool.execute(
        {
          tasks: [
            {
              title: 'Research best practices',
              prompt: 'Research and document best practices for JWT security',
              priority: 'medium',
              assignedTo: newAgentSpec,
            },
          ],
        },
        mainAgentContext
      );

      expect(createResult.status).toBe('completed');
      const taskId = createResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';

      // Verify task shows new agent assignment using TaskViewTool
      const viewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(viewResult.status).toBe('completed');
      // After agent spawning, the task should be assigned to the spawned agent thread ID
      const taskDetails = viewResult.content?.[0]?.text || '';
      expect(taskDetails).toMatch(/Assigned to: \w+\.\d+/); // Should show delegate thread ID
      expect(taskDetails).toContain('in_progress'); // Should be in progress after spawning

      // Later, reassign to actual agent
      const actualAgentResult = await updateTool.execute(
        {
          taskId,
          assignTo: agent3Context.agent!.threadId,
        },
        mainAgentContext
      );

      expect(actualAgentResult.status).toBe('completed');

      // Verify reassignment using TaskViewTool
      const viewResult2 = await viewTool.execute({ taskId }, mainAgentContext);
      expect(viewResult2.status).toBe('completed');
      expect(viewResult2.content?.[0]?.text).toContain(agent3Context.agent!.threadId);
    });
  });

  describe('Thread task visibility', () => {
    it('should share tasks between threads in the same session', async () => {
      // Create a different parent thread context
      const otherAgentContext: ToolContext = {
        signal: new AbortController().signal,
        agent: session.getAgent(session.getId())!,
      };

      // Create task in main thread
      await createTool.execute(
        {
          tasks: [
            {
              title: 'Main thread task',
              prompt: 'Do something in main thread',
              priority: 'high',
            },
          ],
        },
        mainAgentContext
      );

      // Create task in other thread
      await createTool.execute(
        {
          tasks: [
            {
              title: 'Other thread task',
              prompt: 'Do something in other thread',
              priority: 'low',
            },
          ],
        },
        otherAgentContext
      );

      // Both agents should see all tasks in the session (collaborative context)
      const mainListResult = await listTool.execute(
        {
          filter: 'thread',
        },
        mainAgentContext
      );

      expect(mainListResult.content?.[0]?.text).toContain('Main thread task');
      expect(mainListResult.content?.[0]?.text).toContain('Other thread task');

      // Other agent should also see both tasks
      const otherListResult = await listTool.execute(
        {
          filter: 'thread',
        },
        otherAgentContext
      );

      expect(otherListResult.content?.[0]?.text).toContain('Other thread task');
      expect(otherListResult.content?.[0]?.text).toContain('Main thread task');
    });
  });

  describe('Session isolation', () => {
    it('should isolate tasks between different sessions', async () => {
      // Create a second session with different project (with provider config)
      const project2 = Project.create(
        'Session 2 Project',
        '/tmp/test-session2',
        'Second test project for session isolation',
        {
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }
      );
      const session2 = Session.create({
        name: 'Session 2 Test',
        projectId: project2.getId(),
      });

      // Get tools from second session
      const agent2 = session2.getAgent(session2.getId());
      const toolExecutor2 = agent2!.toolExecutor;
      const createTool2 = toolExecutor2.getTool('task_add') as TaskCreateTool;
      const listTool2 = toolExecutor2.getTool('task_list') as TaskListTool;

      const session2Context = {
        signal: new AbortController().signal,
        agent: session2.getAgent(session2.getId())!,
      };

      try {
        // Create task in first session
        await createTool.execute(
          {
            tasks: [
              {
                title: 'Session 1 task',
                prompt: 'Task in session 1',
                priority: 'high',
              },
            ],
          },
          mainAgentContext
        );

        // Create task in second session
        await createTool2.execute(
          {
            tasks: [
              {
                title: 'Session 2 task',
                prompt: 'Task in session 2',
                priority: 'medium',
              },
            ],
          },
          session2Context
        );

        // Session 1 should only see its own task
        const session1ListResult = await listTool.execute({ filter: 'thread' }, mainAgentContext);

        expect(session1ListResult.content?.[0]?.text).toContain('Session 1 task');
        expect(session1ListResult.content?.[0]?.text).not.toContain('Session 2 task');

        // Session 2 should only see its own task
        const session2ListResult = await listTool2.execute({ filter: 'thread' }, session2Context);

        expect(session2ListResult.content?.[0]?.text).toContain('Session 2 task');
        expect(session2ListResult.content?.[0]?.text).not.toContain('Session 1 task');
      } finally {
        // Clean up second session
        session2.destroy();
      }
    });
  });

  describe('Concurrent access', () => {
    it.skip('should handle concurrent task updates', async () => {
      // SKIP: Test assumes multiple distinct agents, but we have one agent per session
      // Create a task
      const createResult = await createTool.execute(
        {
          tasks: [
            {
              title: 'Concurrent test task',
              prompt: 'Test concurrent access',
              priority: 'medium',
            },
          ],
        },
        mainAgentContext
      );

      const taskId = createResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';

      // Simulate concurrent note additions
      const notePromises = [
        noteTool.execute({ taskId, note: 'Note from agent 1' }, mainAgentContext),
        noteTool.execute({ taskId, note: 'Note from agent 2' }, agent2Context),
        noteTool.execute({ taskId, note: 'Note from agent 3' }, agent3Context),
      ];

      const results = await Promise.all(notePromises);

      // All should succeed
      results.forEach((result) => {
        expect(result.status).toBe('completed');
      });

      // Verify all notes were added using TaskViewTool
      const viewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(viewResult.status).toBe('completed');

      const taskDetails = viewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('Note from agent 1');
      expect(taskDetails).toContain('Note from agent 2');
      expect(taskDetails).toContain('Note from agent 3');

      // Should have 3 notes in the output (each note shows as "N. [author] timestamp")
      const noteMatches = taskDetails.match(/\d+\. \[lace_\d{8}_[a-z0-9]{6}(\.\d+)?\]/g);
      expect(noteMatches).toHaveLength(3);
    });
  });

  describe('Task filtering and visibility', () => {
    it.skip('should correctly filter tasks by different criteria', async () => {
      // SKIP: Test assumes multiple distinct agents with different threadIds
      // Create various tasks
      await createTool.execute(
        {
          tasks: [
            {
              title: 'Task created by agent1',
              prompt: 'Do something',
              priority: 'high',
            },
          ],
        },
        mainAgentContext
      );

      await createTool.execute(
        {
          tasks: [
            {
              title: 'Task assigned to agent2',
              prompt: 'Do something else',
              priority: 'medium',
              assignedTo: agent2Context.agent!.threadId,
            },
          ],
        },
        mainAgentContext
      );

      await createTool.execute(
        {
          tasks: [
            {
              title: 'Task created by agent2',
              prompt: 'Do another thing',
              priority: 'low',
              assignedTo: mainAgentContext.agent!.threadId,
            },
          ],
        },
        agent2Context
      );

      // Test 'mine' filter for agent1
      const mineResult = await listTool.execute({ filter: 'mine' }, mainAgentContext);
      expect(mineResult.content?.[0]?.text).toContain('Task created by agent2'); // Assigned to agent1
      expect(mineResult.content?.[0]?.text).not.toContain('Task assigned to agent2');

      // Test 'created' filter for agent1
      const createdResult = await listTool.execute({ filter: 'created' }, mainAgentContext);
      expect(createdResult.content?.[0]?.text).toContain('Task created by agent1');
      expect(createdResult.content?.[0]?.text).toContain('Task assigned to agent2');
      expect(createdResult.content?.[0]?.text).not.toContain('Task created by agent2');

      // Test 'all' filter for agent2
      const allResult = await listTool.execute({ filter: 'all' }, agent2Context);
      expect(allResult.content?.[0]?.text).toContain('Task assigned to agent2');
      expect(allResult.content?.[0]?.text).toContain('Task created by agent2');
      // Should see all thread tasks
      expect(allResult.content?.[0]?.text).toContain('Task created by agent1');
    });
  });
});
