// ABOUTME: Test file for TaskCompleteToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with simple success confirmation

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskCompleteToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/TaskCompleteToolRenderer';
import { TimelineExpansionProvider } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';
import { ToolRendererProps } from '~/interfaces/terminal/components/events/tool-renderers/components/shared';

// No mocks needed - test real component behavior with proper providers

const createMockProvider = (isSelected = false) => {
  return ({ children }: { children: React.ReactNode }) => (
    <TimelineExpansionProvider>
      <TimelineItemProvider isSelected={isSelected}>{children}</TimelineItemProvider>
    </TimelineExpansionProvider>
  );
};

describe('TaskCompleteToolRenderer', () => {
  let MockProvider: React.ComponentType<{ children: React.ReactNode }>;

  beforeEach(() => {
    MockProvider = createMockProvider();
  });

  const mockSuccessResult = {
    content: [
      {
        type: 'text' as const,
        text: 'Completed task task_20250705_b9qers',
      },
    ],
    isError: false,
    id: 'test-call-id',
  };

  const mockSuccessItem: ToolRendererProps['item'] = {
    type: 'tool_execution',
    call: {
      id: 'test-call-id',
      name: 'task_complete',
      arguments: {
        id: 'task_20250705_b9qers',
      },
    },
    result: mockSuccessResult,
    timestamp: new Date('2025-07-05T16:06:43.912Z'),
    callId: 'test-call-id',
  };

  it('should render task completion success', () => {
    const { lastFrame } = render(
      <MockProvider>
        <TaskCompleteToolRenderer item={mockSuccessItem} />
      </MockProvider>
    );

    const output = lastFrame();

    // Should show success status
    expect(output).toContain('✔  task_complete:');
    expect(output).toContain('task_20250705_b9qers completed');
  });

  it('should render task completion with different task ID format', () => {
    const differentIdItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      call: {
        ...mockSuccessItem.call,
        arguments: {
          id: 'task_20250705_xyz789',
        },
      },
      result: {
        content: [
          {
            type: 'text' as const,
            text: 'Completed task task_20250705_xyz789',
          },
        ],
        isError: false,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskCompleteToolRenderer item={differentIdItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('task_20250705_xyz789 completed');
  });

  it('should render error for already completed task', () => {
    const alreadyCompletedItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: 'Task is already completed',
          },
        ],
        isError: true,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskCompleteToolRenderer item={alreadyCompletedItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✘ task_complete:');
    expect(output).toContain('Task is already completed');
  });

  it('should render error for non-existent task', () => {
    const nonExistentItem: ToolRendererProps['item'] = {
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
        <TaskCompleteToolRenderer item={nonExistentItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✘ task_complete:');
    expect(output).toContain('Task not found: task_invalid_id');
  });

  it('should render pending state', () => {
    const pendingItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: undefined, // No result means still running
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskCompleteToolRenderer item={pendingItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('⧖ task_complete:');
    expect(output).toContain('Completing task task_20250705_b9qers...');
  });
});
