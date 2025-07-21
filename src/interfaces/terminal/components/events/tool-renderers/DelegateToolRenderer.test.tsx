// ABOUTME: Test file for DelegateToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with delegation thread management

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { DelegateToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/DelegateToolRenderer';
import { TimelineExpansionProvider } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';
import { LaceFocusProvider } from '~/interfaces/terminal/focus/focus-provider';

// Mock the logger to avoid console output
vi.mock('../../../../../utils/logger.js', () => ({
  logger: {
    debug: () => {
      // Mock logger debug method
    },
    error: () => {
      // Mock logger error method
    },
    warn: () => {
      // Mock logger warn method
    },
  },
}));

// Mock useInput to avoid document global issues
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

// No mocks needed for expansion hooks - test real component behavior with proper providers

const mockDelegateCall = {
  id: 'call-123',
  name: 'delegate',
  arguments: {
    task: 'Help me write unit tests',
  },
};

const mockSuccessResult = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        threadId: 'thread-456',
        status: 'completed',
        summary: 'Successfully created unit tests for the project',
        totalTokens: 1500,
      }),
    },
  ],
  isError: false,
};

const mockActiveResult = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        threadId: 'thread-789',
        status: 'active',
        summary: 'Working on test creation...',
      }),
    },
  ],
  isError: false,
};

const mockErrorResult = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        status: 'error',
        error: 'Failed to create delegation thread',
      }),
    },
  ],
  isError: true,
};

function renderWithProviders(component: React.ReactElement) {
  return render(
    <LaceFocusProvider>
      <TimelineExpansionProvider>
        <TimelineItemProvider
          isSelected={false}
          onToggle={() => {
            // Mock onToggle for test - no action needed
          }}
        >
          {component}
        </TimelineItemProvider>
      </TimelineExpansionProvider>
    </LaceFocusProvider>
  );
}

describe('DelegateToolRenderer', () => {
  it('should return TimelineEntry with task and delegation info in header', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockDelegateCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);

    // Should show tool name, task, and delegation indicator in header
    expect(lastFrame()).toContain('delegate: "Help me write unit tests" [DELEGATE]');
    expect(lastFrame()).toContain('Thread: thread-456');
  });

  it('should handle active delegation status', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockDelegateCall,
      result: mockActiveResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);

    expect(lastFrame()).toContain('delegate: "Help me write unit tests" [DELEGATE]');
    expect(lastFrame()).toContain('Thread: thread-789');
    expect(lastFrame()).toContain('Working on test creation...');
  });

  it('should handle error results', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockDelegateCall,
      result: mockErrorResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);

    expect(lastFrame()).toContain('delegate: "Help me write unit tests" [DELEGATE]');
    expect(lastFrame()).toContain('Failed to create delegation thread');
  });

  it('should show pending status for running tools', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockDelegateCall,
      result: undefined,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);

    expect(lastFrame()).toContain('delegate: "Help me write unit tests" [DELEGATE]');
    // Should not show thread info when still running
    expect(lastFrame()).not.toContain('Thread:');
  });

  it('should handle task from prompt argument', () => {
    const call = {
      id: 'call-123',
      name: 'delegate',
      arguments: {
        prompt: 'Refactor this code please',
      },
    };

    const item = {
      type: 'tool_execution' as const,
      call,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<DelegateToolRenderer item={item} />);

    expect(lastFrame()).toContain('delegate: "Refactor this code please" [DELEGATE]');
  });
});
