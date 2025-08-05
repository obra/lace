// ABOUTME: Tests for the TaskManager service that handles task operations
// ABOUTME: Validates task CRUD, filtering, session scoping, and multi-agent scenarios

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskManager } from '~/tasks/task-manager';
import { DatabasePersistence } from '~/persistence/database';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { Task, CreateTaskRequest, TaskContext } from '~/tasks/types';
import { asThreadId } from '~/threads/types';

describe('TaskManager', () => {
  let persistence: DatabasePersistence;
  let manager: TaskManager;
  const sessionId = asThreadId('lace_20250714_abc123');

  beforeEach(() => {
    persistence = // setupTestPersistence replaced by setupCoreTest
    manager = new TaskManager(sessionId, persistence);
  });

  afterEach(() => {
    persistence.close();
    // Test cleanup handled by setupCoreTest
    vi.restoreAllMocks();
  });

  describe('createTask', () => {
    it('should create task with required fields', async () => {
      const request: CreateTaskRequest = {
        title: 'Test Task',
        description: 'Test description',
        prompt: 'Test prompt',
        priority: 'medium',
      };
      const context: TaskContext = {
        actor: 'lace_20250714_abc123.1',
        isHuman: false,
      };

      const task = await manager.createTask(request, context);

      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test description');
      expect(task.prompt).toBe('Test prompt');
      expect(task.priority).toBe('medium');
      expect(task.status).toBe('pending');
      expect(task.createdBy).toBe('lace_20250714_abc123.1');
      expect(task.threadId).toBe(sessionId);
      expect(task.id).toMatch(/^task_\d{8}_[a-z0-9]{6}$/);
      expect(task.notes).toEqual([]);
    });

    it('should create task with default priority', async () => {
      const request: CreateTaskRequest = {
        title: 'Test Task',
        prompt: 'Test prompt',
      };
      const context: TaskContext = {
        actor: 'lace_20250714_abc123.1',
        isHuman: false,
      };

      const task = await manager.createTask(request, context);

      expect(task.priority).toBe('medium');
      expect(task.description).toBe('');
    });

    it('should create task with assignee', async () => {
      const request: CreateTaskRequest = {
        title: 'Test Task',
        prompt: 'Test prompt',
        assignedTo: 'lace_20250714_abc123.2',
      };
      const context: TaskContext = {
        actor: 'lace_20250714_abc123.1',
        isHuman: false,
      };

      const task = await manager.createTask(request, context);

      expect(task.assignedTo).toBe('lace_20250714_abc123.2');
    });

    it('should validate required fields', async () => {
      const request = { title: '', description: '', prompt: '' } as CreateTaskRequest;
      const context: TaskContext = {
        actor: 'lace_20250714_abc123.1',
        isHuman: false,
      };

      await expect(manager.createTask(request, context)).rejects.toThrow(
        'Title and prompt are required'
      );
    });

    it('should support human creators', async () => {
      const request: CreateTaskRequest = {
        title: 'Human Task',
        prompt: 'Do this task',
      };
      const context: TaskContext = {
        actor: `${sessionId}:human`,
        isHuman: true,
      };

      const task = await manager.createTask(request, context);

      expect(task.createdBy).toBe(`${sessionId}:human`);
    });
  });

  describe('getTasks', () => {
    beforeEach(async () => {
      // Create test tasks
      const tasks = [
        { title: 'High Priority Task', priority: 'high' as const, status: 'pending' as const },
        {
          title: 'Medium Priority Task',
          priority: 'medium' as const,
          status: 'in_progress' as const,
        },
        { title: 'Low Priority Task', priority: 'low' as const, status: 'completed' as const },
        { title: 'Blocked Task', priority: 'high' as const, status: 'blocked' as const },
      ];

      for (const taskData of tasks) {
        await manager.createTask(
          {
            title: taskData.title,
            prompt: 'Test prompt',
            priority: taskData.priority,
          },
          { actor: 'lace_20250714_abc123.1', isHuman: false }
        );

        // Update status if needed
        if (taskData.status !== 'pending') {
          const createdTasks = manager.getTasks();
          const task = createdTasks.find((t) => t.title === taskData.title);
          if (task) {
            await manager.updateTask(
              task.id,
              { status: taskData.status },
              { actor: 'lace_20250714_abc123.1', isHuman: false }
            );
          }
        }
      }
    });

    it('should return all tasks for session', () => {
      const tasks = manager.getTasks();

      expect(tasks).toHaveLength(4);
      expect(tasks.every((t) => t.threadId === sessionId)).toBe(true);
    });

    it('should filter by status', () => {
      const pendingTasks = manager.getTasks({ status: 'pending' });
      const completedTasks = manager.getTasks({ status: 'completed' });

      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0].title).toBe('High Priority Task');

      expect(completedTasks).toHaveLength(1);
      expect(completedTasks[0].title).toBe('Low Priority Task');
    });

    it('should filter by priority', () => {
      const highPriorityTasks = manager.getTasks({ priority: 'high' });

      expect(highPriorityTasks).toHaveLength(2);
      expect(highPriorityTasks.every((t) => t.priority === 'high')).toBe(true);
    });

    it('should filter by assignee', async () => {
      // Assign one task to a specific agent
      const tasks = manager.getTasks();
      await manager.updateTask(
        tasks[0].id,
        { assignedTo: asThreadId('lace_20250714_abc123.2') },
        { actor: 'lace_20250714_abc123.1', isHuman: false }
      );

      const assignedTasks = manager.getTasks({ assignedTo: 'lace_20250714_abc123.2' });

      expect(assignedTasks).toHaveLength(1);
      expect(assignedTasks[0].assignedTo).toBe('lace_20250714_abc123.2');
    });

    it('should return empty array when no tasks match filters', () => {
      const tasks = manager.getTasks({
        status: 'pending',
        priority: 'low',
      });

      expect(tasks).toEqual([]);
    });
  });

  describe('getTaskById', () => {
    it('should return task by id', async () => {
      const created = await manager.createTask(
        { title: 'Test Task', prompt: 'Test' },
        { actor: 'lace_20250714_abc123.1', isHuman: false }
      );

      const task = manager.getTaskById(created.id);

      expect(task).toBeDefined();
      expect(task?.id).toBe(created.id);
      expect(task?.title).toBe('Test Task');
    });

    it('should return null for non-existent task', () => {
      const task = manager.getTaskById('task_20250714_nonexistent');

      expect(task).toBeNull();
    });

    it('should not return tasks from other sessions', async () => {
      // Create task in different session
      const otherManager = new TaskManager(asThreadId('other_session'), persistence);
      const otherTask = await otherManager.createTask(
        { title: 'Other Task', prompt: 'Test' },
        { actor: 'other_session.1', isHuman: false }
      );

      const task = manager.getTaskById(otherTask.id);

      expect(task).toBeNull();
    });
  });

  describe('updateTask', () => {
    let testTask: Task;

    beforeEach(async () => {
      testTask = await manager.createTask(
        {
          title: 'Original Title',
          description: 'Original description',
          prompt: 'Original prompt',
          priority: 'medium',
        },
        { actor: 'lace_20250714_abc123.1', isHuman: false }
      );
    });

    it('should update task fields', async () => {
      // Add small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await manager.updateTask(
        testTask.id,
        {
          title: 'Updated Title',
          description: 'Updated description',
          status: 'in_progress',
          priority: 'high',
        },
        { actor: 'lace_20250714_abc123.1', isHuman: false }
      );

      expect(updated.title).toBe('Updated Title');
      expect(updated.description).toBe('Updated description');
      expect(updated.status).toBe('in_progress');
      expect(updated.priority).toBe('high');
      expect(updated.prompt).toBe('Original prompt'); // Unchanged
      expect(updated.updatedAt.getTime()).toBeGreaterThan(testTask.updatedAt.getTime());
    });

    it('should update assignee', async () => {
      const updated = await manager.updateTask(
        testTask.id,
        { assignedTo: asThreadId('lace_20250714_abc123.2') },
        { actor: 'lace_20250714_abc123.1', isHuman: false }
      );

      expect(updated.assignedTo).toBe('lace_20250714_abc123.2');
    });

    it('should throw error for non-existent task', async () => {
      await expect(
        manager.updateTask(
          'task_20250714_nonexistent',
          { status: 'completed' },
          { actor: 'lace_20250714_abc123.1', isHuman: false }
        )
      ).rejects.toThrow('Task not found');
    });

    it('should not update tasks from other sessions', async () => {
      const otherManager = new TaskManager(asThreadId('other_session'), persistence);
      const otherTask = await otherManager.createTask(
        { title: 'Other Task', prompt: 'Test' },
        { actor: 'other_session.1', isHuman: false }
      );

      await expect(
        manager.updateTask(
          otherTask.id,
          { status: 'completed' },
          { actor: 'lace_20250714_abc123.1', isHuman: false }
        )
      ).rejects.toThrow('Task not found');
    });
  });

  describe('addNote', () => {
    let testTask: Task;

    beforeEach(async () => {
      testTask = await manager.createTask(
        { title: 'Test Task', prompt: 'Test' },
        { actor: 'lace_20250714_abc123.1', isHuman: false }
      );
    });

    it('should add note to task', async () => {
      await manager.addNote(testTask.id, 'This is a test note', {
        actor: 'lace_20250714_abc123.2',
        isHuman: false,
      });

      // Verify note is added to task
      const updatedTask = manager.getTaskById(testTask.id);
      expect(updatedTask?.notes).toHaveLength(1);
      expect(updatedTask?.notes[0].content).toBe('This is a test note');
      expect(updatedTask?.notes[0].author).toBe('lace_20250714_abc123.2');
      expect(updatedTask?.notes[0].id).toBeDefined();
    });

    it('should add multiple notes', async () => {
      await manager.addNote(testTask.id, 'First note', {
        actor: 'lace_20250714_abc123.1',
        isHuman: false,
      });
      await manager.addNote(testTask.id, 'Second note', {
        actor: 'lace_20250714_abc123.2',
        isHuman: false,
      });
      await manager.addNote(testTask.id, 'Third note', {
        actor: `${sessionId}:human`,
        isHuman: true,
      });

      const updatedTask = manager.getTaskById(testTask.id);
      expect(updatedTask?.notes).toHaveLength(3);
      expect(updatedTask?.notes[0].content).toBe('First note');
      expect(updatedTask?.notes[1].content).toBe('Second note');
      expect(updatedTask?.notes[2].content).toBe('Third note');
      expect(updatedTask?.notes[2].author).toBe(`${sessionId}:human`);
    });

    it('should throw error for non-existent task', async () => {
      await expect(
        manager.addNote('task_20250714_nonexistent', 'Note content', {
          actor: 'lace_20250714_abc123.1',
          isHuman: false,
        })
      ).rejects.toThrow('Task not found');
    });
  });

  describe.skip('deleteTask', () => {
    it('should delete task', async () => {
      const task = await manager.createTask(
        { title: 'To Delete', prompt: 'Test' },
        { actor: 'lace_20250714_abc123.1', isHuman: false }
      );

      await manager.deleteTask(task.id, { actor: 'lace_20250714_abc123.1', isHuman: false });

      const deleted = manager.getTaskById(task.id);
      expect(deleted).toBeNull();
    });

    it('should throw error for non-existent task', async () => {
      await expect(
        manager.deleteTask('task_20250714_nonexistent', {
          actor: 'lace_20250714_abc123.1',
          isHuman: false,
        })
      ).rejects.toThrow('Task not found');
    });

    it('should not delete tasks from other sessions', async () => {
      const otherManager = new TaskManager(asThreadId('other_session'), persistence);
      const otherTask = await otherManager.createTask(
        { title: 'Other Task', prompt: 'Test' },
        { actor: 'other_session.1', isHuman: false }
      );

      await expect(
        manager.deleteTask(otherTask.id, { actor: 'lace_20250714_abc123.1', isHuman: false })
      ).rejects.toThrow('Task not found');

      // Verify task still exists in other session
      const stillExists = otherManager.getTaskById(otherTask.id);
      expect(stillExists).toBeDefined();
    });
  });

  describe('getTaskSummary', () => {
    beforeEach(async () => {
      // Create tasks with different statuses
      const taskData = [
        { status: 'pending' },
        { status: 'pending' },
        { status: 'pending' },
        { status: 'in_progress' },
        { status: 'in_progress' },
        { status: 'completed' },
        { status: 'blocked' },
      ];

      for (const data of taskData) {
        const task = await manager.createTask(
          { title: `${data.status} task`, prompt: 'Test' },
          { actor: 'lace_20250714_abc123.1', isHuman: false }
        );

        if (data.status !== 'pending') {
          await manager.updateTask(
            task.id,
            { status: data.status as Task['status'] },
            { actor: 'lace_20250714_abc123.1', isHuman: false }
          );
        }
      }
    });

    it('should return correct task counts', () => {
      const summary = manager.getTaskSummary();

      expect(summary.total).toBe(7);
      expect(summary.pending).toBe(3);
      expect(summary.in_progress).toBe(2);
      expect(summary.completed).toBe(1);
      expect(summary.blocked).toBe(1);
    });

    it('should return zero counts for empty session', () => {
      const emptyManager = new TaskManager(asThreadId('empty_session'), persistence);
      const summary = emptyManager.getTaskSummary();

      expect(summary.total).toBe(0);
      expect(summary.pending).toBe(0);
      expect(summary.in_progress).toBe(0);
      expect(summary.completed).toBe(0);
      expect(summary.blocked).toBe(0);
    });
  });

  describe('session isolation', () => {
    it('should isolate tasks between sessions', async () => {
      const session1Manager = manager;
      const session2Manager = new TaskManager(asThreadId('lace_20250714_xyz789'), persistence);

      // Create tasks in both sessions
      await session1Manager.createTask(
        { title: 'Session 1 Task', prompt: 'Test' },
        { actor: 'lace_20250714_abc123.1', isHuman: false }
      );

      await session2Manager.createTask(
        { title: 'Session 2 Task', prompt: 'Test' },
        { actor: 'lace_20250714_xyz789.1', isHuman: false }
      );

      // Verify isolation
      const session1Tasks = session1Manager.getTasks();
      const session2Tasks = session2Manager.getTasks();

      expect(session1Tasks).toHaveLength(1);
      expect(session1Tasks[0].title).toBe('Session 1 Task');

      expect(session2Tasks).toHaveLength(1);
      expect(session2Tasks[0].title).toBe('Session 2 Task');
    });
  });
});
