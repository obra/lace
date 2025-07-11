// ABOUTME: Test file for TaskListToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with compact task list display

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskListToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/TaskListToolRenderer.js';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext.js';
import { ToolRendererProps } from '~/interfaces/terminal/components/events/tool-renderers/components/shared.js';

// Mock the expansion toggle hooks
vi.mock('../hooks/useTimelineExpansionToggle.js', () => ({
  TimelineExpansionProvider: ({ children }: any) => children,
  useTimelineItemExpansion: () => ({
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
  }),
}));

const createMockProvider = () => {
  return ({ children }: { children: React.ReactNode }) => (
    <TimelineItemProvider isSelected={false}>{children}</TimelineItemProvider>
  );
};

describe('TaskListToolRenderer', () => {
  let MockProvider: React.ComponentType<{ children: React.ReactNode }>;

  beforeEach(() => {
    MockProvider = createMockProvider();
  });

  const mockTaskListResult = {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify([
          {
            id: 'task_20250705_b9qers',
            title: 'Test task management suite',
            status: 'pending',
            priority: 'high',
            assignedTo: 'current',
          },
          {
            id: 'task_20250705_wpd92m',
            title: 'Create sample bug fix task',
            status: 'in_progress',
            priority: 'medium',
            assignedTo: 'thread-456',
          },
          {
            id: 'task_20250705_xyz123',
            title: 'Blocked dependency task',
            status: 'blocked',
            priority: 'low',
            assignedTo: 'current',
          },
        ]),
      },
    ],
    isError: false,
    id: 'test-call-id',
  };

  const mockSuccessItem: ToolRendererProps['item'] = {
    type: 'tool_execution',
    call: {
      id: 'test-call-id',
      name: 'task_list',
      arguments: {
        filter: 'thread',
        includeCompleted: false,
      },
    },
    result: mockTaskListResult,
    timestamp: new Date('2025-07-05T16:06:43.912Z'),
    callId: 'test-call-id',
  };

  it('should render task list with status icons and details', () => {
    const { lastFrame } = render(
      <MockProvider>
        <TaskListToolRenderer item={mockSuccessItem} />
      </MockProvider>
    );

    const output = lastFrame();

    // Should show success status and count
    expect(output).toContain('✔  task_list:');
    expect(output).toContain('3 tasks found (filter: thread)');

    // Should show each task with appropriate status icon
    expect(output).toContain('○ task_20250705_b9qers [high] Test task management suite');
    expect(output).toContain('◐ task_20250705_wpd92m [medium] Create sample bug fix task');
    expect(output).toContain('⊗ task_20250705_xyz123 [low] Blocked dependency task');
  });

  it('should render empty task list', () => {
    const emptyItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify([]),
          },
        ],
        isError: false,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskListToolRenderer item={emptyItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✔  task_list:');
    expect(output).toContain('0 tasks found (filter: thread)');
  });

  it('should render single task', () => {
    const singleTaskItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify([
              {
                id: 'task_20250705_single',
                title: 'Single task',
                status: 'completed',
                priority: 'medium',
                assignedTo: 'current',
              },
            ]),
          },
        ],
        isError: false,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskListToolRenderer item={singleTaskItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('1 task found (filter: thread)');
    expect(output).toContain('✓ task_20250705_single [medium] Single task');
  });

  it('should render error state', () => {
    const errorItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: 'Failed to fetch tasks: Database connection error',
          },
        ],
        isError: true,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskListToolRenderer item={errorItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✘ task_list:');
    expect(output).toContain('Failed to fetch tasks: Database connection error');
  });

  it('should render pending state', () => {
    const pendingItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: undefined, // No result means still running
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskListToolRenderer item={pendingItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('⧖ task_list:');
    expect(output).toContain('Fetching tasks...');
  });
});
