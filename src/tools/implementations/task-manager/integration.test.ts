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
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import {
  setupTestProviderInstances,
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
  const _tempDirContext = useTempLaceDir();
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
  const parentThreadId = asThreadId('lace_20250703_parent');
  let mainAgentContext: ToolContext;
  let agent2Context: ToolContext;
  let agent3Context: ToolContext;

  beforeEach(async () => {
    setupTestPersistence();
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

    // Mock the ProviderRegistry to return our mock provider
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
    const agent = session.getAgent(session.getId());
    const toolExecutor = agent!.toolExecutor;
    createTool = toolExecutor.getTool('task_add') as TaskCreateTool;
    listTool = toolExecutor.getTool('task_list') as TaskListTool;
    updateTool = toolExecutor.getTool('task_update') as TaskUpdateTool;
    noteTool = toolExecutor.getTool('task_add_note') as TaskAddNoteTool;
    viewTool = toolExecutor.getTool('task_view') as TaskViewTool;

    // Initialize contexts with session for TaskManager access
    mainAgentContext = {
      threadId: asThreadId('lace_20250703_parent.1'),
      parentThreadId,
      session, // TaskManager accessed via session.getTaskManager()
    };
    agent2Context = {
      threadId: asThreadId('lace_20250703_parent.2'),
      parentThreadId,
      session,
    };
    agent3Context = {
      threadId: asThreadId('lace_20250703_parent.3'),
      parentThreadId,
      session,
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
    session?.destroy();
    // Clean up provider instance
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
    teardownTestPersistence();
    cleanupTestProviderDefaults();
  });

  describe('Multi-agent task workflow', () => {
    it('should support full lifecycle of multi-agent task collaboration', async () => {
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

      expect(createResult.isError).toBe(false);
      const taskId = createResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
      expect(taskId).toBeTruthy();

      // Step 2: Main agent lists tasks
      const listResult1 = await listTool.execute(
        {
          filter: 'created',
        },
        mainAgentContext
      );

      expect(listResult1.isError).toBe(false);
      expect(listResult1.content?.[0]?.text).toContain('Implement user authentication');

      // Step 3: Main agent assigns task to agent2
      const assignResult = await updateTool.execute(
        {
          taskId,
          assignTo: agent2Context.threadId!,
        },
        mainAgentContext
      );

      expect(assignResult.isError).toBe(false);

      // Step 4: Agent2 sees the task in their list
      const listResult2 = await listTool.execute(
        {
          filter: 'mine',
        },
        agent2Context
      );

      expect(listResult2.isError).toBe(false);
      expect(listResult2.content?.[0]?.text).toContain('Implement user authentication');

      // Step 5: Agent2 updates status to in_progress
      const statusResult = await updateTool.execute(
        {
          taskId,
          status: 'in_progress',
        },
        agent2Context
      );

      expect(statusResult.isError).toBe(false);

      // Step 6: Agent2 adds a progress note
      const noteResult1 = await noteTool.execute(
        {
          taskId,
          note: 'Started implementing JWT token generation',
        },
        agent2Context
      );

      expect(noteResult1.isError).toBe(false);

      // Step 7: Main agent adds a note with additional requirements
      const noteResult2 = await noteTool.execute(
        {
          taskId,
          note: 'Please also add refresh token support',
        },
        mainAgentContext
      );

      expect(noteResult2.isError).toBe(false);

      // Step 8: Agent3 can see all tasks in the thread
      const listResult3 = await listTool.execute(
        {
          filter: 'thread',
        },
        agent3Context
      );

      expect(listResult3.isError).toBe(false);
      expect(listResult3.content?.[0]?.text).toContain('Implement user authentication');

      // Step 9: Verify task has all notes using TaskViewTool
      const finalViewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(finalViewResult.isError).toBe(false);

      const taskDetails = finalViewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('JWT token generation');
      expect(taskDetails).toContain('refresh token support');
      expect(taskDetails).toContain('in_progress');

      // Should have 2 notes in the output
      const noteMatches = taskDetails.match(/\d+\. \[lace_20250703_parent\.\d+\]/g);
      expect(noteMatches).toHaveLength(2);
    });
  });

  describe('New agent assignment workflow', () => {
    it('should handle task assignment to new agent specification', async () => {
      // Create task assigned to a new agent spec
      const newAgentSpec = createNewAgentSpec('anthropic', 'claude-3-haiku');
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

      expect(createResult.isError).toBe(false);
      const taskId = createResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';

      // Verify task shows new agent assignment using TaskViewTool
      const viewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(viewResult.isError).toBe(false);
      // After agent spawning, the task should be assigned to the spawned agent thread ID
      const taskDetails = viewResult.content?.[0]?.text || '';
      expect(taskDetails).toMatch(/Assigned to: \w+\.\d+/); // Should show delegate thread ID
      expect(taskDetails).toContain('in_progress'); // Should be in progress after spawning

      // Later, reassign to actual agent
      const actualAgentResult = await updateTool.execute(
        {
          taskId,
          assignTo: agent3Context.threadId!,
        },
        mainAgentContext
      );

      expect(actualAgentResult.isError).toBe(false);

      // Verify reassignment using TaskViewTool
      const viewResult2 = await viewTool.execute({ taskId }, mainAgentContext);
      expect(viewResult2.isError).toBe(false);
      expect(viewResult2.content?.[0]?.text).toContain(agent3Context.threadId!);
    });
  });

  describe('Thread task visibility', () => {
    it('should share tasks between threads in the same session', async () => {
      // Create a different parent thread context
      const otherParentThreadId = asThreadId('lace_20250703_other1');
      const otherAgentContext: ToolContext = {
        threadId: asThreadId('lace_20250703_other1.1'),
        parentThreadId: otherParentThreadId,
        session, // TaskManager accessed via session.getTaskManager()
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
        threadId: session2.getId(),
        parentThreadId: session2.getId(),
        session: session2, // TaskManager accessed via session2.getTaskManager()
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
    it('should handle concurrent task updates', async () => {
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
        expect(result.isError).toBe(false);
      });

      // Verify all notes were added using TaskViewTool
      const viewResult = await viewTool.execute({ taskId }, mainAgentContext);
      expect(viewResult.isError).toBe(false);

      const taskDetails = viewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('Note from agent 1');
      expect(taskDetails).toContain('Note from agent 2');
      expect(taskDetails).toContain('Note from agent 3');

      // Should have 3 notes in the output (each note shows as "N. [author] timestamp")
      const noteMatches = taskDetails.match(/\d+\. \[lace_20250703_parent\.\d+\]/g);
      expect(noteMatches).toHaveLength(3);
    });
  });

  describe('Task filtering and visibility', () => {
    it('should correctly filter tasks by different criteria', async () => {
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
              assignedTo: agent2Context.threadId!,
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
              assignedTo: mainAgentContext.threadId!,
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
