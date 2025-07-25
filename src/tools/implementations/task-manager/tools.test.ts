// ABOUTME: Tests for task manager tools with multi-agent support
// ABOUTME: Validates task creation, queries, updates, and note management tools

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/tools';
import { ToolContext } from '~/tools/types';
import { asThreadId, createNewAgentSpec } from '~/threads/types';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('Enhanced Task Manager Tools', () => {
  const _tempDirContext = useTempLaceDir();
  let context: ToolContext;

  const parentThreadId = asThreadId('lace_20250703_parent');
  const agent1ThreadId = asThreadId('lace_20250703_parent.1');
  const agent2ThreadId = asThreadId('lace_20250703_parent.2');

  beforeEach(() => {
    setupTestPersistence();
    context = {
      threadId: agent1ThreadId,
      parentThreadId: parentThreadId,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    teardownTestPersistence();
  });

  describe('TaskCreateTool', () => {
    it('should create task with required fields', async () => {
      const tool = new TaskCreateTool();

      const result = await tool.execute(
        {
          title: 'Implement authentication',
          prompt: 'Create a secure authentication system with JWT tokens',
          priority: 'high',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content?.[0]?.text).toContain('Created task');
      expect(result.content?.[0]?.text).toContain('Implement authentication');
    });

    it('should create task with optional fields', async () => {
      const tool = new TaskCreateTool();

      const result = await tool.execute(
        {
          title: 'Code review',
          description: 'Review the authentication PR',
          prompt: 'Check security best practices and code style',
          priority: 'medium',
          assignedTo: agent2ThreadId,
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content?.[0]?.text).toContain('Code review');
      expect(result.content?.[0]?.text).toContain('assigned to');
    });

    it('should create task with new agent assignment', async () => {
      const tool = new TaskCreateTool();
      const newAgentSpec = createNewAgentSpec('anthropic', 'claude-3-haiku');

      const result = await tool.execute(
        {
          title: 'Research task',
          prompt: 'Research best practices for JWT implementation',
          priority: 'low',
          assignedTo: newAgentSpec,
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content?.[0]?.text).toContain('new:anthropic/claude-3-haiku');
    });

    it('should validate required fields', async () => {
      const tool = new TaskCreateTool();

      const result = await tool.execute(
        {
          title: '',
          prompt: 'Some prompt',
        } as any,
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('Validation failed');
    });

    it('should reject invalid assignee format', async () => {
      const tool = new TaskCreateTool();

      const result = await tool.execute(
        {
          title: 'Test task',
          prompt: 'Do something',
          assignedTo: 'invalid-format',
        } as any,
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('Invalid assignee format');
    });
  });

  describe('TaskListTool', () => {
    beforeEach(async () => {
      // Create test tasks
      const createTool = new TaskCreateTool();

      await createTool.execute(
        {
          title: 'Task 1',
          prompt: 'First task',
          priority: 'high',
        },
        context
      );

      await createTool.execute(
        {
          title: 'Task 2',
          prompt: 'Second task',
          priority: 'medium',
          assignedTo: agent1ThreadId,
        },
        context
      );

      await createTool.execute(
        {
          title: 'Task 3',
          prompt: 'Third task',
          priority: 'low',
          assignedTo: agent2ThreadId,
        },
        { ...context, threadId: agent2ThreadId }
      );
    });

    it('should list my tasks', async () => {
      const tool = new TaskListTool();

      const result = await tool.execute(
        {
          filter: 'mine',
        },
        context
      );

      expect(result.isError).toBe(false);
      const text = result.content?.[0]?.text || '';
      expect(text).toContain('Task 2'); // Assigned to agent1
      expect(text).not.toContain('Task 3'); // Assigned to agent2
    });

    it('should list all thread tasks', async () => {
      const tool = new TaskListTool();

      const result = await tool.execute(
        {
          filter: 'thread',
        },
        context
      );

      expect(result.isError).toBe(false);
      const text = result.content?.[0]?.text || '';
      expect(text).toContain('Task 1');
      expect(text).toContain('Task 2');
      expect(text).toContain('Task 3');
    });

    it('should list tasks I created', async () => {
      const tool = new TaskListTool();

      const result = await tool.execute(
        {
          filter: 'created',
        },
        context
      );

      expect(result.isError).toBe(false);
      const text = result.content?.[0]?.text || '';
      expect(text).toContain('Task 1');
      expect(text).toContain('Task 2');
      expect(text).not.toContain('Task 3'); // Created by agent2
    });

    it('should include completed tasks when requested', async () => {
      const tool = new TaskListTool();
      const updateTool = new TaskUpdateTool();

      // Get task ID from list
      const listResult = await tool.execute({ filter: 'thread' }, context);
      const taskId = listResult.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0];

      // Complete a task
      await updateTool.execute(
        {
          taskId: taskId!,
          status: 'completed',
        },
        context
      );

      // List without completed
      const withoutCompleted = await tool.execute(
        {
          filter: 'thread',
          includeCompleted: false,
        },
        context
      );

      expect(withoutCompleted.content?.[0]?.text).not.toContain('[completed]');

      // List with completed
      const withCompleted = await tool.execute(
        {
          filter: 'thread',
          includeCompleted: true,
        },
        context
      );

      expect(withCompleted.content?.[0]?.text).toContain('[completed]');
    });
  });

  describe('TaskUpdateTool', () => {
    let taskId: string;

    beforeEach(async () => {
      const createTool = new TaskCreateTool();
      const result = await createTool.execute(
        {
          title: 'Test task',
          prompt: 'Do something',
          assignedTo: agent1ThreadId,
        },
        context
      );

      taskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
    });

    it('should update task status', async () => {
      const tool = new TaskUpdateTool();

      const result = await tool.execute(
        {
          taskId,
          status: 'in_progress',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content?.[0]?.text).toContain('in_progress');

      // Verify using TaskViewTool
      const viewTool = new TaskViewTool();
      const viewResult = await viewTool.execute({ taskId }, context);
      expect(viewResult.isError).toBe(false);
      expect(viewResult.content?.[0]?.text).toContain('in_progress');
    });

    it('should validate status values', async () => {
      const tool = new TaskUpdateTool();

      const result = await tool.execute(
        {
          taskId,
          status: 'invalid' as 'pending' | 'in_progress' | 'completed',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('Validation failed');
    });

    it('should handle non-existent task', async () => {
      const tool = new TaskUpdateTool();

      const result = await tool.execute(
        {
          taskId: 'task_99999999_nonexist',
          status: 'completed',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should reassign task to another agent', async () => {
      const tool = new TaskUpdateTool();

      const result = await tool.execute(
        {
          taskId,
          assignTo: agent2ThreadId,
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content?.[0]?.text).toContain('assigned to');

      // Verify reassignment using TaskViewTool
      const viewTool = new TaskViewTool();
      const viewResult = await viewTool.execute({ taskId }, context);
      expect(viewResult.isError).toBe(false);
      expect(viewResult.content?.[0]?.text).toContain(agent2ThreadId);
    });

    it('should assign to new agent spec', async () => {
      const tool = new TaskUpdateTool();
      const newAgentSpec = createNewAgentSpec('openai', 'gpt-4');

      const result = await tool.execute(
        {
          taskId,
          assignTo: newAgentSpec,
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content?.[0]?.text).toContain('new:openai/gpt-4');
    });

    it('should validate assignee format', async () => {
      const tool = new TaskUpdateTool();

      const result = await tool.execute(
        {
          taskId,
          assignTo: 'invalid',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('Invalid assignee format');
    });
  });

  describe('TaskAddNoteTool', () => {
    let taskId: string;

    beforeEach(async () => {
      const createTool = new TaskCreateTool();
      const result = await createTool.execute(
        {
          title: 'Test task',
          prompt: 'Do something',
        },
        context
      );

      taskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
    });

    it('should add note to task', async () => {
      const tool = new TaskAddNoteTool();

      const result = await tool.execute(
        {
          taskId,
          note: 'Started working on this task',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content?.[0]?.text).toContain('Added note');

      // Verify note was added using TaskViewTool
      const viewTool = new TaskViewTool();
      const viewResult = await viewTool.execute({ taskId }, context);
      expect(viewResult.isError).toBe(false);
      const taskDetails = viewResult.content?.[0]?.text || '';
      expect(taskDetails).toContain('Started working on this task');
      expect(taskDetails).toContain(agent1ThreadId);
      // Should have 1 note in the output
      const noteMatches = taskDetails.match(/\d+\. \[/g);
      expect(noteMatches).toHaveLength(1);
    });

    it('should add multiple notes', async () => {
      const tool = new TaskAddNoteTool();

      await tool.execute(
        {
          taskId,
          note: 'First note',
        },
        context
      );

      await tool.execute(
        {
          taskId,
          note: 'Second note',
        },
        { ...context, threadId: agent2ThreadId }
      );

      // Verify multiple notes using TaskViewTool
      const viewTool = new TaskViewTool();
      const viewResult = await viewTool.execute({ taskId }, context);
      expect(viewResult.isError).toBe(false);
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
      const createTool = new TaskCreateTool();
      const result = await createTool.execute(
        {
          title: 'Complex task',
          description: 'This is a complex task with many details',
          prompt: 'Implement a complex feature with multiple components',
          priority: 'high',
          assignedTo: agent2ThreadId,
        },
        context
      );

      taskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';

      // Add some notes
      const noteTool = new TaskAddNoteTool();
      await noteTool.execute(
        {
          taskId,
          note: 'Starting analysis of requirements',
        },
        context
      );

      await noteTool.execute(
        {
          taskId,
          note: 'Found some edge cases to consider',
        },
        { ...context, threadId: agent2ThreadId }
      );
    });

    it('should view task details', async () => {
      const tool = new TaskViewTool();

      const result = await tool.execute({ taskId }, context);

      expect(result.isError).toBe(false);
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
      const tool = new TaskViewTool();

      const result = await tool.execute(
        {
          taskId: 'task_99999999_nonexist',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('not found');
    });
  });

  describe('TaskCompleteTool', () => {
    let taskId: string;

    beforeEach(async () => {
      const createTool = new TaskCreateTool();
      const result = await createTool.execute(
        {
          title: 'Test task',
          prompt: 'Do something',
        },
        context
      );

      taskId = result.content?.[0]?.text?.match(/task_\d{8}_[a-z0-9]{6}/)?.[0] || '';
    });

    it('should complete a task', async () => {
      const tool = new TaskCompleteTool();

      const result = await tool.execute({ id: taskId }, context);

      expect(result.isError).toBe(false);
      expect(result.content?.[0]?.text).toContain('Completed task');

      // Verify completion using TaskViewTool
      const viewTool = new TaskViewTool();
      const viewResult = await viewTool.execute({ taskId }, context);
      expect(viewResult.isError).toBe(false);
      expect(viewResult.content?.[0]?.text).toContain('completed');
    });

    it('should handle non-existent task', async () => {
      const tool = new TaskCompleteTool();

      const result = await tool.execute(
        {
          id: 'task_99999999_nonexist',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('not found');
    });
  });
});
