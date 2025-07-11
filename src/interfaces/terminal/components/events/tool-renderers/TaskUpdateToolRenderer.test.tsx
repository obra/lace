// ABOUTME: Test file for TaskUpdateToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with detailed change summary

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskUpdateToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/TaskUpdateToolRenderer.js';
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

describe('TaskUpdateToolRenderer', () => {
  let MockProvider: React.ComponentType<{ children: React.ReactNode }>;

  beforeEach(() => {
    MockProvider = createMockProvider();
  });

  const mockSuccessResult = {
    content: [
      {
        type: 'text' as const,
        text: 'Updated task "Create sample bug fix task"',
      },
    ],
    isError: false,
    id: 'test-call-id',
  };

  const mockSuccessItem: ToolRendererProps['item'] = {
    type: 'tool_execution',
    call: {
      id: 'test-call-id',
      name: 'task_update',
      arguments: {
        taskId: 'task_20250705_wpd92m',
        status: 'in_progress',
        priority: 'high',
        description: 'Updated task description',
      },
    },
    result: mockSuccessResult,
    timestamp: new Date('2025-07-05T16:06:43.912Z'),
    callId: 'test-call-id',
  };

  it('should render task update with multiple changes', () => {
    const { lastFrame } = render(
      <MockProvider>
        <TaskUpdateToolRenderer item={mockSuccessItem} />
      </MockProvider>
    );

    const output = lastFrame();

    // Should show success status
    expect(output).toContain('✔  task_update:');
    expect(output).toContain('Updated task "Create sample bug fix task"');

    // Should show changes
    expect(output).toContain('• Status changed: pending → in_progress');
    expect(output).toContain('• Priority changed: medium → high');
    expect(output).toContain('• Description updated');
  });

  it('should render task update with single status change', () => {
    const singleChangeItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      call: {
        ...mockSuccessItem.call,
        arguments: {
          taskId: 'task_20250705_wpd92m',
          status: 'completed',
        },
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskUpdateToolRenderer item={singleChangeItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✔  task_update:');
    expect(output).toContain('Updated task "Create sample bug fix task"');
    expect(output).toContain('• Status changed: pending → completed');
    // Should not show other changes
    expect(output).not.toContain('Priority changed');
    expect(output).not.toContain('Description updated');
  });

  it('should render task update with assignee change', () => {
    const assigneeChangeItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      call: {
        ...mockSuccessItem.call,
        arguments: {
          taskId: 'task_20250705_wpd92m',
          assignTo: 'new:anthropic/claude-3-5-sonnet',
        },
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskUpdateToolRenderer item={assigneeChangeItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('• Assigned to: new:anthropic/claude-3-5-sonnet');
  });

  it('should render task update with prompt change', () => {
    const promptChangeItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      call: {
        ...mockSuccessItem.call,
        arguments: {
          taskId: 'task_20250705_wpd92m',
          prompt: 'New updated prompt for the task',
        },
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskUpdateToolRenderer item={promptChangeItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('• Prompt updated');
  });

  it('should render error state', () => {
    const errorItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: 'Task not found: task_invalid_id',
          },
        ],
        isError: true,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskUpdateToolRenderer item={errorItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✘ task_update:');
    expect(output).toContain('Task not found: task_invalid_id');
  });

  it('should render pending state', () => {
    const pendingItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: undefined, // No result means still running
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskUpdateToolRenderer item={pendingItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('⧖ task_update:');
    expect(output).toContain('Updating task task_20250705_wpd92m...');
  });
});
