// ABOUTME: Tests for DelegationBox component loading real delegate thread data
// ABOUTME: Verifies ThreadManager integration and timeline rendering

import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelegationBox } from '../DelegationBox.js';
import { ThreadEvent } from '../../../../../threads/types.js';
import { TimelineItem } from '../../../../thread-processor.js';
import { useThreadManager, useThreadProcessor } from '../../../terminal-interface.js';
import { LaceFocusProvider } from '../../../focus/focus-provider.js';

// Mock TimelineDisplay
vi.mock('../TimelineDisplay.js', () => ({
  default: ({ timeline }: any) =>
    React.createElement(Text, {}, `[TimelineDisplay] ${timeline.items.length} items`),
}));

// Mock the hooks directly
vi.mock('../../../terminal-interface.js', () => ({
  useThreadManager: vi.fn(),
  useThreadProcessor: vi.fn(),
}));

// Create test data
function createTestToolCall(metadata: { threadId: string }): Extract<TimelineItem, { type: 'tool_execution' }> {
  return {
    type: 'tool_execution',
    call: {
      id: 'call-123',
      name: 'delegate',
      arguments: { task: 'Test task' },
    },
    result: {
      content: [{ type: 'text', text: 'Delegation complete' }],
      isError: false,
      metadata,
    },
    timestamp: new Date(),
    callId: 'call-123',
  };
}

function createTestEvents(): ThreadEvent[] {
  return [
    {
      id: 'event-1',
      type: 'USER_MESSAGE',
      threadId: 'delegate-thread-123',
      timestamp: new Date(),
      data: 'Hello from delegate',
    },
    {
      id: 'event-2',
      type: 'AGENT_MESSAGE',
      threadId: 'delegate-thread-123',
      timestamp: new Date(),
      data: 'Response from delegate',
    },
  ];
}

describe('DelegationBox', () => {
  // Helper to render with focus provider
  const renderWithFocus = (component: React.ReactElement) => {
    return render(
      <LaceFocusProvider>
        {component}
      </LaceFocusProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up mock implementations
    vi.mocked(useThreadManager).mockReturnValue({
      getEvents: vi.fn(),
    } as any);
    vi.mocked(useThreadProcessor).mockReturnValue({
      processThreads: vi.fn(),
    } as any);
  });

  it('should fetch and display delegate thread data when threadId is present', async () => {
    // Arrange
    const delegateThreadId = 'delegate-thread-123';
    const toolCall = createTestToolCall({ threadId: delegateThreadId });
    const delegateEvents = createTestEvents();
    
    const mockThreadManager = vi.mocked(useThreadManager()).getEvents;
    const mockProcessThreads = vi.mocked(useThreadProcessor()).processThreads;
    
    mockThreadManager.mockReturnValue(delegateEvents);
    mockProcessThreads.mockReturnValue({
      items: [
        { type: 'user_message', content: 'Hello from delegate', timestamp: new Date(), id: 'msg-1' },
        { type: 'agent_message', content: 'Response from delegate', timestamp: new Date(), id: 'msg-2' },
      ],
      metadata: { eventCount: 2, messageCount: 2, lastActivity: new Date() },
    });

    // Act
    const { lastFrame } = renderWithFocus(<DelegationBox toolCall={toolCall} />);

    // Assert
    expect(mockThreadManager).toHaveBeenCalledWith(delegateThreadId);
    expect(mockProcessThreads).toHaveBeenCalledWith(delegateEvents);
    expect(lastFrame()).toContain('[TimelineDisplay] 2 items');
  });

  it('should return null when no threadId in metadata', () => {
    // Arrange
    const toolCall = createTestToolCall({ threadId: '' });
    
    // Act
    const { lastFrame } = renderWithFocus(<DelegationBox toolCall={toolCall} />);

    // Assert
    expect(lastFrame()).toBe('');
    expect(vi.mocked(useThreadManager()).getEvents).not.toHaveBeenCalled();
  });

  it('should handle empty delegate thread gracefully', () => {
    // Arrange
    const delegateThreadId = 'empty-delegate-thread';
    const toolCall = createTestToolCall({ threadId: delegateThreadId });
    
    const mockThreadManager = vi.mocked(useThreadManager()).getEvents;
    const mockProcessThreads = vi.mocked(useThreadProcessor()).processThreads;
    
    mockThreadManager.mockReturnValue([]);
    mockProcessThreads.mockReturnValue({
      items: [],
      metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() },
    });

    // Act
    const { lastFrame } = renderWithFocus(<DelegationBox toolCall={toolCall} />);

    // Assert
    expect(mockThreadManager).toHaveBeenCalledWith(delegateThreadId);
    expect(lastFrame()).toContain('[TimelineDisplay] 0 items');
  });
});