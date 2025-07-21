// ABOUTME: Tests for task note management functionality
// ABOUTME: Validates note addition, ordering, and multi-agent communication

import { describe, it, expect } from 'vitest';
import { Task, TaskNote } from '~/tools/implementations/task-manager/types';
import { createThreadId } from '~/threads/types';

describe('Task Note Management', () => {
  const parentThreadId = createThreadId('lace_20250703_parent');
  const agent1ThreadId = createThreadId('lace_20250703_parent.1');
  const agent2ThreadId = createThreadId('lace_20250703_parent.2');

  function createTestTask(): Task {
    return {
      id: 'task_20250703_test01',
      title: 'Test task',
      description: 'A test task',
      prompt: 'Do something',
      status: 'pending',
      priority: 'medium',
      createdBy: agent1ThreadId,
      threadId: parentThreadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };
  }

  describe('Note addition', () => {
    it('should add single note to task', () => {
      const task = createTestTask();
      const note: TaskNote = {
        id: '1',
        author: agent1ThreadId,
        content: 'Starting work on this task',
        timestamp: new Date(),
      };

      task.notes.push(note);

      expect(task.notes).toHaveLength(1);
      expect(task.notes[0]).toEqual(note);
    });

    it('should add multiple notes from different agents', () => {
      const task = createTestTask();

      const note1: TaskNote = {
        id: '1',
        author: agent1ThreadId,
        content: 'I will start working on this',
        timestamp: new Date('2025-01-01T10:00:00Z'),
      };

      const note2: TaskNote = {
        id: '2',
        author: agent2ThreadId,
        content: 'I can help with the testing part',
        timestamp: new Date('2025-01-01T10:05:00Z'),
      };

      const note3: TaskNote = {
        id: '3',
        author: agent1ThreadId,
        content: 'Great, I will focus on implementation',
        timestamp: new Date('2025-01-01T10:10:00Z'),
      };

      task.notes.push(note1, note2, note3);

      expect(task.notes).toHaveLength(3);
      expect(task.notes[0].author).toBe(agent1ThreadId);
      expect(task.notes[1].author).toBe(agent2ThreadId);
      expect(task.notes[2].author).toBe(agent1ThreadId);
    });
  });

  describe('Note ordering', () => {
    it('should maintain chronological order', () => {
      const task = createTestTask();

      const timestamps = [
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T11:00:00Z'),
        new Date('2025-01-01T12:00:00Z'),
      ];

      timestamps.forEach((timestamp, index) => {
        task.notes.push({
          id: String(index + 1),
          author: agent1ThreadId,
          content: `Note ${index + 1}`,
          timestamp,
        });
      });

      // Verify chronological order
      for (let i = 1; i < task.notes.length; i++) {
        expect(task.notes[i].timestamp.getTime()).toBeGreaterThan(
          task.notes[i - 1].timestamp.getTime()
        );
      }
    });
  });

  describe('Note content', () => {
    it('should support multiline notes', () => {
      const task = createTestTask();
      const multilineContent = `Progress update:
- Completed authentication module
- Started on authorization
- Need help with JWT implementation`;

      const note: TaskNote = {
        id: '1',
        author: agent1ThreadId,
        content: multilineContent,
        timestamp: new Date(),
      };

      task.notes.push(note);

      expect(task.notes[0].content).toBe(multilineContent);
      expect(task.notes[0].content.split('\n')).toHaveLength(4);
    });

    it('should support technical content with special characters', () => {
      const task = createTestTask();
      const technicalContent =
        'Fixed bug in `auth.validate()` function: changed regex from /^[a-z]+$/ to /^[a-zA-Z0-9_-]+$/';

      const note: TaskNote = {
        id: '1',
        author: agent1ThreadId,
        content: technicalContent,
        timestamp: new Date(),
      };

      task.notes.push(note);

      expect(task.notes[0].content).toBe(technicalContent);
    });
  });

  describe('Task updates with notes', () => {
    it('should update task updatedAt when adding notes', () => {
      const task = createTestTask();
      const originalUpdatedAt = task.updatedAt;

      // Simulate time passing
      const laterTime = new Date(originalUpdatedAt.getTime() + 60000); // 1 minute later

      const note: TaskNote = {
        id: '1',
        author: agent1ThreadId,
        content: 'Added a note',
        timestamp: laterTime,
      };

      task.notes.push(note);
      task.updatedAt = laterTime;

      expect(task.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });
});
