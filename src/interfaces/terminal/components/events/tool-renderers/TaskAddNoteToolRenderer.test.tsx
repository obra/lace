// ABOUTME: Test file for TaskAddNoteToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with note preview

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskAddNoteToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/TaskAddNoteToolRenderer.js';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext.js';
import { ToolRendererProps } from '~/interfaces/terminal/components/events/tool-renderers/components/shared.js';

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

describe('TaskAddNoteToolRenderer', () => {
  let MockProvider: React.ComponentType<{ children: React.ReactNode }>;

  beforeEach(() => {
    MockProvider = createMockProvider();
  });

  const mockSuccessResult = {
    content: [
      {
        type: 'text' as const,
        text: 'Added note to task task_20250705_wpd92m',
      },
    ],
    isError: false,
    id: 'test-call-id',
  };

  const mockSuccessItem: ToolRendererProps['item'] = {
    type: 'tool_execution',
    call: {
      id: 'test-call-id',
      name: 'task_add_note',
      arguments: {
        taskId: 'task_20250705_wpd92m',
        note: 'Started investigation - checking current timeout values and configuration',
      },
    },
    result: mockSuccessResult,
    timestamp: new Date('2025-07-05T16:06:43.912Z'),
    callId: 'test-call-id',
  };

  it('should render note addition with preview', () => {
    const { lastFrame } = render(
      <MockProvider>
        <TaskAddNoteToolRenderer item={mockSuccessItem} />
      </MockProvider>
    );

    const output = lastFrame();

    // Should show success status
    expect(output).toContain('✔  task_add_note:');
    expect(output).toContain('Added note to task_20250705_wpd92m');

    // Should show note preview
    expect(output).toContain(
      '💬 "Started investigation - checking current timeout values and configuration"'
    );
  });

  it('should render note addition with long note truncation', () => {
    const longNoteItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      call: {
        ...mockSuccessItem.call,
        arguments: {
          taskId: 'task_20250705_wpd92m',
          note: 'This is a very long note that should be truncated because it exceeds the maximum length allowed for display in the compact view of the note renderer which is designed to keep the interface clean',
        },
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskAddNoteToolRenderer item={longNoteItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('💬');
    // Should not contain the full text
    expect(output).not.toContain('clean"');
  });

  it('should render note with special characters', () => {
    const specialCharsItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      call: {
        ...mockSuccessItem.call,
        arguments: {
          taskId: 'task_20250705_wpd92m',
          note: 'Found issue: authentication fails with 401 error\nNext step: check credentials',
        },
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskAddNoteToolRenderer item={specialCharsItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain(
      '💬 "Found issue: authentication fails with 401 error\\nNext step: check credentials"'
    );
  });

  it('should render error state', () => {
    const errorItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: {
        content: [
          {
            type: 'text' as const,
            text: 'Failed to add note: Task not found',
          },
        ],
        isError: true,
        id: 'test-call-id',
      },
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskAddNoteToolRenderer item={errorItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('✘ task_add_note:');
    expect(output).toContain('Failed to add note: Task not found');
  });

  it('should render pending state', () => {
    const pendingItem: ToolRendererProps['item'] = {
      ...mockSuccessItem,
      result: undefined, // No result means still running
    };

    const { lastFrame } = render(
      <MockProvider>
        <TaskAddNoteToolRenderer item={pendingItem} />
      </MockProvider>
    );

    const output = lastFrame();

    expect(output).toContain('⧖ task_add_note:');
    expect(output).toContain('Adding note to task_20250705_wpd92m...');
  });
});
