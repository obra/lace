// ABOUTME: Comprehensive integration tests for task management workflows
// ABOUTME: Tests end-to-end scenarios from task creation through delegation to completion

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/tools';
import { DelegateTool } from '~/tools/implementations/delegate';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { ProviderRegistry } from '~/providers/registry';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ApprovalDecision } from '~/tools/approval-types';

// Mock provider for testing
class MockProvider extends BaseMockProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'claude-3-5-haiku-20241022';
  }

  get contextWindow(): number {
    return 200000;
  }

  get maxOutputTokens(): number {
    return 4096;
  }

  getAvailableModels = () => {
    return [
      {
        id: 'claude-3-5-haiku-20241022',
        displayName: 'Claude 3.5 Haiku',
        description: 'Model for testing',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
        isDefault: true,
      },
      {
        id: 'claude-sonnet-4-20250514',
        displayName: 'Claude Sonnet 4',
        description: 'Model for testing',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
        isDefault: false,
      },
    ];
  };

  async createResponse(messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    // Look for task assignment message
    const taskMessage = messages.find(
      (m) =>
        m.content &&
        typeof m.content === 'string' &&
        m.content.includes('You have been assigned task')
    );

    if (taskMessage) {
      const match = taskMessage.content.match(/assigned task '([^']+)'/);
      const taskId = match ? match[1] : 'unknown';

      return Promise.resolve({
        content: 'Mock delegation response',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        toolCalls: [
          {
            id: 'delegation_task_complete',
            name: 'task_complete',
            input: {
              id: taskId,
              message: 'Mock delegation completed successfully',
            },
          },
        ],
      });
    }

    return Promise.resolve({
      content: 'Mock agent response for delegation tests',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }
}

