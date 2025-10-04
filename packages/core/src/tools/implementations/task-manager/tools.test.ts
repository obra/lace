// ABOUTME: Tests for task manager tools with multi-agent support
// ABOUTME: Validates task creation, queries, updates, and note management tools

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdirSync } from 'fs';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '@lace/core/tools/implementations/task-manager';
import { ToolContext } from '@lace/core/tools/types';
import { asThreadId, createNewAgentSpec } from '@lace/core/threads/types';
import type { Task } from '@lace/core/tasks/types';
import { setupCoreTest, cleanupSession } from '@lace/core/test-utils/core-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@lace/core/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/core/test-utils/provider-instances';
import { Session } from '@lace/core/sessions/session';
import { Project } from '@lace/core/projects/project';
import type { Agent } from '@lace/core/agents/agent';
import { BaseMockProvider } from '@lace/core/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '@lace/core/providers/base-provider';
import { ProviderRegistry } from '@lace/core/providers/registry';
import { Tool } from '@lace/core/tools/tool';

// Mock provider for testing agent spawning
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
    ];
  };

  createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return Promise.resolve({
      content: 'mock response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }
}

describe('Enhanced Task Manager Tools', () => {
  const context = setupCoreTest();
  let tempProjectDir: string;
  let toolContext: ToolContext;
  let session: Session;
  let project: Project;
  let tools: Tool[];
  let taskCreateTool: TaskCreateTool;
  let taskListTool: TaskListTool;
  let _taskCompleteTool: TaskCompleteTool;
  let taskUpdateTool: TaskUpdateTool;
  let taskAddNoteTool: TaskAddNoteTool;
  let taskViewTool: TaskViewTool;
  let mockProvider: MockProvider;
  let providerInstanceId: string;

  const _parentThreadId = asThreadId('lace_20250703_parent');
  const agent1ThreadId = asThreadId('lace_20250703_parent.1');
  const agent2ThreadId = asThreadId('lace_20250703_parent.2');

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Task Manager Tools Instance',
      apiKey: 'test-anthropic-key',
    });

    mockProvider = new MockProvider();

    // TODO: Update this test to use real provider instances with mocked responses
    // instead of mocking the internal createProvider method
    // Mock AnthropicProvider to avoid real API calls during testing
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(() => mockProvider);

    // Create temp project directory
    tempProjectDir = join(context.tempDir, 'test-tools');
    mkdirSync(tempProjectDir, { recursive: true });

    // Create project with provider configuration
    project = Project.create(
      'Test Project',
      tempProjectDir,
      'Test project for task manager tests',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    // Create session with explicit provider configuration to match project
    session = Session.create({
      name: 'Tool Test Session',
      projectId: project.getId(),
    });

    // Create tools that get TaskManager from toolContext
    tools = [
      new TaskCreateTool(),
      new TaskListTool(),
      new TaskCompleteTool(),
      new TaskUpdateTool(),
      new TaskAddNoteTool(),
      new TaskViewTool(),
    ];
    taskCreateTool = tools.find((t) => t.name === 'task_create') as TaskCreateTool;
    taskListTool = tools.find((t) => t.name === 'task_list') as TaskListTool;
    _taskCompleteTool = tools.find((t) => t.name === 'task_complete') as TaskCompleteTool;
    taskUpdateTool = tools.find((t) => t.name === 'task_update') as TaskUpdateTool;
    taskAddNoteTool = tools.find((t) => t.name === 'task_add_note') as TaskAddNoteTool;
    taskViewTool = tools.find((t) => t.name === 'task_view') as TaskViewTool;

    const agent = session.getAgent(session.getId());
    if (!agent) {
      throw new Error('Failed to get agent from session');
    }

    toolContext = {
      signal: new AbortController().signal,
      agent,
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();

    // Clean up session and all its EventEmitters
    if (session) {
      await cleanupSession(session); // This already calls removeAllListeners() on all agents
    }

    // Clean up toolContext AbortController if it exists
    if (toolContext?.signal && !toolContext.signal.aborted) {
      try {
        // Manually trigger abort to clean up any pending operations
        (toolContext.signal as any).aborted = true;
      } catch (_error) {
        // Ignore errors when cleaning up AbortController
      }
    }

    // Clean up provider and instances
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }

    // Clear references immediately instead of registering cleanup
    // (avoids timing issues with global setupCoreTest registry)
    toolContext = undefined as unknown as ToolContext;
    session = undefined as unknown as Session;
    project = undefined as unknown as Project;
  });

  describe('Context Integration', () => {
    it('should get TaskManager from context', async () => {
      expect(tools.length).toBe(6);
      expect(taskCreateTool).toBeDefined();
      expect(taskCreateTool.name).toBe('task_create');

      // Test that tools can access TaskManager via agent
      expect(toolContext.agent).toBeDefined();
      expect(session.getTaskManager()).toBeDefined();

      // Test that task creation works with toolContext-based TaskManager
      const result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Context Test Task',
              prompt: 'Test task with toolContext-based TaskManager',
            },
          ],
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      expect(result.content[0]?.text).toContain('Created task');
    });
  });

  describe('TaskCreateTool', () => {
    it('should create task with required fields', async () => {
      const result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Implement authentication',
              prompt: 'Create a secure authentication system with JWT tokens',
              priority: 'high',
            },
          ],
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      expect(result.content?.[0]?.text).toContain('Created task');
      expect(result.content?.[0]?.text).toContain('Implement authentication');
    });

    it('should create task with optional fields', async () => {
      const result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Code review',
              description: 'Review the authentication PR',
              prompt: 'Check security best practices and code style',
              priority: 'medium',
              assignedTo: agent2ThreadId,
            },
          ],
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      expect(result.content?.[0]?.text).toContain('Code review');
      expect(result.content?.[0]?.text).toContain('assigned to');
    });

    it('should create task with new agent assignment', async () => {
      const newAgentSpec = createNewAgentSpec(
        'lace',
        `${providerInstanceId}:claude-3-5-haiku-20241022`
      );

      const result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Research task',
              prompt: 'Research best practices for JWT implementation',
              priority: 'low',
              assignedTo: newAgentSpec,
            },
          ],
        },
        toolContext
      );

      if (result.status === 'failed') {
        console.error('Task creation failed:', result.content?.[0]?.text);
      }
      expect(result.status).toBe('completed');
      // After agent spawning, the task should be assigned to the spawned agent thread ID
      expect(result.content?.[0]?.text).toContain('Research task');
      expect(result.content?.[0]?.text).toContain('assigned to');
      // The assignment should be to a delegate thread ID, not the original spec
      expect(result.content?.[0]?.text).toMatch(/assigned to \w+\.\d+/);
    });

    it('should validate required fields', async () => {
      const invalidInput: unknown = {
        tasks: [
          {
            title: '',
            prompt: 'Some prompt',
          },
        ],
      };
      const result = await taskCreateTool.execute(invalidInput, toolContext);

      expect(result.status).toBe('failed');
      expect(result.content?.[0]?.text).toContain('ValidationError');
    });

    it('should reject invalid assignee format', async () => {
      const invalidInput: unknown = {
        tasks: [
          {
            title: 'Test task',
            prompt: 'Do something',
            assignedTo: 'invalid-format',
          },
        ],
      };
      const result = await taskCreateTool.execute(invalidInput, toolContext);

      expect(result.status).toBe('failed');
      expect(result.content?.[0]?.text).toContain('Invalid assignee format');
    });
  });

  describe('TaskListTool', () => {
    beforeEach(async () => {
      // Create test tasks

      await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Task 1',
              prompt: 'First task',
              priority: 'high',
            },
          ],
        },
        toolContext
      );

      await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Task 2',
              prompt: 'Second task',
              priority: 'medium',
              assignedTo: agent1ThreadId,
            },
          ],
        },
        toolContext
      );

      await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Task 3',
              prompt: 'Third task',
              priority: 'low',
              assignedTo: agent2ThreadId,
            },
          ],
        },
        {
          ...toolContext,
          signal: new AbortController().signal,
          agent: {
            ...toolContext.agent!,
            threadId: agent2ThreadId,
            getFullSession: toolContext.agent!.getFullSession.bind(toolContext.agent),
          } as unknown as Agent,
        }
      );
    });

    it('should list my tasks', async () => {
      const result = await taskListTool.execute(
        {
          filter: 'mine',
        },
        {
          ...toolContext,
          signal: new AbortController().signal,
          agent: {
            ...toolContext.agent!,
            threadId: agent1ThreadId,
            getFullSession: toolContext.agent!.getFullSession.bind(toolContext.agent),
          } as unknown as Agent,
        }
      );

      expect(result.status).toBe('completed');
      const text = result.content?.[0]?.text || '';
      expect(text).toContain('Task 2'); // Assigned to agent1
      expect(text).not.toContain('Task 3'); // Assigned to agent2
    });

    it('should list current thread tasks only', async () => {
      const result = await taskListTool.execute(
        {
          filter: 'thread',
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      const text = result.content?.[0]?.text || '';
      expect(text).toContain('Task 1'); // No assignee, belongs to thread
      expect(text).not.toContain('Task 2'); // Assigned to agent1, delegated out
      expect(text).not.toContain('Task 3'); // Assigned to agent2, delegated out
    });

    it('should list all session tasks', async () => {
      const result = await taskListTool.execute(
        {
          filter: 'all',
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      const text = result.content?.[0]?.text || '';
      expect(text).toContain('Task 1');
      expect(text).toContain('Task 2');
      expect(text).toContain('Task 3');
    });

    it('should list tasks I created', async () => {
      const result = await taskListTool.execute(
        {
          filter: 'created',
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      const text = result.content?.[0]?.text || '';
      expect(text).toContain('Task 1');
      expect(text).toContain('Task 2');
      expect(text).not.toContain('Task 3'); // Created by agent2
    });

    it('should include completed tasks when requested', async () => {
      // Get task ID from list
      const listResult = await taskListTool.execute({ filter: 'thread' }, toolContext);
      const taskId = listResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0];

      // Complete a task
      await taskUpdateTool.execute(
        {
          taskId: taskId!,
          status: 'completed',
        },
        toolContext
      );

      // List without completed
      const withoutCompleted = await taskListTool.execute(
        {
          filter: 'thread',
          includeCompleted: false,
        },
        toolContext
      );

      expect(withoutCompleted.content?.[0]?.text).not.toContain('[completed]');

      // List with completed
      const withCompleted = await taskListTool.execute(
        {
          filter: 'thread',
          includeCompleted: true,
        },
        toolContext
      );

      expect(withCompleted.content?.[0]?.text).toContain('[completed]');
    });
  });

  describe('TaskUpdateTool', () => {
    let taskId: string;

    beforeEach(async () => {
      const result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Test task',
              prompt: 'Do something',
              assignedTo: agent1ThreadId,
            },
          ],
        },
        toolContext
      );

      taskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
    });

    it('should update task status to archived', async () => {
      // This test should fail initially since 'archived' is not in the schema
      const result = await taskUpdateTool.execute(
        {
          taskId,
          status: 'archived',
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      expect(result.content?.[0]?.text).toContain('status to archived');
    });

    it('should require adding a note when archiving tasks (LLM instruction test)', async () => {
      // First, archive without a note to show the expected pattern
      const archiveResult = await taskUpdateTool.execute(
        {
          taskId,
          status: 'archived',
        },
        toolContext
      );
      expect(archiveResult.status).toBe('completed');

      // Then verify a note should be added separately (this tests that the LLM should be instructed to do this)
      const addNoteResult = await taskAddNoteTool.execute(
        {
          taskId,
          note: 'Archived: Requirements changed, feature no longer needed',
        },
        toolContext
      );
      expect(addNoteResult.status).toBe('completed');

      // Verify the task has the note
      const viewResult = await taskViewTool.execute({ taskId }, toolContext);
      expect(viewResult.content?.[0]?.text).toContain('Archived: Requirements changed');
    });

    it('should update task status', async () => {
      const result = await taskUpdateTool.execute(
        {
          taskId,
          status: 'in_progress',
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      expect(result.content?.[0]?.text).toContain('in_progress');

      // Verify using TaskViewTool
      const viewResult = await taskViewTool.execute({ taskId }, toolContext);
      expect(viewResult.status).toBe('completed');
      expect(viewResult.content?.[0]?.text).toContain('in_progress');
    });

    it('should validate status values', async () => {
      const result = await taskUpdateTool.execute(
        {
          taskId,
          status: 'invalid' as 'pending' | 'in_progress' | 'completed',
        },
        toolContext
      );

      expect(result.status).toBe('failed');
      expect(result.content?.[0]?.text).toContain('ValidationError');
    });

    it('should handle non-existent task', async () => {
      const result = await taskUpdateTool.execute(
        {
          taskId: 'task_99999999_nonexist',
          status: 'completed',
        },
        toolContext
      );

      expect(result.status).toBe('failed');
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should reassign task to another agent', async () => {
      const result = await taskUpdateTool.execute(
        {
          taskId,
          assignTo: agent2ThreadId,
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      expect(result.content?.[0]?.text).toContain('assigned to');

      // Verify reassignment using TaskViewTool
      const viewResult = await taskViewTool.execute({ taskId }, toolContext);
      expect(viewResult.status).toBe('completed');
      expect(viewResult.content?.[0]?.text).toContain(agent2ThreadId);
    });

    it('should assign to new agent spec', async () => {
      const newAgentSpec = createNewAgentSpec(
        'lace',
        `${providerInstanceId}:claude-3-5-haiku-20241022`
      );

      const result = await taskUpdateTool.execute(
        {
          taskId,
          assignTo: newAgentSpec,
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      // After agent spawning, assignment should be to delegate thread ID
      expect(result.content?.[0]?.text).toContain('assigned to');
      expect(result.content?.[0]?.text).toMatch(/assigned to \w+\.\d+/);
    });

    it('should validate assignee format', async () => {
      const result = await taskUpdateTool.execute(
        {
          taskId,
          assignTo: 'invalid',
        },
        toolContext
      );

      expect(result.status).toBe('failed');
      expect(result.content?.[0]?.text).toContain('Invalid assignee format');
    });
  });

  describe('TaskAddNoteTool', () => {
    let taskId: string;

    beforeEach(async () => {
      const result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Test task',
              prompt: 'Do something',
            },
          ],
        },
        toolContext
      );

      taskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
    });

    it('should add note to task', async () => {
      const result = await taskAddNoteTool.execute(
        {
          taskId,
          note: 'Started working on this task',
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      expect(result.content?.[0]?.text).toContain('Added note');

      // Verify note was added using TaskViewTool
      const viewResult = await taskViewTool.execute({ taskId }, toolContext);
      expect(viewResult.status).toBe('completed');
      const taskDetails = viewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('Started working on this task');
      expect(taskDetails).toContain(session.getId()); // Note author should be session ID
      // Should have 1 note in the output
      const noteMatches = taskDetails.match(/\d+\. \[/g);
      expect(noteMatches).toHaveLength(1);
    });

    it('should add multiple notes', async () => {
      await taskAddNoteTool.execute(
        {
          taskId,
          note: 'First note',
        },
        toolContext
      );

      await taskAddNoteTool.execute(
        {
          taskId,
          note: 'Second note',
        },
        {
          ...toolContext,
          signal: new AbortController().signal,
          agent: {
            ...toolContext.agent!,
            threadId: agent2ThreadId,
            getFullSession: toolContext.agent!.getFullSession.bind(toolContext.agent),
          } as unknown as Agent,
        }
      );

      // Verify multiple notes using TaskViewTool
      const viewResult = await taskViewTool.execute({ taskId }, toolContext);
      expect(viewResult.status).toBe('completed');
      const taskDetails = viewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('First note');
      expect(taskDetails).toContain('Second note');
      expect(taskDetails).toContain(agent2ThreadId);
      // Should have 2 notes in the output
      const noteMatches = taskDetails.match(/\d+\. \[/g);
      expect(noteMatches).toHaveLength(2);
    });
  });

  describe('TaskViewTool', () => {
    let taskId: string;

    beforeEach(async () => {
      const result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Complex task',
              description: 'This is a complex task with many details',
              prompt: 'Implement a complex feature with multiple components',
              priority: 'high',
              assignedTo: agent2ThreadId,
            },
          ],
        },
        toolContext
      );

      taskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';

      // Add some notes
      await taskAddNoteTool.execute(
        {
          taskId,
          note: 'Starting analysis of requirements',
        },
        toolContext
      );

      await taskAddNoteTool.execute(
        {
          taskId,
          note: 'Found some edge cases to consider',
        },
        {
          ...toolContext,
          signal: new AbortController().signal,
          agent: {
            ...toolContext.agent!,
            threadId: agent2ThreadId,
            getFullSession: toolContext.agent!.getFullSession.bind(toolContext.agent),
          } as unknown as Agent,
        }
      );
    });

    it('should view task details', async () => {
      const result = await taskViewTool.execute({ taskId }, toolContext);

      expect(result.status).toBe('completed');
      const text = result.content?.[0]?.text || '';
      expect(text).toContain('Complex task');
      expect(text).toContain('This is a complex task');
      expect(text).toContain('Implement a complex feature');
      expect(text).toContain('high');
      expect(text).toContain(agent2ThreadId);
      expect(text).toContain('Starting analysis');
      expect(text).toContain('edge cases');
    });

    it('should handle non-existent task', async () => {
      const result = await taskViewTool.execute(
        {
          taskId: 'task_99999999_nonexist',
        },
        toolContext
      );

      expect(result.status).toBe('failed');
      expect(result.content?.[0]?.text).toContain('not found');
    });
  });

  describe('TaskCompleteTool', () => {
    let taskId: string;

    beforeEach(async () => {
      const result = await taskCreateTool.execute(
        {
          tasks: [
            {
              title: 'Test task',
              prompt: 'Do something',
            },
          ],
        },
        toolContext
      );

      taskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
    });

    it('should complete a task', async () => {
      const result = await _taskCompleteTool.execute(
        {
          id: taskId,
          message: 'Task completed successfully',
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      expect(result.content?.[0]?.text).toContain('Completed task');

      // Verify completion using TaskViewTool
      const viewResult = await taskViewTool.execute({ taskId }, toolContext);
      expect(viewResult.status).toBe('completed');
      expect(viewResult.content?.[0]?.text).toContain('completed');
    });

    it('should handle non-existent task', async () => {
      const result = await _taskCompleteTool.execute(
        {
          id: 'task_99999999_nonexist',
          message: 'This should fail',
        },
        toolContext
      );

      expect(result.status).toBe('failed');
      expect(result.content?.[0]?.text).toContain('not found');
    });
  });

  describe('Structured Data for UI Rendering', () => {
    describe('TaskCreateTool metadata', () => {
      it('should return task object in result metadata for single task UI links', async () => {
        const result = await taskCreateTool.execute(
          {
            tasks: [
              {
                title: 'UI Test Task',
                description: 'Testing structured data for UI',
                prompt: 'Test that metadata contains task object',
                priority: 'high',
                assignedTo: agent2ThreadId,
              },
            ],
          },
          toolContext
        );

        // Basic result validation
        expect(result.status).toBe('completed');
        expect(result.content?.[0]?.text).toContain('UI Test Task');

        // CRITICAL: Verify structured task data exists in metadata for single task
        expect(result.metadata).toBeDefined();
        expect(result.metadata?.task).toBeDefined();

        const taskData = result.metadata?.task as Task;

        // Verify all fields needed for UI rendering
        expect(taskData.id).toBeDefined();
        expect(taskData.id).toMatch(/^task_\d{8}_[a-z0-9]{6}$/);
        expect(taskData.title).toBe('UI Test Task');
        expect(taskData.description).toBe('Testing structured data for UI');
        expect(taskData.prompt).toBe('Test that metadata contains task object');
        expect(taskData.priority).toBe('high');
        expect(taskData.status).toBe('pending');
        expect(taskData.assignedTo).toBe(agent2ThreadId);
        expect(taskData.createdAt).toBeInstanceOf(Date);
        expect(taskData.updatedAt).toBeInstanceOf(Date);
        expect(Array.isArray(taskData.notes)).toBe(true);
        expect(taskData.notes).toHaveLength(0);
      });

      it('should return tasks array in result metadata for multiple task UI links', async () => {
        const result = await taskCreateTool.execute(
          {
            tasks: [
              {
                title: 'First Task',
                prompt: 'First task for testing',
                priority: 'high',
              },
              {
                title: 'Second Task',
                prompt: 'Second task for testing',
                priority: 'medium',
              },
            ],
          },
          toolContext
        );

        // Basic result validation
        expect(result.status).toBe('completed');
        expect(result.content?.[0]?.text).toContain('Created 2 tasks');

        // CRITICAL: Verify structured tasks array exists in metadata
        expect(result.metadata).toBeDefined();
        expect(result.metadata?.tasks).toBeDefined();
        expect(Array.isArray(result.metadata?.tasks)).toBe(true);

        const tasksData = result.metadata?.tasks as Task[];
        expect(tasksData).toHaveLength(2);

        // Verify first task
        expect(tasksData[0].id).toMatch(/^task_\d{8}_[a-z0-9]{6}$/);
        expect(tasksData[0].title).toBe('First Task');
        expect(tasksData[0].priority).toBe('high');

        // Verify second task
        expect(tasksData[1].id).toMatch(/^task_\d{8}_[a-z0-9]{6}$/);
        expect(tasksData[1].title).toBe('Second Task');
        expect(tasksData[1].priority).toBe('medium');
      });

      it('should include assignment info in both text and metadata', async () => {
        const result = await taskCreateTool.execute(
          {
            tasks: [
              {
                title: 'Assigned Task',
                prompt: 'Test assignment data',
                priority: 'low',
                assignedTo: agent2ThreadId,
              },
            ],
          },
          toolContext
        );

        expect(result.status).toBe('completed');

        // Text should mention assignment
        expect(result.content?.[0]?.text).toContain(`assigned to ${agent2ThreadId}`);

        // Metadata should have assignment
        expect((result.metadata?.task as Task)?.assignedTo).toBe(agent2ThreadId);
      });
    });

    describe('Data validation for UI components', () => {
      it('should provide all data needed for task view links', async () => {
        const result = await taskCreateTool.execute(
          {
            tasks: [
              {
                title: 'Link Test Task',
                description: 'Test data for view links',
                prompt: 'Ensure UI can create proper links',
                priority: 'high',
              },
            ],
          },
          toolContext
        );

        const taskData = result.metadata?.task as Task;
        expect(taskData).toBeDefined();
        expect(typeof taskData).toBe('object');
        expect(taskData).not.toBeNull();

        // UI needs these for creating links like #/tasks/{taskId}
        expect(taskData?.id).toBeDefined();
        expect(typeof taskData?.id).toBe('string');
        if (taskData && typeof taskData.id === 'string') {
          expect(taskData.id.length).toBeGreaterThan(0);
        }

        // UI needs these for display
        expect(taskData.title).toBeDefined();
        expect(taskData.priority).toBeDefined();
        expect(taskData.status).toBeDefined();
        expect(taskData.createdAt).toBeDefined();
      });

      it('should provide task ID without requiring text parsing', async () => {
        const result = await taskCreateTool.execute(
          {
            tasks: [
              {
                title: 'No Parsing Task',
                prompt: 'Task ID should be in metadata, not requiring text parsing',
                priority: 'medium',
              },
            ],
          },
          toolContext
        );

        // The old way: parsing text (should not be needed)
        const textTaskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0];

        // The new way: structured metadata (should work)
        const metadataTaskId = (result.metadata?.task as Task)?.id;

        expect(metadataTaskId).toBeDefined();
        expect(metadataTaskId).toBe(textTaskId); // Both should match

        // But UI should use metadata, not text parsing
        expect(typeof metadataTaskId).toBe('string');
        if (typeof metadataTaskId === 'string') {
          expect(metadataTaskId.length).toBeGreaterThan(0);
        }
      });

      it('should provide multiple task IDs for array-based creation', async () => {
        const result = await taskCreateTool.execute(
          {
            tasks: [
              {
                title: 'First Array Task',
                prompt: 'First task in array',
                priority: 'high',
              },
              {
                title: 'Second Array Task',
                prompt: 'Second task in array',
                priority: 'low',
              },
            ],
          },
          toolContext
        );

        // Structured metadata should work for arrays
        const tasksMetadata = result.metadata?.tasks as Task[];

        expect(Array.isArray(tasksMetadata)).toBe(true);
        expect(tasksMetadata).toHaveLength(2);

        // Each task should have proper ID structure
        tasksMetadata.forEach((task, index) => {
          expect(task.id).toBeDefined();
          expect(typeof task.id).toBe('string');
          expect(task.id).toMatch(/^task_\d{8}_[a-z0-9]{6}$/);
          expect(task.title).toBe(index === 0 ? 'First Array Task' : 'Second Array Task');
        });
      });
    });
  });
});
