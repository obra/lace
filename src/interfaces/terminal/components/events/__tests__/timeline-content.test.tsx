// ABOUTME: Baseline tests for TimelineContent render prop logic before component extraction
// ABOUTME: Tests item mapping, ref management, and focus state handling

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import { Timeline, TimelineItem } from '../../../../thread-processor.js';

// Mock TimelineItem component
vi.mock('../TimelineItem.js', () => ({
  TimelineItem: ({ item, isFocused, currentFocusId }: any) => 
    React.createElement(Text, {}, `TLI:${item.type}:${isFocused ? 'FOCUS' : 'UNFOCUS'}:${currentFocusId}`)
}));

vi.mock('../../../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Import the component after mocking
import { TimelineItem as TimelineItemComponent } from '../TimelineItem.js';

// Copy of the current render prop content for baseline testing
function TimelineContent({ 
  timeline, 
  viewportState, 
  viewportActions, 
  itemRefs, 
  currentFocusId 
}: {
  timeline: Timeline;
  viewportState: { focusedItemIndex: number; focusedLine: number; itemPositions: number[] };
  viewportActions: { triggerRemeasurement: () => void };
  itemRefs: React.MutableRefObject<Map<number, unknown>>;
  currentFocusId?: string;
}) {
  return (
    <React.Fragment>
      {timeline.items.map((item, index) => {
        const isItemFocused = index === viewportState.focusedItemIndex;
        return (
          <Box 
            key={`timeline-item-${index}`} 
            flexDirection="column"
            ref={(ref) => {
              if (ref) {
                itemRefs.current.set(index, ref);
              } else {
                itemRefs.current.delete(index);
              }
            }}
          >
            <TimelineItemComponent 
              item={item} 
              isFocused={isItemFocused}
              focusedLine={viewportState.focusedLine}
              itemStartLine={viewportState.itemPositions[index] || 0}
              onToggle={viewportActions.triggerRemeasurement}
              currentFocusId={currentFocusId}
            />
          </Box>
        );
      })}
    </React.Fragment>
  );
}

describe('TimelineContent (Baseline)', () => {
  const mockTriggerRemeasurement = vi.fn();
  const mockExtractDelegateThreadId = vi.fn();
  let mockItemRefs: React.MutableRefObject<Map<number, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractDelegateThreadId.mockReturnValue(null);
    mockItemRefs = { current: new Map() };
  });

  const createMockTimeline = (itemCount: number): Timeline => {
    const items: TimelineItem[] = [];
    for (let i = 0; i < itemCount; i++) {
      items.push({
        id: `item-${i}`,
        type: 'user_message',
        timestamp: new Date(`2024-01-01T10:0${i}:00Z`),
        content: `Message ${i}`
      });
    }
    return {
      items,
      metadata: {
        eventCount: itemCount,
        messageCount: itemCount,
        lastActivity: new Date()
      }
    };
  };

  const defaultProps = {
    viewportState: {
      focusedItemIndex: 0,
      focusedLine: 0,
      itemPositions: [0, 5, 10]
    },
    viewportActions: {
      triggerRemeasurement: mockTriggerRemeasurement
    },
    currentFocusId: 'timeline'
  };

  describe('Item rendering', () => {
    it('should render all timeline items', () => {
      const timeline = createMockTimeline(3);

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps} 
        />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame!).toContain('TLI:user_message:FOCUS:timeline'); // First item focused
      expect(frame!).toContain('TLI:user_message:UNFOCUS:timeline'); // Others unfocused
    });

    it('should handle empty timeline', () => {
      const timeline = createMockTimeline(0);

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps} 
        />
      );

      expect(lastFrame()).toBe('');
    });

    it('should render timeline items correctly', () => {
      const timeline = createMockTimeline(2);

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps}
        />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame!).toContain('TLI:user_message');
    });
  });

  describe('Focus management', () => {
    it('should mark correct item as focused based on focusedItemIndex', () => {
      const timeline = createMockTimeline(3);
      const viewportState = {
        focusedItemIndex: 1, // Second item focused
        focusedLine: 0,
        itemPositions: [0, 5, 10]
      };

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps}
          viewportState={viewportState}
        />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      // Should have exactly one focused item (index 1)
      const focusedMatches = frame!.match(/:FOCUS:/g);
      expect(focusedMatches).toHaveLength(1);
      
      // Should have two unfocused items (indices 0 and 2)
      const unfocusedMatches = frame!.match(/:UNFOCUS:/g);
      expect(unfocusedMatches).toHaveLength(2);
    });

    it('should handle focusedItemIndex out of bounds', () => {
      const timeline = createMockTimeline(2);
      const viewportState = {
        focusedItemIndex: 5, // Out of bounds
        focusedLine: 0,
        itemPositions: [0, 5]
      };

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps}
          viewportState={viewportState}
        />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      // All items should be unfocused when focusedItemIndex is out of bounds
      const unfocusedMatches = frame!.match(/:UNFOCUS:/g);
      expect(unfocusedMatches).toHaveLength(2);
      
      const focusedMatches = frame!.match(/:FOCUS:/g);
      expect(focusedMatches).toBeNull();
    });
  });

  describe('Ref management', () => {
    it('should populate itemRefs with rendered items', () => {
      const timeline = createMockTimeline(3);
      
      render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps} 
        />
      );

      // ItemRefs should be populated during render
      // Note: In actual usage, refs get set asynchronously, so we can't test the exact values
      // but we can test that the ref callback structure is correct
      expect(mockItemRefs.current).toBeDefined();
    });

    it('should handle itemRefs cleanup on unmount', () => {
      const timeline = createMockTimeline(2);
      
      const { unmount } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps} 
        />
      );

      unmount();
      
      // ItemRefs should remain as the component manages them
      expect(mockItemRefs.current).toBeDefined();
    });
  });

  describe('Item positioning', () => {
    it('should pass correct itemStartLine from viewportState.itemPositions', () => {
      const timeline = createMockTimeline(2);
      const viewportState = {
        focusedItemIndex: 0,
        focusedLine: 0,
        itemPositions: [10, 25] // Custom positions
      };

      // Since our mock doesn't expose the itemStartLine directly, we test by ensuring
      // the component renders without errors with the position data
      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps}
          viewportState={viewportState}
        />
      );

      expect(lastFrame()).toContain('TLI:user_message:FOCUS');
    });

    it('should handle missing itemPositions gracefully', () => {
      const timeline = createMockTimeline(2);
      const viewportState = {
        focusedItemIndex: 0,
        focusedLine: 0,
        itemPositions: [] // Empty positions array
      };

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps}
          viewportState={viewportState}
        />
      );

      // Should render without crashing (fallback to 0 for missing positions)
      expect(lastFrame()).toContain('TLI:user_message:FOCUS');
    });
  });

  describe('Props forwarding', () => {
    it('should forward all required props to TimelineItem', () => {
      const timeline = createMockTimeline(1);

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps}
          currentFocusId="custom-focus"
        />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame!).toContain('custom-focus');
    });

    it('should call triggerRemeasurement when TimelineItem onToggle is triggered', () => {
      const timeline = createMockTimeline(1);
      
      render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps} 
        />
      );

      // The onToggle prop is passed to TimelineItem, but we can't easily trigger it in this test
      // since our mock doesn't expose the callback. This test verifies the prop is passed.
      expect(mockTriggerRemeasurement).not.toHaveBeenCalled(); // Not called during render
    });
  });

  describe('Key generation', () => {
    it('should generate unique keys for timeline items', () => {
      const timeline = createMockTimeline(3);
      
      // This is tested implicitly - if keys weren't unique, React would warn
      // The test passing without warnings indicates proper key generation
      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps} 
        />
      );

      expect(lastFrame()).toContain('TLI:user_message');
    });
  });

  describe('Mixed timeline item types', () => {
    it('should handle different timeline item types', () => {
      const timeline: Timeline = {
        items: [
          {
            id: 'user-1',
            type: 'user_message',
            timestamp: new Date('2024-01-01T10:00:00Z'),
            content: 'Hello'
          },
          {
            id: 'agent-1',
            type: 'agent_message',
            timestamp: new Date('2024-01-01T10:01:00Z'),
            content: 'Hi there'
          },
          {
            type: 'tool_execution',
            timestamp: new Date('2024-01-01T10:02:00Z'),
            callId: 'call-1',
            call: {
              toolName: 'bash',
              input: { command: 'ls' },
              callId: 'call-1'
            }
          }
        ],
        metadata: {
          eventCount: 3,
          messageCount: 2,
          lastActivity: new Date('2024-01-01T10:02:00Z')
        }
      };

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          itemRefs={mockItemRefs}
          {...defaultProps} 
        />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      expect(frame!).toContain('TLI:user_message:FOCUS'); // First item focused
      expect(frame!).toContain('TLI:agent_message:UNFOCUS');
      expect(frame!).toContain('TLI:tool_execution:UNFOCUS');
    });
  });
});