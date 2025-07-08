// ABOUTME: Tests for NotificationFormatter system message formatting
// ABOUTME: Ensures task notifications are formatted correctly for agent consumption

import { describe, it, expect } from 'vitest';
import { NotificationFormatter } from '../notifications.js';

describe('NotificationFormatter', () => {
  describe('formatTaskAssignment', () => {
    it('should format basic task assignment notification', () => {
      const task = {
        title: 'Implement feature X',
        prompt: 'Add a new feature that does X, Y, and Z.',
        priority: 'normal',
        createdBy: 'user123',
      };

      const result = NotificationFormatter.formatTaskAssignment(task);

      expect(result).toContain('[LACE TASK SYSTEM]');
      expect(result).toContain('Implement feature X');
      expect(result).toContain('user123');
      expect(result).toContain('normal');
      expect(result).toContain('Add a new feature that does X, Y, and Z.');
      expect(result).toContain('--- TASK DETAILS ---');
      expect(result).toContain('--- END TASK DETAILS ---');
    });

    it('should format high priority task assignment', () => {
      const task = {
        title: 'Urgent bug fix',
        prompt: 'Fix the critical bug in production immediately.',
        priority: 'high',
        createdBy: 'admin',
      };

      const result = NotificationFormatter.formatTaskAssignment(task);

      expect(result).toContain('Priority: high');
      expect(result).toContain('Created by: admin');
      expect(result).toContain('Urgent bug fix');
    });

    it('should handle empty fields gracefully', () => {
      const task = {
        title: '',
        prompt: '',
        priority: '',
        createdBy: '',
      };

      const result = NotificationFormatter.formatTaskAssignment(task);

      expect(result).toContain('[LACE TASK SYSTEM]');
      expect(result).toContain('Title: ""');
      expect(result).toContain('Created by:');
      expect(result).toContain('Priority:');
      expect(typeof result).toBe('string');
    });

    it('should handle special characters properly', () => {
      const task = {
        title: 'Task with "quotes" & <symbols>',
        prompt: 'Handle & process <special> "characters" properly.',
        priority: 'normal',
        createdBy: 'user@domain.com',
      };

      const result = NotificationFormatter.formatTaskAssignment(task);

      expect(result).toContain('Task with "quotes" & <symbols>');
      expect(result).toContain('Handle & process <special> "characters" properly.');
      expect(result).toContain('user@domain.com');
    });

    it('should format multiline prompts correctly', () => {
      const task = {
        title: 'Complex task',
        prompt: 'Line 1\nLine 2\nLine 3',
        priority: 'normal',
        createdBy: 'user',
      };

      const result = NotificationFormatter.formatTaskAssignment(task);

      expect(result).toContain('Line 1\nLine 2\nLine 3');
      expect(result.split('\n').length).toBeGreaterThan(3);
    });
  });

  describe('formatTaskCompletion', () => {
    it('should format basic task completion notification', () => {
      const task = {
        title: 'Completed feature X',
        assignedTo: 'agent456',
        notes: [
          { content: 'Implemented the main functionality', author: 'agent456' },
          { content: 'Added comprehensive tests', author: 'agent456' },
        ],
      };

      const result = NotificationFormatter.formatTaskCompletion(task);

      expect(result).toContain('[LACE TASK SYSTEM]');
      expect(result).toContain('Completed feature X');
      expect(result).toContain('agent456');
      expect(result).toContain('Implemented the main functionality');
      expect(result).toContain('Added comprehensive tests');
    });

    it('should handle task with no notes', () => {
      const task = {
        title: 'Simple task',
        assignedTo: 'agent123',
        notes: [],
      };

      const result = NotificationFormatter.formatTaskCompletion(task);

      expect(result).toContain('Simple task');
      expect(result).toContain('agent123');
      expect(typeof result).toBe('string');
    });

    it('should format multiple notes from different authors', () => {
      const task = {
        title: 'Collaborative task',
        assignedTo: 'agent1',
        notes: [
          { content: 'Started the work', author: 'agent1' },
          { content: 'Reviewed and approved', author: 'supervisor' },
          { content: 'Added final touches', author: 'agent1' },
        ],
      };

      const result = NotificationFormatter.formatTaskCompletion(task);

      expect(result).toContain('Started the work');
      expect(result).toContain('Reviewed and approved');
      expect(result).toContain('Added final touches');
      expect(result).toContain('agent1');
      expect(result).toContain('supervisor');
    });

    it('should handle empty note content', () => {
      const task = {
        title: 'Task with empty notes',
        assignedTo: 'agent',
        notes: [
          { content: '', author: 'agent' },
          { content: 'Valid note', author: 'agent' },
        ],
      };

      const result = NotificationFormatter.formatTaskCompletion(task);

      expect(result).toContain('Valid note');
      expect(typeof result).toBe('string');
    });
  });
});