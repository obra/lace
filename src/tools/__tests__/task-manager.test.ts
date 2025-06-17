// ABOUTME: Tests for session task management tools
// ABOUTME: Validates task creation, listing, completion, and state management

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskAddTool, TaskListTool, TaskCompleteTool } from '../implementations/task-manager.js';

describe('Task Management Tools', () => {
  const addTool = new TaskAddTool();
  const listTool = new TaskListTool();
  const completeTool = new TaskCompleteTool();

  let testThreadId: string;

  // Use a unique thread ID for each test to isolate task stores
  beforeEach(() => {
    testThreadId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  });

  describe('TaskAddTool', () => {
    describe('tool metadata', () => {
      it('should have correct name and description', () => {
        expect(addTool.name).toBe('task_add');
        expect(addTool.description).toBe('Add a new task to the session task list');
        expect(addTool.annotations?.idempotentHint).toBe(false);
      });

      it('should have correct input schema', () => {
        expect(addTool.input_schema).toEqual({
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Task description' },
          },
          required: ['description'],
        });
      });
    });

    describe('task creation', () => {
      it('should add a new task successfully', async () => {
        const result = await addTool.executeTool(
          { description: 'Test task' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toMatch(/Added task #\d+: Test task/);
      });

      it('should assign incremental IDs', async () => {
        const result1 = await addTool.executeTool(
          { description: 'First task' },
          { threadId: testThreadId }
        );
        const result2 = await addTool.executeTool(
          { description: 'Second task' },
          { threadId: testThreadId }
        );

        expect(result1.isError).toBe(false);
        expect(result2.isError).toBe(false);

        const id1 = result1.content[0].text!.match(/#(\d+):/)?.[1];
        const id2 = result2.content[0].text!.match(/#(\d+):/)?.[1];

        expect(parseInt(id2!)).toBeGreaterThan(parseInt(id1!));
      });

      it('should trim whitespace from description', async () => {
        const result = await addTool.executeTool(
          { description: '  Whitespace task  ' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Whitespace task');
        expect(result.content[0].text).not.toContain('  Whitespace task  ');
      });
    });

    describe('error handling', () => {
      it('should handle missing description', async () => {
        const result = await addTool.executeTool({}, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Description must be a non-empty string');
      });

      it('should handle empty description', async () => {
        const result = await addTool.executeTool({ description: '' }, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Description must be a non-empty string');
      });

      it('should handle whitespace-only description', async () => {
        const result = await addTool.executeTool(
          { description: '   ' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Description must be a non-empty string');
      });

      it('should handle non-string description', async () => {
        const result = await addTool.executeTool({ description: 123 }, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Description must be a non-empty string');
      });
    });
  });

  describe('TaskListTool', () => {
    describe('tool metadata', () => {
      it('should have correct name and description', () => {
        expect(listTool.name).toBe('task_list');
        expect(listTool.description).toBe('List current session tasks');
        expect(listTool.annotations?.readOnlyHint).toBe(true);
      });
    });

    describe('task listing', () => {
      it('should show no tasks when list is empty', async () => {
        const result = await listTool.executeTool({}, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toBe('No pending tasks');
      });

      it('should list pending tasks by default', async () => {
        await addTool.executeTool({ description: 'Pending task' }, { threadId: testThreadId });

        const result = await listTool.executeTool({}, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        const output = result.content[0].text!;
        expect(output).toContain('Pending tasks (1):');
        expect(output).toContain('○ #');
        expect(output).toContain('Pending task');
      });

      it('should exclude completed tasks by default', async () => {
        const addResult = await addTool.executeTool(
          { description: 'Task to complete' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];
        await completeTool.executeTool({ id: taskId! }, { threadId: testThreadId });

        const result = await listTool.executeTool({}, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toBe('No pending tasks');
      });

      it('should include completed tasks when requested', async () => {
        const addResult = await addTool.executeTool(
          { description: 'Completed task' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];
        await completeTool.executeTool({ id: taskId! }, { threadId: testThreadId });

        const result = await listTool.executeTool(
          { includeCompleted: true },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        const output = result.content[0].text!;
        expect(output).toContain('Tasks (0 pending, 1 completed):');
        expect(output).toContain('✓ #');
        expect(output).toContain('Completed task');
        expect(output).toContain('completed');
      });

      it('should show mixed pending and completed tasks', async () => {
        await addTool.executeTool({ description: 'Pending task' }, { threadId: testThreadId });
        const addResult = await addTool.executeTool(
          { description: 'Completed task' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];
        await completeTool.executeTool({ id: taskId! }, { threadId: testThreadId });

        const result = await listTool.executeTool(
          { includeCompleted: true },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        const output = result.content[0].text!;
        expect(output).toContain('Tasks (1 pending, 1 completed):');
        expect(output).toContain('○ #');
        expect(output).toContain('✓ #');
      });
    });
  });

  describe('TaskCompleteTool', () => {
    describe('tool metadata', () => {
      it('should have correct name and description', () => {
        expect(completeTool.name).toBe('task_complete');
        expect(completeTool.description).toBe('Mark a task as completed');
        expect(completeTool.annotations?.idempotentHint).toBe(false);
      });

      it('should have correct input schema', () => {
        expect(completeTool.input_schema).toEqual({
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Task ID to complete' },
          },
          required: ['id'],
        });
      });
    });

    describe('task completion', () => {
      it('should complete an existing task', async () => {
        const addResult = await addTool.executeTool(
          { description: 'Task to complete' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];

        const result = await completeTool.executeTool({ id: taskId! }, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toMatch(/Completed task #\d+: Task to complete/);
      });

      it('should remove completed task from pending list', async () => {
        const addResult = await addTool.executeTool(
          { description: 'Task to complete' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];

        await completeTool.executeTool({ id: taskId! }, { threadId: testThreadId });
        const listResult = await listTool.executeTool({}, { threadId: testThreadId });

        expect(listResult.content[0].text).toBe('No pending tasks');
      });
    });

    describe('error handling', () => {
      it('should handle missing task ID', async () => {
        const result = await completeTool.executeTool({}, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Task ID must be a non-empty string');
      });

      it('should handle empty task ID', async () => {
        const result = await completeTool.executeTool({ id: '' }, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Task ID must be a non-empty string');
      });

      it('should handle non-existent task ID', async () => {
        const result = await completeTool.executeTool({ id: '999' }, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Task #999 not found');
      });

      it('should handle non-string task ID', async () => {
        const result = await completeTool.executeTool({ id: 123 }, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('Task ID must be a non-empty string');
      });
    });
  });

  describe('integration tests', () => {
    it('should handle complete workflow', async () => {
      // Add multiple tasks
      await addTool.executeTool({ description: 'Task 1' }, { threadId: testThreadId });
      await addTool.executeTool({ description: 'Task 2' }, { threadId: testThreadId });
      await addTool.executeTool({ description: 'Task 3' }, { threadId: testThreadId });

      // List tasks
      let listResult = await listTool.executeTool({}, { threadId: testThreadId });
      expect(listResult.content[0].text).toContain('Pending tasks (3):');

      // Complete one task
      const taskId = listResult.content[0].text!.match(/#(\d+):/)?.[1];
      await completeTool.executeTool({ id: taskId! }, { threadId: testThreadId });

      // Verify updated list
      listResult = await listTool.executeTool({}, { threadId: testThreadId });
      expect(listResult.content[0].text).toContain('Pending tasks (2):');

      // Verify completed task appears in full list
      const fullListResult = await listTool.executeTool(
        { includeCompleted: true },
        { threadId: testThreadId }
      );
      expect(fullListResult.content[0].text).toContain('Tasks (2 pending, 1 completed):');
    });
  });
});
