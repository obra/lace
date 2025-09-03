// ABOUTME: Test suite for task tool renderers TDD implementation
// ABOUTME: Comprehensive tests for task management tool display customizations

import { describe, test, expect } from 'vitest';
import {
  faClipboardList,
  faPlus,
  faCheck,
  faEdit,
  faStickyNote,
  faEye,
} from '@fortawesome/free-solid-svg-icons';
import type { ToolResult } from '@/types/core';
import { taskRenderers } from './task';

describe('Task Tool Renderers', () => {
  describe('task_add renderer', () => {
    const mockTaskAddArgs = {
      title: 'Implement user authentication',
      description: 'Add login and registration functionality',
      priority: 'high',
      assignedTo: 'lace_20250101_thrd01',
    };

    const mockTaskAddResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            taskId: 'task-456',
            title: 'Implement user authentication',
            status: 'pending',
            priority: 'high',
            createdAt: '2025-01-15T10:30:00Z',
          }),
        },
      ],
      status: 'completed' as const,
    };

    test('should create formatted summary for task creation', () => {
      const summary = taskRenderers.task_add.getSummary?.(mockTaskAddArgs);
      expect(summary).toBe('Implement user authentication');
    });

    test('should handle missing title gracefully', () => {
      const summary = taskRenderers.task_add.getSummary?.({});
      expect(summary).toBe('New task');
    });

    test('should return plus icon', () => {
      const icon = taskRenderers.task_add.getIcon?.();
      expect(icon).toBe(faPlus);
    });

    test('should return custom display name for success', () => {
      const displayName = taskRenderers.task_add.getDisplayName?.('task_add', mockTaskAddResult);
      expect(displayName).toBe('Created task');
    });

    test('should return different display name for no result', () => {
      const displayName = taskRenderers.task_add.getDisplayName?.('task_add');
      expect(displayName).toBe('Creating task');
    });

    test('should return failure display name for errors', () => {
      const errorResult: ToolResult = {
        content: [{ type: 'text', text: 'Error creating task' }],
        status: 'failed' as const,
      };
      const displayName = taskRenderers.task_add.getDisplayName?.('task_add', errorResult);
      expect(displayName).toBe('Failed to create task');
    });

    test('should render successful task creation result', () => {
      const resultNode = taskRenderers.task_add.renderResult?.(mockTaskAddResult);
      expect(resultNode).toBeDefined(); // Success cases show link to view task
      expect(typeof resultNode).toBe('object');
    });
  });

  describe('task_list renderer', () => {
    const mockTaskListArgs = {
      filter: 'mine',
      includeCompleted: false,
    };

    const mockTaskListResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            tasks: [
              {
                id: 'task-1',
                title: 'Fix login bug',
                status: 'pending',
                priority: 'high',
                assignedTo: 'lace_20250101_thrd01',
              },
              {
                id: 'task-2',
                title: 'Update documentation',
                status: 'in_progress',
                priority: 'medium',
                assignedTo: 'lace_20250101_thrd02',
              },
            ],
            totalCount: 2,
          }),
        },
      ],
      status: 'completed' as const,
    };

    test('should create formatted summary for task listing', () => {
      const summary = taskRenderers.task_list.getSummary?.(mockTaskListArgs);
      expect(summary).toBe('List my tasks');
    });

    test('should handle different filter types', () => {
      const allTasksSummary = taskRenderers.task_list.getSummary?.({ filter: 'all' });
      expect(allTasksSummary).toBe('List all tasks');

      const threadTasksSummary = taskRenderers.task_list.getSummary?.({ filter: 'thread' });
      expect(threadTasksSummary).toBe('List thread tasks');
    });

    test('should return clipboard icon', () => {
      const icon = taskRenderers.task_list.getIcon?.();
      expect(icon).toBe(faClipboardList);
    });

    test('should render task list results', () => {
      const resultNode = taskRenderers.task_list.renderResult?.(mockTaskListResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });
  });

  describe('task_complete renderer', () => {
    const mockTaskCompleteArgs = {
      id: 'task_20250731_n9q0qi',
      message: 'Successfully implemented authentication with JWT tokens',
    };

    const mockTaskCompleteResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            taskId: 'task-456',
            title: 'Implement user authentication',
            status: 'completed',
            completedAt: '2025-01-15T15:30:00Z',
          }),
        },
      ],
      status: 'completed' as const,
    };

    test('should create formatted summary for task completion', () => {
      const summary = taskRenderers.task_complete.getSummary?.(mockTaskCompleteArgs);
      expect(summary).toBe('Task task_20250731_n9q0qi completed');
    });

    test('should return check icon', () => {
      const icon = taskRenderers.task_complete.getIcon?.();
      expect(icon).toBe(faCheck);
    });

    test('should render task completion result', () => {
      const resultNode = taskRenderers.task_complete.renderResult?.(mockTaskCompleteResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });
  });

  describe('task_update renderer', () => {
    const mockTaskUpdateArgs = {
      taskId: 'task-456',
      status: 'in_progress',
      priority: 'high',
    };

    const mockTaskUpdateResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            taskId: 'task-456',
            title: 'Implement user authentication',
            status: 'in_progress',
            priority: 'high',
            updatedAt: '2025-01-15T12:00:00Z',
          }),
        },
      ],
      status: 'completed' as const,
    };

    test('should create formatted summary for task updates', () => {
      const summary = taskRenderers.task_update.getSummary?.(mockTaskUpdateArgs);
      expect(summary).toBe('Updated task task-456');
    });

    test('should return edit icon', () => {
      const icon = taskRenderers.task_update.getIcon?.();
      expect(icon).toBe(faEdit);
    });

    test('should render task update result', () => {
      const resultNode = taskRenderers.task_update.renderResult?.(mockTaskUpdateResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });
  });

  describe('task_add_note renderer', () => {
    const mockTaskAddNoteArgs = {
      taskId: 'task-456',
      note: 'Need to test with different browsers',
    };

    const mockTaskAddNoteResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            taskId: 'task-456',
            noteId: 'note-789',
            note: 'Need to test with different browsers',
            addedAt: '2025-01-15T14:00:00Z',
          }),
        },
      ],
      status: 'completed' as const,
    };

    test('should create formatted summary for adding notes', () => {
      const summary = taskRenderers.task_add_note.getSummary?.(mockTaskAddNoteArgs);
      expect(summary).toBe('Add note to task: task-456');
    });

    test('should return sticky note icon', () => {
      const icon = taskRenderers.task_add_note.getIcon?.();
      expect(icon).toBe(faStickyNote);
    });

    test('should render note addition result', () => {
      const resultNode = taskRenderers.task_add_note.renderResult?.(mockTaskAddNoteResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });
  });

  describe('task_view renderer', () => {
    const mockTaskViewArgs = {
      taskId: 'task-456',
    };

    const mockTaskViewResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: 'task-456',
            title: 'Implement user authentication',
            description: 'Add login and registration functionality',
            status: 'in_progress',
            priority: 'high',
            createdAt: '2025-01-15T10:30:00Z',
            assignedTo: 'lace_20250101_thrd01',
            notes: [
              {
                id: 'note-1',
                content: 'Initial research completed',
                addedAt: '2025-01-15T11:00:00Z',
              },
            ],
          }),
        },
      ],
      status: 'completed' as const,
    };

    test('should create formatted summary for task viewing', () => {
      const summary = taskRenderers.task_view.getSummary?.(mockTaskViewArgs);
      expect(summary).toBe('View task: task-456');
    });

    test('should return eye icon', () => {
      const icon = taskRenderers.task_view.getIcon?.();
      expect(icon).toBe(faEye);
    });

    test('should render detailed task view result', () => {
      const resultNode = taskRenderers.task_view.renderResult?.(mockTaskViewResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });
  });

  describe('error handling', () => {
    const errorResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Task not found',
            code: 'TASK_NOT_FOUND',
          }),
        },
      ],
      status: 'failed' as const,
    };

    test('should detect errors correctly', () => {
      const isError = taskRenderers.task_view.isError?.(errorResult);
      expect(isError).toBe(true);
    });

    test('should render error states beautifully', () => {
      const resultNode = taskRenderers.task_view.renderResult?.(errorResult);
      expect(resultNode).toBeDefined();
      expect(typeof resultNode).toBe('object');
    });
  });

  describe('integration with tool renderer system', () => {
    test('should have all task renderers defined', () => {
      expect(taskRenderers.task_add).toBeDefined();
      expect(taskRenderers.task_list).toBeDefined();
      expect(taskRenderers.task_complete).toBeDefined();
      expect(taskRenderers.task_update).toBeDefined();
      expect(taskRenderers.task_add_note).toBeDefined();
      expect(taskRenderers.task_view).toBeDefined();
    });

    test('should be compatible with ToolRenderer interface', () => {
      Object.values(taskRenderers).forEach((renderer) => {
        expect(typeof renderer.getSummary).toBe('function');
        expect(typeof renderer.isError).toBe('function');
        expect(typeof renderer.renderResult).toBe('function');
        expect(typeof renderer.getIcon).toBe('function');
      });
    });
  });
});
