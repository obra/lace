// ABOUTME: Tests for task formatter utility
// ABOUTME: Validates task list formatting, grouping, and display options

import { describe, it, expect } from 'vitest';
import { TaskFormatter } from '~/tools/implementations/task-manager/formatter';
import { Task } from '~/tools/implementations/task-manager/types';
import { createThreadId, createNewAgentSpec } from '~/threads/types';

describe('TaskFormatter', () => {
  const parentThreadId = createThreadId('lace_20250703_parent');
  const agent1ThreadId = createThreadId('lace_20250703_parent.1');
  const agent2ThreadId = createThreadId('lace_20250703_parent.2');

  const createTestTasks = (): Task[] => [
    {
      id: 'task_20250703_test01',
      title: 'High priority pending task',
      description: 'Important work',
      prompt: 'Do important things',
      status: 'pending',
      priority: 'high',
      createdBy: agent1ThreadId,
      threadId: parentThreadId,
      createdAt: new Date('2025-01-01T10:00:00Z'),
      updatedAt: new Date('2025-01-01T10:00:00Z'),
      notes: [],
    },
    {
      id: 'task_20250703_test02',
      title: 'Medium priority in progress',
      description: 'Work in progress',
      prompt: 'Continue working',
      status: 'in_progress',
      priority: 'medium',
      assignedTo: agent2ThreadId,
      createdBy: agent1ThreadId,
      threadId: parentThreadId,
      createdAt: new Date('2025-01-01T11:00:00Z'),
      updatedAt: new Date('2025-01-01T12:00:00Z'),
      notes: [
        {
          id: '1',
          author: agent2ThreadId,
          content: 'Started working on this',
          timestamp: new Date('2025-01-01T11:30:00Z'),
        },
      ],
    },
    {
      id: 'task_20250703_test03',
      title: 'Low priority completed',
      description: 'Finished work',
      prompt: 'Complete the task',
      status: 'completed',
      priority: 'low',
      assignedTo: agent1ThreadId,
      createdBy: agent2ThreadId,
      threadId: parentThreadId,
      createdAt: new Date('2025-01-01T09:00:00Z'),
      updatedAt: new Date('2025-01-01T13:00:00Z'),
      notes: [],
    },
    {
      id: 'task_20250703_test04',
      title: 'Blocked task',
      description: 'Waiting on dependencies',
      prompt: 'Fix the blocker first',
      status: 'blocked',
      priority: 'high',
      assignedTo: createNewAgentSpec('anthropic', 'claude-3-haiku'),
      createdBy: agent1ThreadId,
      threadId: parentThreadId,
      createdAt: new Date('2025-01-01T08:00:00Z'),
      updatedAt: new Date('2025-01-01T08:00:00Z'),
      notes: [],
    },
  ];

  describe('formatTaskList', () => {
    it('should format basic task list', () => {
      const tasks = createTestTasks();
      const result = TaskFormatter.formatTaskList(tasks);

      expect(result).toContain('High priority pending task');
      expect(result).toContain('Medium priority in progress');
      expect(result).toContain('Low priority completed');
      expect(result).toContain('Blocked task');
    });

    it('should show status indicators', () => {
      const tasks = createTestTasks();
      const result = TaskFormatter.formatTaskList(tasks);

      expect(result).toContain('○'); // pending
      expect(result).toContain('◐'); // in_progress
      expect(result).toContain('✓'); // completed
      expect(result).toContain('⊗'); // blocked
    });

    it('should show assignees when requested', () => {
      const tasks = createTestTasks();
      const result = TaskFormatter.formatTaskList(tasks, { showAssignee: true });

      expect(result).toContain('→ 2'); // Last part of agent2ThreadId
      expect(result).toContain('→ 1'); // Last part of agent1ThreadId
      expect(result).toContain('new:anthropic/claude-3-haiku');
    });

    it('should group by status', () => {
      const tasks = createTestTasks();
      const result = TaskFormatter.formatTaskList(tasks, { groupBy: 'status' });

      const lines = result.split('\n');

      // Find group headers
      const pendingIndex = lines.findIndex((l) => l.includes('Status: pending'));
      const inProgressIndex = lines.findIndex((l) => l.includes('Status: in_progress'));
      const completedIndex = lines.findIndex((l) => l.includes('Status: completed'));
      const blockedIndex = lines.findIndex((l) => l.includes('Status: blocked'));

      // Verify groups exist
      expect(pendingIndex).toBeGreaterThan(-1);
      expect(inProgressIndex).toBeGreaterThan(-1);
      expect(completedIndex).toBeGreaterThan(-1);
      expect(blockedIndex).toBeGreaterThan(-1);

      // Verify they're in the expected order (pending, in_progress, blocked, completed)
      expect(inProgressIndex).toBeGreaterThan(pendingIndex);
      expect(blockedIndex).toBeGreaterThan(inProgressIndex);
      expect(completedIndex).toBeGreaterThan(blockedIndex);
    });

    it('should group by priority', () => {
      const tasks = createTestTasks();
      const result = TaskFormatter.formatTaskList(tasks, { groupBy: 'priority' });

      const lines = result.split('\n');

      // Find group headers
      const highIndex = lines.findIndex((l) => l.includes('High Priority'));
      const mediumIndex = lines.findIndex((l) => l.includes('Medium Priority'));
      const lowIndex = lines.findIndex((l) => l.includes('Low Priority'));

      // Verify groups exist and are in order
      expect(highIndex).toBeGreaterThan(-1);
      expect(mediumIndex).toBeGreaterThan(highIndex);
      expect(lowIndex).toBeGreaterThan(mediumIndex);
    });

    it('should show note count when notes exist', () => {
      const tasks = createTestTasks();
      const result = TaskFormatter.formatTaskList(tasks, { showNotes: true });

      expect(result).toContain('1 note');
    });

    it('should use display names when metadata provided', () => {
      const tasks = createTestTasks();
      const metadata = new Map([
        [agent1ThreadId, { displayName: 'Alice' }],
        [agent2ThreadId, { displayName: 'Bob' }],
      ]);

      const result = TaskFormatter.formatTaskList(tasks, {
        showAssignee: true,
        threadMetadata: metadata,
      });

      expect(result).toContain('Bob'); // agent2 display name
      expect(result).not.toContain(agent2ThreadId); // Should use display name instead
    });

    it('should handle empty task list', () => {
      const result = TaskFormatter.formatTaskList([]);
      expect(result).toBe('No tasks found');
    });
  });

  describe('formatTask', () => {
    it('should format single task with basic info', () => {
      const task = createTestTasks()[0];
      const result = TaskFormatter.formatTask(task);

      expect(result).toContain(task.id);
      expect(result).toContain(task.title);
      expect(result).toContain('pending');
      expect(result).toContain('high');
    });

    it('should include detailed info when requested', () => {
      const task = createTestTasks()[1];
      const result = TaskFormatter.formatTask(task, true);

      expect(result).toContain(task.description);
      expect(result).toContain(task.prompt);
      expect(result).toContain('Created by:');
      expect(result).toContain('Assigned to:');
      expect(result).toContain('Notes:');
      expect(result).toContain('Started working on this');
    });

    it('should handle task without assignee', () => {
      const task = createTestTasks()[0];
      const result = TaskFormatter.formatTask(task, true);

      expect(result).not.toContain('Assigned to:');
    });

    it('should format timestamps properly', () => {
      const task = createTestTasks()[2];
      const result = TaskFormatter.formatTask(task, true);

      expect(result).toMatch(/Created at: \d{1,2}\/\d{1,2}\/\d{4}/);
      expect(result).toMatch(/Updated at: \d{1,2}\/\d{1,2}\/\d{4}/);
    });
  });

  describe('formatAssignee', () => {
    it('should show thread ID without metadata', () => {
      const result = TaskFormatter['formatAssignee'](agent1ThreadId);
      expect(result).toBe('1'); // Last part of hierarchical ID
    });

    it('should show display name with metadata', () => {
      const metadata = new Map([[agent1ThreadId, { displayName: 'Alice' }]]);
      const result = TaskFormatter['formatAssignee'](agent1ThreadId, metadata);
      expect(result).toBe('Alice');
    });

    it('should handle new agent spec format', () => {
      const newAgentSpec = createNewAgentSpec('anthropic', 'claude-3-haiku');
      const result = TaskFormatter['formatAssignee'](newAgentSpec);
      expect(result).toBe('new:anthropic/claude-3-haiku');
    });

    it('should handle base thread ID without hierarchy', () => {
      const result = TaskFormatter['formatAssignee'](parentThreadId);
      expect(result).toBe(parentThreadId); // Should return full ID when no hierarchy
    });
  });
});
