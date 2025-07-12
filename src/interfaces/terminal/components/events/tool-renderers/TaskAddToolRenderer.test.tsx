// ABOUTME: Test file for TaskAddToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with task creation display

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskAddToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/TaskAddToolRenderer';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';
import { ToolRendererProps } from '~/interfaces/terminal/components/events/tool-renderers/components/shared';

// Mock the expansion toggle hooks
vi.mock('../hooks/useTimelineExpansionToggle.js', () => ({
  TimelineExpansionProvider: ({ children }: { children: React.ReactNode }) => children,
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

describe('TaskAddToolRenderer', () => {
  let MockProvider: React.ComponentType<{ children: React.ReactNode }>;

  beforeEach(() => {
    MockProvider = createMockProvider();
  });

  const mockSuccessResult = {
    content: [
      {
        type: 'text' as const,
        text: 'Created task task_20250705_b9qers: Test task management suite',
      },
    ],
    isError: false,
    id: 'test-call-id',
  };

  const mockSuccessItem: ToolRendererProps['item'] = {
    type: 'tool_execution',
    call: {
      id: 'test-call-id',
      name: 'task_add',
      arguments: {
        title: 'Test task management suite',
        prompt:
          'Systematically test all task management tools including add, list, update, complete, view, and add_note functions to verify they work correctly after the recent upgrade',
        description:
          'Testing the upgraded task management system to ensure all features work properly',
        priority: 'high',
        assignedTo: 'new:anthropic/claude-3-5-sonnet',
      },
    },
    result: mockSuccessResult,
    timestamp: new Date('2025-07-05T16:06:43.912Z'),
    callId: 'test-call-id',
  };

  it('should render task creation success with detailed view', () => {
    const { lastFrame } = render(
      <MockProvider>
        <TaskAddToolRenderer item={mockSuccessItem} />
      </MockProvider>
    );

    const output = lastFrame();

    // Should show success status
    expect(output).toContain('✔  task_add:');

    // Should show task creation details
    expect(output).toContain('Created task "Test task management suite"');
    expect(output).toContain('→ task_20250705_b9qers [high priority]');
    expect(output).toContain('→ assigned to: new:anthropic/claude-3-5-sonnet');
    expect(output).toContain('→ prompt:Systematically test all task management tools');
  });

  it('should render task creation success without optional fields', () => {
    const itemWithoutOptionals: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      call: {
        ...mockSuccessItem.call,
        arguments: {
          title: 'Simple task',
          prompt: 'Just a simple task with minimal fields',
          priority: 'medium',
          // No assignedTo or description
        },
      },
      result: {
        content: [
          {
            type: 'text' as const,
            text: 'Created task task_20250705_simple: Simple task',
          },
        ],
        isError: false,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskAddToolRenderer item={itemWithoutOptionals} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✔  task_add:');
    expect(output).toContain('Created task "Simple task"');
    expect(output).toContain('→ task_20250705_simple [medium priority]');
    expect(output).toContain('→ prompt: Just a simple task with minimal fields');
    // Should not show assigned to line when not provided
    expect(output).not.toContain('→ assigned to:');
  });

  it('should render error state', () => {
    const errorItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: 'Failed to create task: Invalid assignee format',
          },
        ],
        isError: true,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskAddToolRenderer item={errorItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✘ task_add:');
    expect(output).toContain('Failed to create task: Invalid assignee format');
  });

  it('should render pending state while running', () => {
    const pendingItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: undefined, // No result means still running
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskAddToolRenderer item={pendingItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('⧖ task_add:');
    expect(output).toContain('Creating task "Test task management suite"');
  });
});
