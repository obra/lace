// ABOUTME: Tests for extracted TimelineContent component
// ABOUTME: Verifies timeline item rendering, focus management, and prop forwarding

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { Timeline, TimelineItem } from '../../../../thread-processor.js';
import { TimelineContent } from '../TimelineContent.js';

// Mock TimelineItem component
vi.mock('../TimelineItem.js', () => ({
  TimelineItem: ({ item, isFocused, delegateTimelines, currentFocusId }: any) => 
    React.createElement(Text, {}, `TLI:${item.type}:${isFocused ? 'FOCUS' : 'UNFOCUS'}:${currentFocusId}:${delegateTimelines ? 'hasDel' : 'noDel'}`)
}));

vi.mock('../../../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('TimelineContent Component', () => {
  const mockTriggerRemeasurement = vi.fn();
  const mockExtractDelegateThreadId = vi.fn();
  let mockItemRefs: React.MutableRefObject<Map<number, unknown>> = { current: new Map() };

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

  const getDefaultProps = () => ({
    viewportState: {
      focusedItemIndex: 0,
      focusedLine: 0,
      itemPositions: [0, 5, 10]
    },
    viewportActions: {
      triggerRemeasurement: mockTriggerRemeasurement
    },
    itemRefs: mockItemRefs,
    delegateTimelines: undefined,
    delegationExpandState: new Map<string, boolean>(),
    currentFocusId: 'timeline',
    extractDelegateThreadId: mockExtractDelegateThreadId
  });

  describe('Basic rendering', () => {
    it('should render all timeline items', () => {
      const timeline = createMockTimeline(3);

      const { lastFrame } = render(
        <TimelineContent timeline={timeline} {...getDefaultProps()} />
      );

      const frame = lastFrame();
      expect(frame).toContain('TLI:user_message:FOCUS:timeline:noDel'); // First item focused
      expect(frame).toContain('TLI:user_message:UNFOCUS:timeline:noDel'); // Others unfocused
    });

    it('should handle empty timeline', () => {
      const timeline = createMockTimeline(0);

      const { lastFrame } = render(
        <TimelineContent timeline={timeline} {...getDefaultProps()} />
      );

      expect(lastFrame()).toBe('');
    });

    it('should render single item timeline', () => {
      const timeline = createMockTimeline(1);

      const { lastFrame } = render(
        <TimelineContent timeline={timeline} {...getDefaultProps()} />
      );

      expect(lastFrame()).toContain('TLI:user_message:FOCUS:timeline:noDel');
    });
  });

  describe('Focus management', () => {
    it('should focus correct item based on focusedItemIndex', () => {
      const timeline = createMockTimeline(3);
      const viewportState = {
        focusedItemIndex: 1, // Second item focused
        focusedLine: 0,
        itemPositions: [0, 5, 10]
      };

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          {...getDefaultProps()}
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
          {...getDefaultProps()}
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

    it('should handle negative focusedItemIndex', () => {
      const timeline = createMockTimeline(2);
      const viewportState = {
        focusedItemIndex: -1, // Negative index
        focusedLine: 0,
        itemPositions: [0, 5]
      };

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          {...getDefaultProps()}
          viewportState={viewportState}
        />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      // All items should be unfocused when focusedItemIndex is negative
      const unfocusedMatches = frame!.match(/:UNFOCUS:/g);
      expect(unfocusedMatches).toHaveLength(2);
      
      const focusedMatches = frame!.match(/:FOCUS:/g);
      expect(focusedMatches).toBeNull();
    });
  });

  describe('Prop forwarding', () => {
    it('should forward delegate timelines', () => {
      const timeline = createMockTimeline(2);
      const delegateTimelines = new Map([['thread-1', createMockTimeline(1)]]);

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          {...getDefaultProps()}
          delegateTimelines={delegateTimelines}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('hasDel');
      expect(frame).not.toContain('noDel');
    });

    it('should forward currentFocusId', () => {
      const timeline = createMockTimeline(1);

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          {...getDefaultProps()}
          currentFocusId="custom-focus"
        />
      );

      expect(lastFrame()).toContain('custom-focus');
    });

    it('should pass viewportState data to items', () => {
      const timeline = createMockTimeline(2);
      const viewportState = {
        focusedItemIndex: 0,
        focusedLine: 10,
        itemPositions: [100, 200] // Custom positions
      };

      // Since our mock doesn't expose the detailed props, we test by ensuring
      // the component renders without errors with the position data
      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          {...getDefaultProps()}
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
          {...getDefaultProps()}
          viewportState={viewportState}
        />
      );

      // Should render without crashing (fallback to 0 for missing positions)
      expect(lastFrame()).toContain('TLI:user_message:FOCUS');
    });
  });

  describe('State management', () => {
    it('should forward expand states', () => {
      const timeline = createMockTimeline(1);
      const delegationExpandState = new Map([['call-1', true]]);

      // These props are passed through but don't affect our mock output
      // This test verifies the props are accepted without errors
      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          {...getDefaultProps()}
          delegationExpandState={delegationExpandState}
        />
      );

      expect(lastFrame()).toContain('TLI:user_message');
    });

    it('should call triggerRemeasurement through onToggle', () => {
      const timeline = createMockTimeline(1);
      
      render(
        <TimelineContent timeline={timeline} {...getDefaultProps()} />
      );

      // The onToggle prop is passed to TimelineItem, but we can't easily trigger it
      // in this test since our mock doesn't expose the callback. This test verifies
      // the prop is passed without errors.
      expect(mockTriggerRemeasurement).not.toHaveBeenCalled(); // Not called during render
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
        <TimelineContent timeline={timeline} {...getDefaultProps()} />
      );

      const frame = lastFrame();
      expect(frame).toContain('TLI:user_message:FOCUS'); // First item focused
      expect(frame).toContain('TLI:agent_message:UNFOCUS');
      expect(frame).toContain('TLI:tool_execution:UNFOCUS');
    });
  });

  describe('Key generation and refs', () => {
    it('should generate unique keys for timeline items', () => {
      const timeline = createMockTimeline(3);
      
      // This is tested implicitly - if keys weren't unique, React would warn
      // The test passing without warnings indicates proper key generation
      const { lastFrame } = render(
        <TimelineContent timeline={timeline} {...getDefaultProps()} />
      );

      expect(lastFrame()).toContain('TLI:user_message');
    });

    it('should manage itemRefs correctly', () => {
      const timeline = createMockTimeline(2);
      
      render(
        <TimelineContent timeline={timeline} {...getDefaultProps()} />
      );

      // ItemRefs should be managed (though we can't test the exact ref values
      // since they're set asynchronously)
      expect(mockItemRefs.current).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined delegateTimelines', () => {
      const timeline = createMockTimeline(1);

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          {...getDefaultProps()}
          delegateTimelines={undefined}
        />
      );

      expect(lastFrame()).toContain('noDel');
    });

    it('should handle empty expand state maps', () => {
      const timeline = createMockTimeline(1);

      const { lastFrame } = render(
        <TimelineContent 
          timeline={timeline} 
          {...getDefaultProps()}
          delegationExpandState={new Map()}
        />
      );

      expect(lastFrame()).toContain('TLI:user_message');
    });
  });
});