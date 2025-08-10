// ABOUTME: Integration tests for task tool renderer registration
// ABOUTME: Verifies all task renderers are properly registered and accessible

import { describe, test, expect } from 'vitest';
import { getToolRenderer } from './index';
import {
  faClipboardList,
  faPlus,
  faCheck,
  faEdit,
  faStickyNote,
  faEye,
} from '@fortawesome/free-solid-svg-icons';

describe('Task Tool Renderer Integration', () => {
  const taskTools = [
    'task_add',
    'task_list',
    'task_complete',
    'task_update',
    'task_add_note',
    'task_view',
  ];

  taskTools.forEach((toolName) => {
    describe(`${toolName} tool renderer`, () => {
      test('should retrieve renderer from registry', () => {
        const renderer = getToolRenderer(toolName);

        expect(renderer).toBeDefined();
        expect(renderer.getSummary).toBeDefined();
        expect(renderer.isError).toBeDefined();
        expect(renderer.renderResult).toBeDefined();
        expect(renderer.getIcon).toBeDefined();
      });

      test('should handle case-insensitive lookup', () => {
        const rendererLower = getToolRenderer(toolName.toLowerCase());
        const rendererUpper = getToolRenderer(toolName.toUpperCase());
        const rendererMixed = getToolRenderer(
          toolName.charAt(0).toUpperCase() + toolName.slice(1).toLowerCase()
        );

        expect(rendererLower).toBe(rendererUpper);
        expect(rendererLower).toBe(rendererMixed);
      });

      test('should have valid icon', () => {
        const renderer = getToolRenderer(toolName);
        const icon = renderer.getIcon?.();

        expect(icon).toBeDefined();
        expect(typeof icon).toBe('object');
      });

      test('should generate valid summary', () => {
        const renderer = getToolRenderer(toolName);
        const summary = renderer.getSummary?.({});

        expect(summary).toBeDefined();
        expect(typeof summary).toBe('string');
        expect(summary?.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Task tool renderer icons', () => {
    test('should return correct icons for each tool', () => {
      expect(getToolRenderer('task_add').getIcon?.()).toBe(faPlus);
      expect(getToolRenderer('task_list').getIcon?.()).toBe(faClipboardList);
      expect(getToolRenderer('task_complete').getIcon?.()).toBe(faCheck);
      expect(getToolRenderer('task_update').getIcon?.()).toBe(faEdit);
      expect(getToolRenderer('task_add_note').getIcon?.()).toBe(faStickyNote);
      expect(getToolRenderer('task_view').getIcon?.()).toBe(faEye);
    });
  });

  describe('Task tool renderer summaries', () => {
    test('should create meaningful summaries', () => {
      expect(getToolRenderer('task_add').getSummary?.({ title: 'Test Task' })).toBe('Test Task');

      expect(getToolRenderer('task_list').getSummary?.({ filter: 'mine' })).toBe('List my tasks');

      expect(getToolRenderer('task_complete').getSummary?.({ id: 'task-123' })).toBe(
        'Mark task task-123 as completed'
      );

      expect(getToolRenderer('task_update').getSummary?.({ taskId: 'task-456' })).toBe(
        'Updated task task-456'
      );

      expect(getToolRenderer('task_add_note').getSummary?.({ taskId: 'task-789' })).toBe(
        'Add note to task: task-789'
      );

      expect(getToolRenderer('task_view').getSummary?.({ taskId: 'task-101' })).toBe(
        'View task: task-101'
      );
    });
  });

  describe('Error detection', () => {
    const errorResult = {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: 'Task not found',
            code: 'TASK_NOT_FOUND',
          }),
        },
      ],
      status: 'failed' as const,
    };

    taskTools.forEach((toolName) => {
      test(`should detect errors for ${toolName}`, () => {
        const renderer = getToolRenderer(toolName);
        const isError = renderer.isError?.(errorResult);
        expect(isError).toBe(true);
      });
    });
  });

  describe('Registry completeness', () => {
    test('should have all task tools registered', () => {
      taskTools.forEach((toolName) => {
        const renderer = getToolRenderer(toolName);
        expect(renderer).not.toEqual({});
        expect(Object.keys(renderer).length).toBeGreaterThan(0);
      });
    });

    test('should maintain interface compatibility', () => {
      taskTools.forEach((toolName) => {
        const renderer = getToolRenderer(toolName);

        // Type check - if this compiles, the interface is compatible
        expect(typeof renderer.getSummary).toBe('function');
        expect(typeof renderer.isError).toBe('function');
        expect(typeof renderer.renderResult).toBe('function');
        expect(typeof renderer.getIcon).toBe('function');
      });
    });
  });
});
