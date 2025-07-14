// ABOUTME: Tests for EventDisplay component to ensure proper rendering of different event types
// ABOUTME: Validates that each event type maps to correct display component

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { EventDisplay } from '../EventDisplay.js';
import { ThreadEvent } from '../../../../../threads/types.js';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';
import { UI_SYMBOLS } from '../../../theme.js';
import { TimelineItemProvider } from '../contexts/TimelineItemContext.js';
import { TimelineExpansionProvider } from '../hooks/useTimelineExpansionToggle.js';

// Mock expansion hook
vi.mock('../hooks/useTimelineExpansionToggle.js', () => ({
  useTimelineItemExpansion: () => ({
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
  }),
  TimelineExpansionProvider: ({ children }: any) => children,
}));

// Helper to render with required providers
function renderWithProviders(component: React.ReactElement) {
  return render(
    <TimelineExpansionProvider>
      <TimelineItemProvider isSelected={false} onToggle={() => {}}>
        {component}
      </TimelineItemProvider>
    </TimelineExpansionProvider>
  );
}

describe('EventDisplay', () => {
  it('should render USER_MESSAGE events', () => {
    const event: ThreadEvent = {
      id: 'evt-1',
      threadId: 'thread-1',
      type: 'USER_MESSAGE',
      timestamp: new Date(),
      data: 'Hello, world!',
    };

    const { lastFrame } = renderWithProviders(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('"Hello, world!"');
  });

  it('should render AGENT_MESSAGE events', () => {
    const event: ThreadEvent = {
      id: 'evt-2',
      threadId: 'thread-1',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: 'Hello there!',
    };

    const { lastFrame } = renderWithProviders(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('Hello there!');
  });

  it('should render TOOL_CALL events', () => {
    const toolCallData: ToolCall = {
      id: 'call-123',
      name: 'bash',
      arguments: { command: 'ls -la' },
    };

    const event: ThreadEvent = {
      id: 'evt-3',
      threadId: 'thread-1',
      type: 'TOOL_CALL',
      timestamp: new Date(),
      data: toolCallData,
    };

    const { lastFrame } = renderWithProviders(<EventDisplay event={event} />);
    expect(lastFrame()).toContain(UI_SYMBOLS.TOOL);
    expect(lastFrame()).toContain('bash');
    expect(lastFrame()).toContain('#ll-123'); // Last 6 chars of call-123
  });

  it('should render TOOL_RESULT events', () => {
    const toolResultData: ToolResult = {
      id: 'call-123',
      content: [{ type: 'text', text: 'File listing complete' }],
      isError: false,
    };

    const event: ThreadEvent = {
      id: 'evt-4',
      threadId: 'thread-1',
      type: 'TOOL_RESULT',
      timestamp: new Date(),
      data: toolResultData,
    };

    const { lastFrame } = renderWithProviders(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('Tool Result');
    expect(lastFrame()).toContain('File listing complete');
  });

  it('should render LOCAL_SYSTEM_MESSAGE events', () => {
    const event: ThreadEvent = {
      id: 'evt-5',
      threadId: 'thread-1',
      type: 'LOCAL_SYSTEM_MESSAGE',
      timestamp: new Date(),
      data: 'System notification',
    };

    const { lastFrame } = renderWithProviders(<EventDisplay event={event} />);
    expect(lastFrame()).toContain(UI_SYMBOLS.INFO + ' System');
    expect(lastFrame()).toContain('System notification');
  });

  it('should handle streaming events', () => {
    const event: ThreadEvent = {
      id: 'evt-6',
      threadId: 'thread-1',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: 'Streaming response...',
    };

    const { lastFrame } = renderWithProviders(<EventDisplay event={event} isStreaming={true} />);
    expect(lastFrame()).toContain('thinking...');
  });

  it('should render SYSTEM_PROMPT events', () => {
    const event: ThreadEvent = {
      id: 'evt-7',
      threadId: 'thread-1',
      type: 'SYSTEM_PROMPT',
      timestamp: new Date(),
      data: 'You are a helpful AI assistant.',
    };

    const { lastFrame } = renderWithProviders(<EventDisplay event={event} />);
    expect(lastFrame()).toContain(`${UI_SYMBOLS.TOOL} System Prompt`);
    // The toggle hint only appears when isSelected={true}
  });

  it('should render USER_SYSTEM_PROMPT events', () => {
    const event: ThreadEvent = {
      id: 'evt-8',
      threadId: 'thread-1',
      type: 'USER_SYSTEM_PROMPT',
      timestamp: new Date(),
      data: 'Always be concise and helpful.',
    };

    const { lastFrame } = renderWithProviders(<EventDisplay event={event} />);
    expect(lastFrame()).toContain(`${UI_SYMBOLS.USER} User Instructions`);
    // The toggle hint only appears when isSelected={true}
  });
});
