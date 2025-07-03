// ABOUTME: Tests for schema-based session task management tools with Zod validation
// ABOUTME: Validates task creation, listing, completion, and state management with enhanced validation

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TaskAddTool,
  TaskListTool,
  TaskCompleteTool,
  clearAllTaskStores,
} from '../implementations/task-manager.js';

describe('Task Management Tools with schema validation', () => {
  let addTool: TaskAddTool;
  let listTool: TaskListTool;
  let completeTool: TaskCompleteTool;
  let testThreadId: string;

  beforeEach(() => {
    addTool = new TaskAddTool();
    listTool = new TaskListTool();
    completeTool = new TaskCompleteTool();
    clearAllTaskStores();
    testThreadId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  });

  describe('TaskAddTool with schema validation', () => {
    describe('Tool metadata', () => {
      it('should have correct name and description', () => {
        expect(addTool.name).toBe('task_add');
        expect(addTool.description).toContain('Add one or more tasks to the session task list');
      });

      it('should have proper input schema', () => {
        const schema = addTool.inputSchema;
        expect(schema.type).toBe('object');
        expect(schema.properties.tasks).toBeDefined();
        expect(schema.required).toEqual(['tasks']);
      });

      it('should be marked as non-idempotent', () => {
        expect(addTool.annotations?.idempotentHint).toBe(false);
      });
    });

    describe('Input validation', () => {
      it('should reject missing tasks parameter', async () => {
        const result = await addTool.execute({});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Validation failed');
        expect(result.content[0].text).toContain('tasks');
      });

      it('should reject empty tasks string', async () => {
        const result = await addTool.execute({ tasks: '' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Validation failed');
        expect(result.content[0].text).toContain('Cannot be empty');
      });

      it('should accept valid single task', async () => {
        const result = await addTool.execute({ tasks: 'Test task' }, { threadId: testThreadId });

        expect(result.isError).toBe(false);
      });

      it('should accept valid JSON array tasks', async () => {
        const result = await addTool.execute(
          { tasks: '["Task 1", "Task 2"]' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
      });

      it('should reject malformed JSON array', async () => {
        const result = await addTool.execute(
          { tasks: '["task1", invalid_json]' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Invalid JSON array format');
      });

      it('should reject empty JSON array', async () => {
        const result = await addTool.execute({ tasks: '[]' }, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Tasks array cannot be empty');
      });
    });

    describe('Task creation functionality', () => {
      it('should add a single task successfully', async () => {
        const result = await addTool.execute({ tasks: 'Test task' }, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toMatch(/Added task #\d+: Test task/);
      });

      it('should assign incremental IDs', async () => {
        const result1 = await addTool.execute({ tasks: 'First task' }, { threadId: testThreadId });
        const result2 = await addTool.execute({ tasks: 'Second task' }, { threadId: testThreadId });

        expect(result1.isError).toBe(false);
        expect(result2.isError).toBe(false);

        const id1 = result1.content[0].text.match(/#(\d+):/)?.[1];
        const id2 = result2.content[0].text.match(/#(\d+):/)?.[1];

        expect(parseInt(id2!)).toBeGreaterThan(parseInt(id1!));
      });

      it('should trim whitespace from descriptions', async () => {
        const result = await addTool.execute(
          { tasks: '  Whitespace task  ' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Whitespace task');
        expect(result.content[0].text).not.toContain('  Whitespace task  ');
      });

      it('should add multiple tasks from JSON array', async () => {
        const result = await addTool.execute(
          { tasks: '["First task", "Second task", "Third task"]' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        const output = result.content[0].text;
        expect(output).toContain('Added 3 tasks');
        expect(output).toContain('First task');
        expect(output).toContain('Second task');
        expect(output).toContain('Third task');
      });

      it('should handle non-string elements in JSON array', async () => {
        const result = await addTool.execute(
          { tasks: '["valid", 123, null]' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Invalid JSON array format');
      });
    });

    describe('Structured output with helpers', () => {
      it('should use createResult for successful task creation', async () => {
        const result = await addTool.execute({ tasks: 'Test task' }, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Added task');
      });

      it('should use createError for validation failures', async () => {
        const result = await addTool.execute({ tasks: '' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Validation failed');
      });
    });
  });

  describe('TaskListTool with schema validation', () => {
    describe('Tool metadata', () => {
      it('should have correct name and description', () => {
        expect(listTool.name).toBe('task_list');
        expect(listTool.description).toBe('List current session tasks');
      });

      it('should have proper input schema', () => {
        const schema = listTool.inputSchema;
        expect(schema.type).toBe('object');
        expect(schema.properties.includeCompleted).toBeDefined();
        expect(schema.required || []).toEqual([]);
      });

      it('should be marked as read-only and idempotent', () => {
        expect(listTool.annotations?.readOnlyHint).toBe(true);
        expect(listTool.annotations?.idempotentHint).toBe(true);
      });
    });

    describe('Input validation', () => {
      it('should accept no parameters', async () => {
        const result = await listTool.execute({}, { threadId: testThreadId });

        expect(result.isError).toBe(false);
      });

      it('should accept valid includeCompleted parameter', async () => {
        const result = await listTool.execute(
          { includeCompleted: true },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
      });

      it('should reject invalid includeCompleted parameter', async () => {
        const result = await listTool.execute(
          { includeCompleted: 'invalid' },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Validation failed');
      });

      it('should use default false for includeCompleted', async () => {
        // Add and complete a task
        const addResult = await addTool.execute(
          { tasks: 'Completed task' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];
        await completeTool.execute({ id: taskId! }, { threadId: testThreadId });

        const result = await listTool.execute({}, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toBe('No pending tasks');
      });
    });

    describe('Task listing functionality', () => {
      it('should show no tasks when list is empty', async () => {
        const result = await listTool.execute({}, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toBe('No pending tasks');
      });

      it('should list pending tasks by default', async () => {
        await addTool.execute({ tasks: 'Pending task' }, { threadId: testThreadId });

        const result = await listTool.execute({}, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        const output = result.content[0].text;
        expect(output).toContain('Pending tasks (1):');
        expect(output).toContain('○ #');
        expect(output).toContain('Pending task');
      });

      it('should exclude completed tasks by default', async () => {
        const addResult = await addTool.execute(
          { tasks: 'Task to complete' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];
        await completeTool.execute({ id: taskId! }, { threadId: testThreadId });

        const result = await listTool.execute({}, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toBe('No pending tasks');
      });

      it('should include completed tasks when requested', async () => {
        const addResult = await addTool.execute(
          { tasks: 'Completed task' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];
        await completeTool.execute({ id: taskId! }, { threadId: testThreadId });

        const result = await listTool.execute(
          { includeCompleted: true },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        const output = result.content[0].text;
        expect(output).toContain('Tasks (0 pending, 1 completed):');
        expect(output).toContain('✓ #');
        expect(output).toContain('Completed task');
        expect(output).toContain('completed');
      });

      it('should show mixed pending and completed tasks', async () => {
        await addTool.execute({ tasks: 'Pending task' }, { threadId: testThreadId });
        const addResult = await addTool.execute(
          { tasks: 'Completed task' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];
        await completeTool.execute({ id: taskId! }, { threadId: testThreadId });

        const result = await listTool.execute(
          { includeCompleted: true },
          { threadId: testThreadId }
        );

        expect(result.isError).toBe(false);
        const output = result.content[0].text;
        expect(output).toContain('Tasks (1 pending, 1 completed):');
        expect(output).toContain('○ #');
        expect(output).toContain('✓ #');
      });
    });
  });

  describe('TaskCompleteTool with schema validation', () => {
    describe('Tool metadata', () => {
      it('should have correct name and description', () => {
        expect(completeTool.name).toBe('task_complete');
        expect(completeTool.description).toBe('Mark a task as completed');
      });

      it('should have proper input schema', () => {
        const schema = completeTool.inputSchema;
        expect(schema.type).toBe('object');
        expect(schema.properties.id).toBeDefined();
        expect(schema.required).toEqual(['id']);
      });

      it('should be marked as non-idempotent', () => {
        expect(completeTool.annotations?.idempotentHint).toBe(false);
      });
    });

    describe('Input validation', () => {
      it('should reject missing id parameter', async () => {
        const result = await completeTool.execute({});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Validation failed');
        expect(result.content[0].text).toContain('id');
      });

      it('should reject empty id parameter', async () => {
        const result = await completeTool.execute({ id: '' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Validation failed');
        expect(result.content[0].text).toContain('Cannot be empty');
      });

      it('should accept valid id parameter', async () => {
        // First add a task to complete
        const addResult = await addTool.execute(
          { tasks: 'Task to complete' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];

        const result = await completeTool.execute({ id: taskId! }, { threadId: testThreadId });

        expect(result.isError).toBe(false);
      });
    });

    describe('Task completion functionality', () => {
      it('should complete an existing task', async () => {
        const addResult = await addTool.execute(
          { tasks: 'Task to complete' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];

        const result = await completeTool.execute({ id: taskId! }, { threadId: testThreadId });

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toMatch(/Completed task #\d+: Task to complete/);
      });

      it('should remove completed task from pending list', async () => {
        const addResult = await addTool.execute(
          { tasks: 'Task to complete' },
          { threadId: testThreadId }
        );
        const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];

        await completeTool.execute({ id: taskId! }, { threadId: testThreadId });
        const listResult = await listTool.execute({}, { threadId: testThreadId });

        expect(listResult.content[0].text).toBe('No pending tasks');
      });

      it('should handle non-existent task ID', async () => {
        const result = await completeTool.execute({ id: '999' }, { threadId: testThreadId });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Task #999 not found');
        expect(result.content[0].text).toContain('Check the task ID and ensure the task exists');
      });
    });
  });

  describe('Integration tests with schema validation', () => {
    it('should handle complete workflow', async () => {
      // Add multiple tasks
      await addTool.execute({ tasks: 'Task 1' }, { threadId: testThreadId });
      await addTool.execute({ tasks: 'Task 2' }, { threadId: testThreadId });
      await addTool.execute({ tasks: 'Task 3' }, { threadId: testThreadId });

      // List tasks
      let listResult = await listTool.execute({}, { threadId: testThreadId });
      expect(listResult.content[0].text).toContain('Pending tasks (3):');

      // Complete one task
      const taskId = listResult.content[0].text.match(/#(\d+):/)?.[1];
      await completeTool.execute({ id: taskId! }, { threadId: testThreadId });

      // Verify updated list
      listResult = await listTool.execute({}, { threadId: testThreadId });
      expect(listResult.content[0].text).toContain('Pending tasks (2):');

      // Verify completed task appears in full list
      const fullListResult = await listTool.execute(
        { includeCompleted: true },
        { threadId: testThreadId }
      );
      expect(fullListResult.content[0].text).toContain('Tasks (2 pending, 1 completed):');
    });

    it('should handle bulk task addition', async () => {
      const result = await addTool.execute(
        { tasks: '["Design API", "Implement endpoints", "Write tests", "Deploy to staging"]' },
        { threadId: testThreadId }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Added 4 tasks');

      const listResult = await listTool.execute({}, { threadId: testThreadId });
      expect(listResult.content[0].text).toContain('Pending tasks (4):');
      expect(listResult.content[0].text).toContain('Design API');
      expect(listResult.content[0].text).toContain('Deploy to staging');
    });

    it('should isolate tasks between different thread contexts', async () => {
      const thread1 = 'thread-1';
      const thread2 = 'thread-2';

      // Add tasks to thread 1
      await addTool.execute({ tasks: 'Thread 1 task' }, { threadId: thread1 });

      // Add tasks to thread 2
      await addTool.execute({ tasks: 'Thread 2 task' }, { threadId: thread2 });

      // Verify thread isolation
      const list1 = await listTool.execute({}, { threadId: thread1 });
      const list2 = await listTool.execute({}, { threadId: thread2 });

      expect(list1.content[0].text).toContain('Thread 1 task');
      expect(list1.content[0].text).not.toContain('Thread 2 task');

      expect(list2.content[0].text).toContain('Thread 2 task');
      expect(list2.content[0].text).not.toContain('Thread 1 task');
    });

    it('should handle complex task completion workflow', async () => {
      // Add multiple tasks with JSON array
      await addTool.execute(
        { tasks: '["Setup environment", "Write code", "Run tests", "Code review"]' },
        { threadId: testThreadId }
      );

      // Get initial list
      let listResult = await listTool.execute({}, { threadId: testThreadId });
      expect(listResult.content[0].text).toContain('Pending tasks (4):');

      // Complete first and third tasks
      const allTasks = listResult.content[0].text.match(/#(\d+):/g);
      const firstTaskId = allTasks?.[0].match(/#(\d+):/)?.[1];
      const thirdTaskId = allTasks?.[2].match(/#(\d+):/)?.[1];

      await completeTool.execute({ id: firstTaskId! }, { threadId: testThreadId });
      await completeTool.execute({ id: thirdTaskId! }, { threadId: testThreadId });

      // Check pending tasks
      listResult = await listTool.execute({}, { threadId: testThreadId });
      expect(listResult.content[0].text).toContain('Pending tasks (2):');

      // Check full list
      const fullListResult = await listTool.execute(
        { includeCompleted: true },
        { threadId: testThreadId }
      );
      expect(fullListResult.content[0].text).toContain('Tasks (2 pending, 2 completed):');
    });
  });

  describe('Structured output with helpers across all tools', () => {
    it('should use createResult for successful operations', async () => {
      const addResult = await addTool.execute({ tasks: 'Test task' }, { threadId: testThreadId });
      const listResult = await listTool.execute({}, { threadId: testThreadId });
      const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];
      const completeResult = await completeTool.execute(
        { id: taskId! },
        { threadId: testThreadId }
      );

      expect(addResult.isError).toBe(false);
      expect(listResult.isError).toBe(false);
      expect(completeResult.isError).toBe(false);
    });

    it('should use createError for validation failures', async () => {
      const addResult = await addTool.execute({ tasks: '' });
      const listResult = await listTool.execute({ includeCompleted: 'invalid' });
      const completeResult = await completeTool.execute({ id: '' });

      expect(addResult.isError).toBe(true);
      expect(listResult.isError).toBe(true);
      expect(completeResult.isError).toBe(true);

      expect(addResult.content[0].text).toContain('Validation failed');
      expect(listResult.content[0].text).toContain('Validation failed');
      expect(completeResult.content[0].text).toContain('Validation failed');
    });
  });

  describe('Edge cases', () => {
    it('should handle very long task descriptions', async () => {
      const longDescription = 'A'.repeat(1000);
      const result = await addTool.execute({ tasks: longDescription }, { threadId: testThreadId });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Added task');
    });

    it('should handle special characters in task descriptions', async () => {
      const specialTask = 'Task with "quotes" and $pecial char$ & symbols!';
      const result = await addTool.execute({ tasks: specialTask }, { threadId: testThreadId });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(specialTask);
    });

    it('should handle unicode characters in task descriptions', async () => {
      const unicodeTask = 'Unicode task 世界 🌍 test';
      const result = await addTool.execute({ tasks: unicodeTask }, { threadId: testThreadId });

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(unicodeTask);
    });

    it('should handle completion of already completed tasks gracefully', async () => {
      const addResult = await addTool.execute(
        { tasks: 'Task to complete twice' },
        { threadId: testThreadId }
      );
      const taskId = addResult.content[0].text.match(/#(\d+):/)?.[1];

      // Complete once
      const firstComplete = await completeTool.execute({ id: taskId! }, { threadId: testThreadId });
      expect(firstComplete.isError).toBe(false);

      // Complete again
      const secondComplete = await completeTool.execute(
        { id: taskId! },
        { threadId: testThreadId }
      );
      expect(secondComplete.isError).toBe(false);
    });
  });
});
