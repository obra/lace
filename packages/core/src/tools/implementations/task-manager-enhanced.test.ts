// ABOUTME: Tests for enhanced task manager with multi-agent support
// ABOUTME: Validates extended data model, thread scoping, and note management

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Task, TaskNote } from '~/tasks/types';
import { asThreadId, createNewAgentSpec, isAssigneeId } from '~/threads/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Enhanced Task Data Model', () => {
  const _tempLaceDir = setupCoreTest();
  let testTask: Task;
  const creatorThreadId = asThreadId('lace_20250703_abc123');
  const parentThreadId = asThreadId('lace_20250703_abc123');

  beforeEach(() => {
    testTask = {
      id: 'task_20250703_test01',
      title: 'Implement authentication',
      description: 'Add user login functionality',
      prompt:
        'Create a secure authentication system with JWT tokens. Include login, logout, and session management.',
      status: 'pending',
      priority: 'high',
      createdBy: creatorThreadId,
      threadId: parentThreadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
  });

  describe('Task creation', () => {
    it('should create task with all required fields', () => {
      expect(testTask.title).toBe('Implement authentication');
      expect(testTask.description).toBe('Add user login functionality');
      expect(testTask.prompt).toBeTruthy();
      expect(testTask.status).toBe('pending');
      expect(testTask.priority).toBe('high');
      expect(testTask.createdBy).toBe(creatorThreadId);
      expect(testTask.threadId).toBe(parentThreadId);
      expect(testTask.notes).toEqual([]);
    });

    it('should accept task without assignee', () => {
      expect(testTask.assignedTo).toBeUndefined();
    });

    it('should accept task with thread ID assignee', () => {
      const assigneeId = asThreadId('lace_20250703_xyz789.1');
      testTask.assignedTo = assigneeId;
      expect(testTask.assignedTo).toBe(assigneeId);
      expect(isAssigneeId(testTask.assignedTo)).toBe(true);
    });

    it('should accept task with new agent spec assignee', () => {
      const newAgentSpec = createNewAgentSpec('anthropic', 'claude-3-haiku');
      testTask.assignedTo = newAgentSpec;
      expect(testTask.assignedTo).toBe('new:anthropic/claude-3-haiku');
      expect(isAssigneeId(testTask.assignedTo)).toBe(true);
    });
  });

  describe('Task status transitions', () => {
    it('should support all status values', () => {
      const statuses: Task['status'][] = ['pending', 'in_progress', 'completed', 'blocked'];

      statuses.forEach((status) => {
        testTask.status = status;
        expect(testTask.status).toBe(status);
      });
    });
  });

  describe('Task notes', () => {
    it('should add notes to task', () => {
      const note: TaskNote = {
        id: '1',
        author: asThreadId('lace_20250703_xyz789.1'),
        content: 'Started working on authentication module',
        timestamp: new Date(),
      };

      testTask.notes.push(note);
      expect(testTask.notes).toHaveLength(1);
      expect(testTask.notes[0].content).toBe('Started working on authentication module');
    });

    it('should maintain note order', () => {
      const note1: TaskNote = {
        id: '1',
        author: asThreadId('lace_20250703_xyz789.1'),
        content: 'First note',
        timestamp: new Date('2025-01-01T10:00:00Z'),
      };

      const note2: TaskNote = {
        id: '2',
        author: asThreadId('lace_20250703_xyz789.2'),
        content: 'Second note',
        timestamp: new Date('2025-01-01T11:00:00Z'),
      };

      testTask.notes.push(note1, note2);
      expect(testTask.notes[0].content).toBe('First note');
      expect(testTask.notes[1].content).toBe('Second note');
    });
  });

  describe('Backwards compatibility', () => {
    it('should handle missing optional fields gracefully', () => {
      const minimalTask: Partial<Task> = {
        id: 'task_20250703_test02',
        title: 'Simple task',
        prompt: 'Do something',
        status: 'pending',
        priority: 'medium',
        createdBy: creatorThreadId,
        threadId: parentThreadId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };

      // Description is optional
      expect(minimalTask.description).toBeUndefined();
      expect(minimalTask.assignedTo).toBeUndefined();
    });
  });
});
