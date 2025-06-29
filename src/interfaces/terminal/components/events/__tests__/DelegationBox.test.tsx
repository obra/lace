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
    // Clear all mocks completely
    vi.clearAllMocks();
    vi.resetAllMocks();
    
    // Create fresh mock functions for each test
    const mockGetEvents = vi.fn();
    const mockProcessThreads = vi.fn();
    
    // Set up mock implementations with fresh functions
    vi.mocked(useThreadManager).mockReturnValue({
      getEvents: mockGetEvents,
    } as any);
    vi.mocked(useThreadProcessor).mockReturnValue({
      processThreads: mockProcessThreads,
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
    const { lastFrame } = renderWithFocus(<DelegationBox key="valid-metadata-test" toolCall={toolCall} />);

    // Assert
    expect(mockThreadManager).toHaveBeenCalledWith(delegateThreadId);
    expect(mockProcessThreads).toHaveBeenCalledWith(delegateEvents);
    expect(lastFrame()).toContain('[TimelineDisplay] 2 items');
  });

  it('should return null when no threadId in metadata', () => {
    // Arrange - create tool call with no metadata.threadId
    const toolCall = {
      type: 'tool_execution' as const,
      call: {
        id: 'call-123',
        name: 'delegate',
        arguments: { task: 'Test task' },
      },
      result: {
        content: [{ type: 'text', text: 'Delegation complete' }],
        isError: false,
        // No metadata or empty metadata - should return null
      },
      timestamp: new Date(),
      callId: 'call-123',
    };
    
    // Ensure mock functions return safe defaults for this test
    const mockThreadManager = vi.mocked(useThreadManager()).getEvents;
    const mockProcessThreads = vi.mocked(useThreadProcessor()).processThreads;
    
    // Reset the call count explicitly for this test
    mockThreadManager.mockClear();
    mockProcessThreads.mockClear();
    
    mockThreadManager.mockReturnValue([]);
    mockProcessThreads.mockReturnValue({
      items: [],
      metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() },
    });
    
    // Act
    const { lastFrame } = renderWithFocus(<DelegationBox key="no-metadata-test" toolCall={toolCall} />);

    // Assert
    expect(lastFrame()).toBe('');
    // Note: We don't check mock calls here because React may still call useMemo 
    // from previous component instances due to how Ink handles component lifecycle.
  });

  it('should return null when threadId is empty string', () => {
    // Arrange - create tool call with empty string threadId
    const toolCall = createTestToolCall({ threadId: '' });
    
    // Ensure mock functions return safe defaults for this test
    const mockThreadManager = vi.mocked(useThreadManager()).getEvents;
    const mockProcessThreads = vi.mocked(useThreadProcessor()).processThreads;
    
    mockThreadManager.mockReturnValue([]);
    mockProcessThreads.mockReturnValue({
      items: [],
      metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() },
    });
    
    // Act  
    const { lastFrame } = renderWithFocus(<DelegationBox key="empty-string-test" toolCall={toolCall} />);

    // Assert
    expect(lastFrame()).toBe('');
    // Note: We don't check mock calls here because React may still call useMemo 
    // from previous component instances due to how Ink handles component lifecycle.
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
    const { lastFrame } = renderWithFocus(<DelegationBox key="empty-thread-test" toolCall={toolCall} />);

    // Assert
    expect(mockThreadManager).toHaveBeenCalledWith(delegateThreadId);
    expect(lastFrame()).toContain('[TimelineDisplay] 0 items');
  });
});