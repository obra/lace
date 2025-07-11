// ABOUTME: Test file for TaskViewToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with clean detailed task view

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskViewToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/TaskViewToolRenderer.js';
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

describe('TaskViewToolRenderer', () => {
  let MockProvider: React.ComponentType<{ children: React.ReactNode }>;

  beforeEach(() => {
    MockProvider = createMockProvider();
  });

  const mockTaskResult = {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          id: 'task_20250705_b9qers',
          title: 'Test task management suite',
          status: 'pending',
          priority: 'high',
          assignedTo: 'new:anthropic/claude-3-5-sonnet',
          description: 'Testing the upgraded task management system',
          prompt:
            'Systematically test all task management tools including add, list, update, complete, view, and add_note functions to verify they work correctly after the recent upgrade',
          notes: [
            {
              id: 'note_1',
              authorId: 'lace_20250705_2opxkw',
              timestamp: '2025-07-05T16:07:10.000Z',
              content: 'Started investigation - checking current timeout',
            },
          ],
        }),
      },
    ],
    isError: false,
    id: 'test-call-id',
  };

  const mockSuccessItem: ToolRendererProps['item'] = {
    type: 'tool_execution',
    call: {
      id: 'test-call-id',
      name: 'task_view',
      arguments: {
        taskId: 'task_20250705_b9qers',
      },
    },
    result: mockTaskResult,
    timestamp: new Date('2025-07-05T16:06:43.912Z'),
    callId: 'test-call-id',
  };

  it('should render task view with all details', () => {
    const { lastFrame } = render(
      <MockProvider>
        <TaskViewToolRenderer item={mockSuccessItem} />
      </MockProvider>
    );

    const output = lastFrame();

    // Should show success status
    expect(output).toContain('✔  task_view:');
    expect(output).toContain('task_20250705_b9qers');

    // Should show title, priority, and status
    expect(output).toContain('Test task management suite [high] ○ pending');

    // Should show description
    expect(output).toContain('Description: Testing the upgraded task management system');

    // Should show prompt
    expect(output).toContain('Prompt: Systematically test all task management tools');

    // Should show notes
    expect(output).toContain('Notes (1):');
    expect(output).toContain('• [lace_20250705_2opxkw]');
    expect(output).toContain('Started investigation - checking current timeout');
  });

  it('should render task without description', () => {
    const taskWithoutDescription: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: 'task_20250705_simple',
              title: 'Simple task',
              status: 'in_progress',
              priority: 'medium',
              prompt: 'Just a simple task prompt',
              notes: [],
            }),
          },
        ],
        isError: false,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskViewToolRenderer item={taskWithoutDescription} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('Simple task [medium] ◐ in_progress');
    expect(output).toContain('Prompt: Just a simple task prompt');
    // Should not show description section
    expect(output).not.toContain('Description:');
    // Should not show notes section when empty
    expect(output).not.toContain('Notes (0):');
  });

  it('should render task without notes', () => {
    const taskWithoutNotes: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: 'task_20250705_nonotes',
              title: 'Task without notes',
              status: 'completed',
              priority: 'low',
              description: 'A task with no notes',
              prompt: 'Complete this task',
              notes: [],
            }),
          },
        ],
        isError: false,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskViewToolRenderer item={taskWithoutNotes} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('Task without notes [low] ✓ completed');
    expect(output).toContain('Description: A task with no notes');
    expect(output).toContain('Prompt: Complete this task');
    expect(output).not.toContain('Notes');
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
        <TaskViewToolRenderer item={errorItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✘ task_view:');
    expect(output).toContain('Task not found: task_invalid_id');
  });

  it('should render pending state', () => {
    const pendingItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: undefined, // No result means still running
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskViewToolRenderer item={pendingItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('⧖ task_view:');
    expect(output).toContain('Loading task task_20250705_b9qers...');
  });
});
