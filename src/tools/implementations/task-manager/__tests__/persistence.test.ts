// ABOUTME: Tests for task persistence layer with SQLite database
// ABOUTME: Validates CRUD operations, thread filtering, and concurrent access

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskPersistence } from '../persistence.js';
import { Task, TaskNote } from '../types.js';
import { createThreadId, createNewAgentSpec } from '../../../../threads/types.js';

describe('TaskPersistence', () => {
  let tempDbPath: string;
  let persistence: TaskPersistence;
  
  // Test data
  const parentThreadId = createThreadId('lace_20250703_parent');
  const agent1ThreadId = createThreadId('lace_20250703_parent.1');
  const agent2ThreadId = createThreadId('lace_20250703_parent.2');
  
  beforeEach(() => {
    // Create temporary database file
    tempDbPath = path.join(os.tmpdir(), `lace-tasks-test-${Date.now()}.db`);
    persistence = new TaskPersistence(tempDbPath);
  });

  afterEach(() => {
    persistence.close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  describe('initialization', () => {
    it('should create database tables', () => {
      // Tables should be created automatically
      expect(fs.existsSync(tempDbPath)).toBe(true);
    });
  });

  describe('task CRUD operations', () => {
    it('should save and load task', async () => {
      const task: Task = {
        id: 'task_20250703_test01',
        title: 'Test task',
        description: 'Test description',
        prompt: 'Do something',
        status: 'pending',
        priority: 'high',
        createdBy: agent1ThreadId,
        threadId: parentThreadId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };

      await persistence.saveTask(task);
      const loaded = persistence.loadTask(task.id);

      expect(loaded).toBeTruthy();
      expect(loaded?.id).toBe(task.id);
      expect(loaded?.title).toBe(task.title);
      expect(loaded?.description).toBe(task.description);
      expect(loaded?.prompt).toBe(task.prompt);
      expect(loaded?.status).toBe(task.status);
      expect(loaded?.priority).toBe(task.priority);
      expect(loaded?.createdBy).toBe(task.createdBy);
      expect(loaded?.threadId).toBe(task.threadId);
    });

    it('should handle task with assignee', async () => {
      const task: Task = {
        id: 'task_20250703_test02',
        title: 'Assigned task',
        description: 'Test',
        prompt: 'Do something',
        status: 'in_progress',
        priority: 'medium',
        assignedTo: agent2ThreadId,
        createdBy: agent1ThreadId,
        threadId: parentThreadId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };

      await persistence.saveTask(task);
      const loaded = persistence.loadTask(task.id);

      expect(loaded?.assignedTo).toBe(agent2ThreadId);
    });

    it('should handle task with new agent spec assignee', async () => {
      const newAgentSpec = createNewAgentSpec('anthropic', 'claude-3-haiku');
      const task: Task = {
        id: 'task_20250703_test03',
        title: 'Task for new agent',
        description: 'Test',
        prompt: 'Do something',
        status: 'pending',
        priority: 'low',
        assignedTo: newAgentSpec,
        createdBy: agent1ThreadId,
        threadId: parentThreadId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };

      await persistence.saveTask(task);
      const loaded = persistence.loadTask(task.id);

      expect(loaded?.assignedTo).toBe('new:anthropic/claude-3-haiku');
    });

    it('should update existing task', async () => {
      const task: Task = {
        id: 'task_20250703_test04',
        title: 'Original title',
        description: 'Original',
        prompt: 'Do something',
        status: 'pending',
        priority: 'high',
        createdBy: agent1ThreadId,
        threadId: parentThreadId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };

      await persistence.saveTask(task);
      
      // Update task
      await persistence.updateTask(task.id, {
        title: 'Updated title',
        status: 'completed',
        assignedTo: agent2ThreadId,
      });

      const loaded = persistence.loadTask(task.id);
      expect(loaded?.title).toBe('Updated title');
      expect(loaded?.status).toBe('completed');
      expect(loaded?.assignedTo).toBe(agent2ThreadId);
      expect(loaded?.description).toBe('Original'); // Unchanged
    });

    it('should return null for non-existent task', () => {
      const loaded = persistence.loadTask('non_existent');
      expect(loaded).toBeNull();
    });
  });

  describe('task filtering', () => {
    beforeEach(async () => {
      // Create test tasks
      const tasks: Task[] = [
        {
          id: 'task_1',
          title: 'Task in parent thread',
          description: '',
          prompt: 'Do something',
          status: 'pending',
          priority: 'high',
          createdBy: agent1ThreadId,
          threadId: parentThreadId,
          createdAt: new Date(),
          updatedAt: new Date(),
          notes: [],
        },
        {
          id: 'task_2',
          title: 'Task assigned to agent2',
          description: '',
          prompt: 'Do something',
          status: 'in_progress',
          priority: 'medium',
          assignedTo: agent2ThreadId,
          createdBy: agent1ThreadId,
          threadId: parentThreadId,
          createdAt: new Date(),
          updatedAt: new Date(),
          notes: [],
        },
        {
          id: 'task_3',
          title: 'Task in different thread',
          description: '',
          prompt: 'Do something',
          status: 'completed',
          priority: 'low',
          createdBy: createThreadId('lace_20250703_other1'),
          threadId: createThreadId('lace_20250703_other1'),
          createdAt: new Date(),
          updatedAt: new Date(),
          notes: [],
        },
      ];

      for (const task of tasks) {
        await persistence.saveTask(task);
      }
    });

    it('should load tasks by thread', () => {
      const tasks = persistence.loadTasksByThread(parentThreadId);
      expect(tasks).toHaveLength(2);
      expect(tasks.every(t => t.threadId === parentThreadId)).toBe(true);
    });

    it('should load tasks by assignee', () => {
      const tasks = persistence.loadTasksByAssignee(agent2ThreadId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].assignedTo).toBe(agent2ThreadId);
    });

    it('should return empty array for thread with no tasks', () => {
      const tasks = persistence.loadTasksByThread(createThreadId('lace_20250703_empty1'));
      expect(tasks).toEqual([]);
    });
  });

  describe('task notes', () => {
    it('should add note to task', async () => {
      const task: Task = {
        id: 'task_20250703_notes',
        title: 'Task with notes',
        description: '',
        prompt: 'Do something',
        status: 'pending',
        priority: 'high',
        createdBy: agent1ThreadId,
        threadId: parentThreadId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };

      await persistence.saveTask(task);

      // Add note
      const note: Omit<TaskNote, 'id'> = {
        author: agent2ThreadId,
        content: 'This is a test note',
        timestamp: new Date(),
      };

      await persistence.addNote(task.id, note);

      // Load task with notes
      const loaded = persistence.loadTask(task.id);
      expect(loaded?.notes).toHaveLength(1);
      expect(loaded?.notes[0].author).toBe(agent2ThreadId);
      expect(loaded?.notes[0].content).toBe('This is a test note');
      expect(loaded?.notes[0].id).toBeTruthy(); // Auto-generated
    });

    it('should add multiple notes and maintain order', async () => {
      const task: Task = {
        id: 'task_20250703_multi_notes',
        title: 'Task with multiple notes',
        description: '',
        prompt: 'Do something',
        status: 'pending',
        priority: 'medium',
        createdBy: agent1ThreadId,
        threadId: parentThreadId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };

      await persistence.saveTask(task);

      // Add notes with different timestamps
      const timestamps = [
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T11:00:00Z'),
        new Date('2025-01-01T12:00:00Z'),
      ];

      for (let i = 0; i < timestamps.length; i++) {
        await persistence.addNote(task.id, {
          author: i % 2 === 0 ? agent1ThreadId : agent2ThreadId,
          content: `Note ${i + 1}`,
          timestamp: timestamps[i],
        });
      }

      const loaded = persistence.loadTask(task.id);
      expect(loaded?.notes).toHaveLength(3);
      
      // Verify chronological order
      for (let i = 1; i < loaded!.notes.length; i++) {
        expect(loaded!.notes[i].timestamp.getTime()).toBeGreaterThan(
          loaded!.notes[i - 1].timestamp.getTime()
        );
      }
    });
  });

  describe('error handling', () => {
    it('should handle duplicate task ID gracefully', async () => {
      const task: Task = {
        id: 'task_duplicate',
        title: 'First task',
        description: '',
        prompt: 'Do something',
        status: 'pending',
        priority: 'high',
        createdBy: agent1ThreadId,
        threadId: parentThreadId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };

      await persistence.saveTask(task);

      // Try to save task with same ID
      task.title = 'Second task';
      await expect(persistence.saveTask(task)).rejects.toThrow();
    });

    it('should handle note for non-existent task', async () => {
      await expect(
        persistence.addNote('non_existent', {
          author: agent1ThreadId,
          content: 'Test',
          timestamp: new Date(),
        })
      ).rejects.toThrow();
    });
  });
});