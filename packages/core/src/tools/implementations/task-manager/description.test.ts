// ABOUTME: Tests for task management tool descriptions to ensure they contain proper guidance
// ABOUTME: Validates that all tools have examples, usage information, and no placeholder content

import { describe, it, expect } from 'vitest';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/tools';
import { DelegateTool } from '~/tools/implementations/delegate';
import type { TaskStatus } from '~/tasks/types';

describe('Tool Descriptions', () => {
  it('should include usage examples in descriptions', () => {
    const tools = [
      new TaskCreateTool(),
      new TaskListTool(),
      new TaskCompleteTool(),
      new TaskUpdateTool(),
      new TaskAddNoteTool(),
      new TaskViewTool(),
    ];

    for (const tool of tools) {
      // Check for example content (case insensitive)
      expect(tool.description.toLowerCase()).toMatch(/example[s]?/i);
      expect(tool.description.length).toBeGreaterThan(100); // Substantial description
      expect(tool.description).not.toContain('TODO'); // No placeholder text
    }
  });

  it('should explain when to use each tool', () => {
    const taskCreateTool = new TaskCreateTool();
    expect(taskCreateTool.description).toContain('WHEN TO');

    const taskCompleteTool = new TaskCompleteTool();
    expect(taskCompleteTool.description).toContain('Always include:');
  });

  it('delegate tool should reference latest models', () => {
    const delegateTool = new DelegateTool();
    expect(delegateTool.description).toContain('claude-3-5-haiku-20241022');
    expect(delegateTool.description).toContain('claude-sonnet-4-20250514');
    expect(delegateTool.description).not.toContain('claude-3-5-haiku-latest');
  });
});

describe('TaskStatus Type Definitions', () => {
  it('should include archived status', () => {
    const archivedStatus: TaskStatus = 'archived';
    expect(archivedStatus).toBe('archived');
  });

  it('should include all expected status values', () => {
    const validStatuses: TaskStatus[] = [
      'pending',
      'in_progress',
      'completed',
      'blocked',
      'archived',
    ];

    validStatuses.forEach((status) => {
      const testStatus: TaskStatus = status;
      expect(typeof testStatus).toBe('string');
    });
  });
});
