// ABOUTME: Tests for session task management tools
// ABOUTME: Validates task creation, listing, completion, and state management

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TaskAddTool,
  TaskListTool,
  TaskCompleteTool,
  clearAllTaskStores,
} from '../implementations/task-manager.js';
import { createTestToolCall } from './test-utils.js';

describe('Task Management Tools', () => {
  const addTool = new TaskAddTool();
  const listTool = new TaskListTool();
  const completeTool = new TaskCompleteTool();

  let testThreadId: string;

  // Clear all task stores before each test to ensure isolation
  beforeEach(() => {
    clearAllTaskStores();
    testThreadId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  });

  describe('TaskAddTool', () => {
    describe('tool metadata', () => {
      it('should have correct name and description', () => {
        expect(addTool.name).toBe('task_add');
        expect(addTool.description).toBe(
          'Add one or more tasks to the session task list. Supports both single task (string) and multiple tasks (array of strings) for bulk operations.'
        );
        expect(addTool.annotations?.idempotentHint).toBe(false);
      });

      it('should have correct input schema', () => {
        expect(addTool.inputSchema).toEqual({
          type: 'object',
          properties: {
            tasks: {
              type: 'string',
              description:
                'Task description(s) - can be a single string or array of strings (JSON array format)',
            },
          },
          required: ['tasks'],
        });
      });
    });

    describe('task creation', () => {
      it('should add a new task successfully', async () => {
        const result = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: 'Test task' }),
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toMatch(/Added task #\d+: Test task/);
      });

      it('should assign incremental IDs', async () => {
        const result1 = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: 'First task' }),
          { threadId: testThreadId }
        );
        const result2 = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: 'Second task' }),
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
          createTestToolCall('task_add', { tasks: '  Whitespace task  ' }),
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Whitespace task');
        expect(result.content[0].text).not.toContain('  Whitespace task  ');
      });

      it('should add multiple tasks with JSON array format', async () => {
        const result = await addTool.executeTool(
          createTestToolCall('task_add', {
            tasks: '["First task", "Second task", "Third task"]',
          }),
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        const output = result.content[0].text!;
        expect(output).toContain('Added 3 tasks');
        expect(output).toContain('First task');
        expect(output).toContain('Second task');
        expect(output).toContain('Third task');
      });

      it('should handle empty JSON array', async () => {
        const result = await addTool.executeTool(createTestToolCall('task_add', { tasks: '[]' }), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Tasks array cannot be empty');
      });

      it('should handle malformed JSON', async () => {
        const result = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: '["task1", invalid_json]' }), // Invalid JSON syntax
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Invalid JSON array format');
      });

      it('should handle non-string elements in array', async () => {
        const result = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: '["valid", 123, null]' }),
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Parameter 'tasks[1]' must be string");
      });
    });

    describe('error handling', () => {
      it('should handle missing tasks parameter', async () => {
        const result = await addTool.executeTool(createTestToolCall('task_add', {}), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(
          'Tasks parameter must be a string or array of strings'
        );
        expect(result.content[0].text).toContain('Received undefined');
      });

      it('should handle empty tasks parameter', async () => {
        const result = await addTool.executeTool(createTestToolCall('task_add', { tasks: '' }), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          "Parameter 'tasks' must be non-empty string. Provide a valid non-empty string value. Parameter cannot be empty"
        );
      });

      it('should handle whitespace-only tasks parameter', async () => {
        const result = await addTool.executeTool(createTestToolCall('task_add', { tasks: '   ' }), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          "Parameter 'tasks' must be non-empty string. Provide a valid non-empty string value. Parameter cannot be empty"
        );
      });

      it('should handle non-string tasks parameter', async () => {
        const result = await addTool.executeTool(createTestToolCall('task_add', { tasks: 123 }), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(
          'Tasks parameter must be a string or array of strings'
        );
        expect(result.content[0].text).toContain('Received number');
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
        const result = await listTool.executeTool(createTestToolCall('task_list', {}), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toBe('No pending tasks');
      });

      it('should list pending tasks by default', async () => {
        await addTool.executeTool(createTestToolCall('task_add', { tasks: 'Pending task' }), {
          threadId: testThreadId,
        });

        const result = await listTool.executeTool(createTestToolCall('task_list', {}), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(false);
        const output = result.content[0].text!;
        expect(output).toContain('Pending tasks (1):');
        expect(output).toContain('○ #');
        expect(output).toContain('Pending task');
      });

      it('should exclude completed tasks by default', async () => {
        const addResult = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: 'Task to complete' }),
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];
        await completeTool.executeTool(createTestToolCall('task_complete', { id: taskId! }), {
          threadId: testThreadId,
        });

        const result = await listTool.executeTool(createTestToolCall('task_list', {}), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toBe('No pending tasks');
      });

      it('should include completed tasks when requested', async () => {
        const addResult = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: 'Completed task' }),
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];
        await completeTool.executeTool(createTestToolCall('task_complete', { id: taskId! }), {
          threadId: testThreadId,
        });

        const result = await listTool.executeTool(
          createTestToolCall('task_list', { includeCompleted: true }),
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
        await addTool.executeTool(createTestToolCall('task_add', { tasks: 'Pending task' }), {
          threadId: testThreadId,
        });
        const addResult = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: 'Completed task' }),
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];
        await completeTool.executeTool(createTestToolCall('task_complete', { id: taskId! }), {
          threadId: testThreadId,
        });

        const result = await listTool.executeTool(
          createTestToolCall('task_list', { includeCompleted: true }),
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
        expect(completeTool.inputSchema).toEqual({
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
          createTestToolCall('task_add', { tasks: 'Task to complete' }),
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];

        const result = await completeTool.executeTool(
          createTestToolCall('task_complete', { id: taskId! }),
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toMatch(/Completed task #\d+: Task to complete/);
      });

      it('should remove completed task from pending list', async () => {
        const addResult = await addTool.executeTool(
          createTestToolCall('task_add', { tasks: 'Task to complete' }),
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text!.match(/#(\d+):/)?.[1];

        await completeTool.executeTool(createTestToolCall('task_complete', { id: taskId! }), {
          threadId: testThreadId,
        });
        const listResult = await listTool.executeTool(createTestToolCall('task_list', {}), {
          threadId: testThreadId,
        });

        expect(listResult.content[0].text).toBe('No pending tasks');
      });
    });

    describe('error handling', () => {
      it('should handle missing task ID', async () => {
        const result = await completeTool.executeTool(createTestToolCall('task_complete', {}), {
          threadId: testThreadId,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          "Parameter 'id' must be string. Provide a valid string value. Parameter is required"
        );
      });

      it('should handle empty task ID', async () => {
        const result = await completeTool.executeTool(
          createTestToolCall('task_complete', { id: '' }),
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          "Parameter 'id' must be non-empty string. Provide a valid non-empty string value. Parameter cannot be empty"
        );
      });

      it('should handle non-existent task ID', async () => {
        const result = await completeTool.executeTool(
          createTestToolCall('task_complete', { id: '999' }),
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          'Task #999 not found. Check the task ID and ensure the task exists. Task lookup failed'
        );
      });

      it('should handle non-string task ID', async () => {
        const result = await completeTool.executeTool(
          createTestToolCall('task_complete', { id: 123 }),
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          "Parameter 'id' must be string. Provide a valid string value. Received number"
        );
      });
    });
  });

  describe('integration tests', () => {
    it('should handle complete workflow', async () => {
      // Add multiple tasks
      await addTool.executeTool(createTestToolCall('task_add', { tasks: 'Task 1' }), {
        threadId: testThreadId,
      });
      await addTool.executeTool(createTestToolCall('task_add', { tasks: 'Task 2' }), {
        threadId: testThreadId,
      });
      await addTool.executeTool(createTestToolCall('task_add', { tasks: 'Task 3' }), {
        threadId: testThreadId,
      });

      // List tasks
      let listResult = await listTool.executeTool(createTestToolCall('task_list', {}), {
        threadId: testThreadId,
      });
      expect(listResult.content[0].text).toContain('Pending tasks (3):');

      // Complete one task
      const taskId = listResult.content[0].text!.match(/#(\d+):/)?.[1];
      await completeTool.executeTool(createTestToolCall('task_complete', { id: taskId! }), {
        threadId: testThreadId,
      });

      // Verify updated list
      listResult = await listTool.executeTool(createTestToolCall('task_list', {}), {
        threadId: testThreadId,
      });
      expect(listResult.content[0].text).toContain('Pending tasks (2):');

      // Verify completed task appears in full list
      const fullListResult = await listTool.executeTool(
        createTestToolCall('task_list', { includeCompleted: true }),
        { threadId: testThreadId }
      );
      expect(fullListResult.content[0].text).toContain('Tasks (2 pending, 1 completed):');
    });
  });
});