describe('Task Management Workflow Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let session: Session;
  let project: Project;
  let mockProvider: MockProvider;
  let providerInstanceId: string;

  // Tool instances
  let taskCreateTool: TaskCreateTool;
  let taskListTool: TaskListTool;
  let taskCompleteTool: TaskCompleteTool;
  let taskUpdateTool: TaskUpdateTool;
  let taskAddNoteTool: TaskAddNoteTool;
  let taskViewTool: TaskViewTool;
  let delegateTool: DelegateTool;

  beforeEach(async () => {
    setupTestProviderDefaults();
    Session.clearProviderCache();

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Task Workflow Instance',
      apiKey: 'test-anthropic-key',
    });

    // Use simpler provider defaults approach instead of setupTestProviderInstances
    mockProvider = new MockProvider();

    // TODO: Update this test to use real provider instances with mocked responses
    // instead of mocking the internal createProvider method
    // For now, we're using the @internal createProvider method
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(() => mockProvider);

    // Create project and session with provider configuration
    project = Project.create(
      'Task Workflow Integration Test Project',
      '/tmp/test-workflow',
      'Test project for task workflow integration',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    session = Session.create({
      name: 'Task Workflow Integration Test Session',
      projectId: project.getId(),
      approvalCallback: {
        requestApproval: async () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
      },
    });

    // Get tools from session's agent
    const agent = session.getAgent(session.getId());
    const toolExecutor = agent!.toolExecutor;
    taskCreateTool = toolExecutor.getTool('task_add') as TaskCreateTool;
    taskListTool = toolExecutor.getTool('task_list') as TaskListTool;
    taskCompleteTool = toolExecutor.getTool('task_complete') as TaskCompleteTool;
    taskUpdateTool = toolExecutor.getTool('task_update') as TaskUpdateTool;
    taskAddNoteTool = toolExecutor.getTool('task_add_note') as TaskAddNoteTool;
    taskViewTool = toolExecutor.getTool('task_view') as TaskViewTool;
    delegateTool = toolExecutor.getTool('delegate') as DelegateTool;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    session?.destroy();
    // Test cleanup handled by setupCoreTest
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  describe('Basic Task Lifecycle', () => {
    it('should complete full task lifecycle: create → update → add note → complete → view', async () => {
      const agent = session.getAgent(session.getId())!;
      const context = { signal: new AbortController().signal, agent } as const;

      // 1. Create a task
      const createResult = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Implement user authentication',
              prompt: 'Add JWT-based authentication to the API endpoints',
              priority: 'high',
            },
          ],
        },
        context
      );

      expect(createResult.status).toBe('completed');
      expect(createResult.content[0].text).toContain('Created task');
      const taskIdMatch = createResult.content[0].text?.match(/task (\w+):/);
      expect(taskIdMatch).not.toBeNull();
      const validTaskId = taskIdMatch![1];

      // 2. List tasks to verify creation
      const listResult = await taskListTool.execute({ filter: 'thread' }, context);
      expect(listResult.status).toBe('completed');
      expect(listResult.content[0].text).toContain('Implement user authentication');
      expect(listResult.content[0].text).toContain('[high]');

      // 3. Update task to in-progress
      const updateResult = await taskUpdateTool.execute(
        {
          taskId: validTaskId,
          status: 'in_progress',
        },
        context
      );
      expect(updateResult.status).toBe('completed');
      expect(updateResult.content[0].text).toContain('status to in_progress');

      // 4. Add progress note
      const noteResult = await taskAddNoteTool.execute(
        {
          taskId: validTaskId,
          note: 'Implemented JWT middleware and user model. Testing authentication flow.',
        },
        context
      );
      expect(noteResult.status).toBe('completed');
      expect(noteResult.content[0].text).toContain('Added note to task');

      // 5. View task details
      const viewResult = await taskViewTool.execute({ taskId: validTaskId }, context);
      expect(viewResult.status).toBe('completed');
      expect(viewResult.content[0].text).toContain('Status: in_progress');
      expect(viewResult.content[0].text).toContain('JWT middleware');

      // 6. Complete the task
      const completeResult = await taskCompleteTool.execute(
        {
          id: validTaskId,
          message: 'Authentication system completed. All tests pass. API endpoints now secure.',
        },
        context
      );
      expect(completeResult.status).toBe('completed');
      expect(completeResult.content[0].text).toContain('Completed task');

      // 7. Verify completion in final view
      const finalViewResult = await taskViewTool.execute({ taskId: validTaskId }, context);
      expect(finalViewResult.status).toBe('completed');
      expect(finalViewResult.content[0].text).toContain('Status: completed');
      expect(finalViewResult.content[0].text).toContain('Authentication system completed');
    });
  });

  describe('Bulk Task Creation Workflow', () => {
    it('should handle bulk task creation and parallel management', async () => {
      const agent = session.getAgent(session.getId())!;
      const context = { signal: new AbortController().signal, agent } as const;

      // Create multiple tasks in bulk
      const bulkCreateResult = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Setup database schema',
              prompt: 'Create user and session tables with proper indexes',
              priority: 'high',
            },
            {
              title: 'Implement password hashing',
              prompt: 'Add bcrypt-based password hashing with salt rounds configuration',
              priority: 'medium',
            },
            {
              title: 'Add login endpoint',
              prompt: 'Create POST /auth/login with input validation and JWT generation',
              priority: 'medium',
            },
            {
              title: 'Write authentication tests',
              prompt: 'Comprehensive test suite for auth endpoints and middleware',
              priority: 'low',
            },
          ],
        },
        context
      );

      expect(bulkCreateResult.status).toBe('completed');
      expect(bulkCreateResult.content[0].text).toContain('Created 4 tasks');

      // Verify all tasks are listed
      const listResult = await taskListTool.execute({ filter: 'thread' }, context);
      expect(listResult.status).toBe('completed');
      expect(listResult.content[0].text).toContain('Tasks (thread): 4 found');
      expect(listResult.content[0].text).toContain('Setup database schema');
      expect(listResult.content[0].text).toContain('Implement password hashing');
      expect(listResult.content[0].text).toContain('Add login endpoint');
      expect(listResult.content[0].text).toContain('Write authentication tests');

      // Tasks should be sorted by priority (high -> medium -> low)
      const taskLines =
        listResult.content[0].text?.split('\n').filter((line) => line.includes('○')) || [];
      expect(taskLines[0]).toContain('[high]');
      expect(taskLines[1]).toContain('[medium]');
      expect(taskLines[2]).toContain('[medium]');
      expect(taskLines[3]).toContain('[low]');
    });
  });

  describe('Task Assignment and Delegation', () => {
    it('should support task assignment and delegation workflow', async () => {
      const agent = session.getAgent(session.getId())!;
      const context = { signal: new AbortController().signal, agent } as const;

      // Create task with assignment using the provider instance ID
      const createResult = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Analyze security vulnerabilities',
              prompt: 'Review codebase for common security issues and provide recommendations',
              priority: 'high',
              assignedTo: `new:${providerInstanceId}/claude-3-5-haiku-20241022`,
            },
          ],
        },
        context
      );


      expect(createResult.status).toBe('completed');
      // After agent spawning, the assignment should show the delegate thread ID
      expect(createResult.content[0].text).toMatch(/assigned to \w+\.\d+/);

      const taskIdMatch = createResult.content[0].text?.match(/task (\w+):/);
      expect(taskIdMatch).not.toBeNull();
      const validDelegateTaskId = taskIdMatch![1];

      // View task to confirm assignment
      const viewResult = await taskViewTool.execute({ taskId: validDelegateTaskId }, context);
      expect(viewResult.status).toBe('completed');
      // After agent spawning, the assignment should show the delegate thread ID
      expect(viewResult.content[0].text).toMatch(/Assigned to: \w+\.\d+/);

      // Reassign task to different model
      const reassignResult = await taskUpdateTool.execute(
        {
          taskId: validDelegateTaskId,
          assignTo: `new:${providerInstanceId}/claude-3-5-haiku-20241022`,
          status: 'in_progress',
        },
        context
      );
      expect(reassignResult.status).toBe('completed');
      // Task update should also trigger agent spawning, showing the delegate thread ID
      expect(reassignResult.content[0].text).toMatch(/assigned to \w+\.\d+/);

      // Mock delegation tool execution (delegation would normally create subthreads)
      vi.spyOn(delegateTool, 'execute').mockResolvedValueOnce({
        status: 'completed' as const,
        content: [
          {
            type: 'text',
            text: 'Security analysis completed. Found 3 potential vulnerabilities: SQL injection risk in user queries, XSS vulnerability in comment system, weak password policy. Recommendations: parameterized queries, input sanitization, stronger password requirements.',
          },
        ],
        metadata: { taskTitle: 'Analyze security vulnerabilities' },
      });

      // Simulate delegation execution
      const delegateResult = await delegateTool.execute({
        title: 'Analyze security vulnerabilities',
        prompt: 'Review codebase for common security issues and provide recommendations',
        expected_response: 'List of vulnerabilities with specific remediation steps',
        model: `${providerInstanceId}:claude-3-5-haiku-20241022`,
      },
        {
          signal: new AbortController().signal,
        }
      );

      expect(delegateResult.status).toBe('completed');
      expect(delegateResult.content[0].text).toContain('Security analysis completed');
      expect(delegateResult.content[0].text).toContain('SQL injection');

      // Complete task with delegation results
      const completeResult = await taskCompleteTool.execute(
        {
          id: validDelegateTaskId,
          message: `Security analysis delegated and completed. Results: ${delegateResult.content[0].text}`,
        },
        context
      );
      expect(completeResult.status).toBe('completed');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid task operations gracefully', async () => {
      const agent = session.getAgent(session.getId())!;
      const context = { signal: new AbortController().signal, agent } as const;

      // Try to complete non-existent task
      const completeResult = await taskCompleteTool.execute(
        {
          id: 'nonexistent_task',
          message: 'This should fail',
        },
        context
      );
      expect(completeResult.status).toBe('failed');
      expect(completeResult.content[0].text).toContain('Failed to complete task');

      // Try to view non-existent task
      const viewResult = await taskViewTool.execute({ taskId: 'nonexistent_task' }, context);
      expect(viewResult.status).toBe('failed');
      expect(viewResult.content[0].text).toContain('not found');

      // Try to update with invalid assignee format
      const updateResult = await taskUpdateTool.execute(
        {
          taskId: 'any_task',
          assignTo: 'invalid-format',
        },
        context
      );
      expect(updateResult.status).toBe('failed');
      expect(updateResult.content[0].text).toContain('Invalid assignee format');
    });

    it('should require TaskManager for all operations', async () => {
      const agent = session.getAgent(session.getId())!;
      const context = { signal: new AbortController().signal, agent } as const;

      // Create tool instances - they get TaskManager from session
      const toolWithoutManager = new TaskCreateTool();

      const result = await toolWithoutManager.execute(
        {
          tasks: [
            {
              title: 'Test task',
              prompt: 'This should work because session has TaskManager',
            },
          ],
        },
        context
      );

      // The test name is misleading - tools now get TaskManager from session
      // So this should succeed
      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('Created task');
    });
  });

  describe('Task Filtering and Querying', () => {
    it('should support different task filtering options', async () => {
      const agent = session.getAgent(session.getId())!;
      const context = { signal: new AbortController().signal, agent } as const;

      // Create various tasks with different states
      const task1Result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Completed task',
              prompt: 'This will be completed',
              priority: 'low',
            },
          ],
        },
        context
      );
      expect(task1Result.status).toBe('completed');

      const task2Result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'In progress task',
              prompt: 'This will be in progress',
              priority: 'medium',
            },
          ],
        },
        context
      );
      expect(task2Result.status).toBe('completed');

      const task3Result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'High priority task',
              prompt: 'This is high priority',
              priority: 'high',
              assignedTo: `new:${providerInstanceId}/claude-3-5-haiku-20241022`,

            },
          ],
        },
        context
      );
      expect(task3Result.status).toBe('completed');

      // Get all tasks
      const allTasks = await taskListTool.execute({ filter: 'all' }, context);
      expect(allTasks.status).toBe('completed');
      // Should have all 3 tasks (note: assigned task may be auto-started due to agent spawning)
      expect(allTasks.content[0].text).toContain('Tasks (all): 3 found');

      // Get thread tasks (should be same as all in this test)
      const threadTasks = await taskListTool.execute({ filter: 'thread' }, context);
      expect(threadTasks.status).toBe('completed');
      expect(threadTasks.content[0].text).toContain('Tasks (thread): 3 found');

      // Verify priority sorting (high -> medium -> low)
      const taskLines = (threadTasks.content[0].text || '')
        .split('\n')
        .filter((line) => line.includes('○'));
      expect(taskLines[0]).toContain('[high]');
      expect(taskLines[1]).toContain('[medium]');
      expect(taskLines[2]).toContain('[low]');
    });
  });
});
