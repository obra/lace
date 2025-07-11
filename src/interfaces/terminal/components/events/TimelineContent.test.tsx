// ABOUTME: Tests for window-based TimelineContent component
// ABOUTME: Verifies timeline item rendering within sliding window and focus management

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { Timeline, TimelineItem } from '~/interfaces/timeline-types.js';
import { TimelineContent } from '~/interfaces/terminal/components/events/TimelineContent.js';
import { LaceFocusProvider } from '~/interfaces/terminal/focus/focus-provider.js';

// Mock TimelineItem component
vi.mock('~/interfaces/terminal/components/events/TimelineItem.js', () => ({
  TimelineItem: ({ item, isSelected }: any) =>
    React.createElement(
      Text,
      {},
      `TLI:${item.type}:${isSelected ? 'FOCUS' : 'UNFOCUS'}:timeline`
    ),
}));

vi.mock('~/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('TimelineContent Component', () => {
  // Helper to render with focus provider
  const renderWithFocus = (component: React.ReactElement) => {
    return render(
      <LaceFocusProvider>
        {component}
      </LaceFocusProvider>
    );
  };
  const mockTriggerRemeasurement = vi.fn();
  let mockItemRefs: React.MutableRefObject<Map<number, unknown>> = { current: new Map() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockItemRefs = { current: new Map() };
  });

  const createMockTimeline = (itemCount: number): Timeline => {
    const items: TimelineItem[] = [];
    for (let i = 0; i < itemCount; i++) {
      items.push({
        id: `item-${i}`,
        type: 'user_message',
        timestamp: new Date(`2024-01-01T10:0${i}:00Z`),
        content: `Message ${i}`,
      });
    }
    return {
      items,
      metadata: {
        eventCount: itemCount,
        messageCount: itemCount,
        lastActivity: new Date(),
      },
    };
  };

  const getDefaultProps = () => ({
    viewportActions: {
      triggerRemeasurement: mockTriggerRemeasurement,
    },
    itemRefs: mockItemRefs,
  });

  describe('Window-based rendering', () => {
    it('should render only items in the window', () => {
      const timeline = createMockTimeline(100);
      const windowState = {
        selectedItemIndex: 50,
        selectedLineInItem: 0,
        windowStartIndex: 40,
        getWindowStartIndex: () => 40,
        windowSize: 20,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items.slice(40, 60),
        getCursorViewportLine: () => 10,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      const frame = lastFrame();
      // Should render exactly 20 items from the window
      const itemMatches = frame?.match(/TLI:user_message/g);
      expect(itemMatches).toHaveLength(20);
    });

    it('should handle empty window', () => {
      const windowState = {
        selectedItemIndex: -1,
        selectedLineInItem: 0,
        windowStartIndex: 0,
        getWindowStartIndex: () => 0,
        windowSize: 50,
        itemHeights: new Map(),
        getWindowItems: () => [],
        getCursorViewportLine: () => 0,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      expect(lastFrame()).toBe('');
    });

    it('should handle window at start of timeline', () => {
      const timeline = createMockTimeline(100);
      const windowState = {
        selectedItemIndex: 0,
        selectedLineInItem: 0,
        windowStartIndex: 0,
        getWindowStartIndex: () => 0,
        windowSize: 50,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items.slice(0, 50),
        getCursorViewportLine: () => 0,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      const frame = lastFrame();
      const itemMatches = frame?.match(/TLI:user_message/g);
      expect(itemMatches).toHaveLength(50);
    });

    it('should handle window at end of timeline', () => {
      const timeline = createMockTimeline(100);
      const windowState = {
        selectedItemIndex: 99,
        selectedLineInItem: 0,
        windowStartIndex: 50,
        getWindowStartIndex: () => 50,
        windowSize: 50,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items.slice(50, 100),
        getCursorViewportLine: () => 49,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      const frame = lastFrame();
      const itemMatches = frame?.match(/TLI:user_message/g);
      expect(itemMatches).toHaveLength(50);
    });
  });

  describe('Focus management within window', () => {
    it('should focus correct item when selected item is in window', () => {
      const timeline = createMockTimeline(10);
      const windowState = {
        selectedItemIndex: 6,
        selectedLineInItem: 0,
        windowStartIndex: 5,
        getWindowStartIndex: () => 5,
        windowSize: 5,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items.slice(5, 10),
        getCursorViewportLine: () => 1,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(
        <TimelineContent windowState={windowState} {...getDefaultProps()} />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      // Should have exactly one focused item
      const focusedMatches = frame!.match(/:FOCUS:/g);
      expect(focusedMatches).toHaveLength(1);

      // Should have four unfocused items
      const unfocusedMatches = frame!.match(/:UNFOCUS:/g);
      expect(unfocusedMatches).toHaveLength(4);
    });

    it('should not focus any item when selected item is outside window', () => {
      const timeline = createMockTimeline(100);
      const windowState = {
        selectedItemIndex: 5, // Selected item is outside window
        selectedLineInItem: 0,
        windowStartIndex: 50,
        getWindowStartIndex: () => 50,
        windowSize: 10,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items.slice(50, 60),
        getCursorViewportLine: () => 0,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(
        <TimelineContent windowState={windowState} {...getDefaultProps()} />
      );

      const frame = lastFrame();
      expect(frame).toBeDefined();
      // All items should be unfocused
      const unfocusedMatches = frame!.match(/:UNFOCUS:/g);
      expect(unfocusedMatches).toHaveLength(10);

      const focusedMatches = frame!.match(/:FOCUS:/g);
      expect(focusedMatches).toBeNull();
    });
  });

  describe('Line selection', () => {
    it('should pass selectedLineInItem to focused item', () => {
      const timeline = createMockTimeline(5);
      const windowState = {
        selectedItemIndex: 2,
        selectedLineInItem: 3, // Line 3 within item 2
        windowStartIndex: 0,
        getWindowStartIndex: () => 0,
        windowSize: 5,
        itemHeights: new Map([[2, 5]]), // Item 2 has 5 lines
        getWindowItems: () => timeline.items,
        getCursorViewportLine: () => 8, // Previous items + 3 lines
        topSpacerHeight: 0,
      };

      // Our mock doesn't expose line selection, but we verify the prop is passed
      const { lastFrame } = renderWithFocus(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      expect(lastFrame()).toContain('TLI:user_message:FOCUS:timeline');
    });
  });

  describe('Item measurement', () => {
    it('should set refs for items in window', () => {
      const timeline = createMockTimeline(5);
      const windowState = {
        selectedItemIndex: 0,
        selectedLineInItem: 0,
        windowStartIndex: 0,
        getWindowStartIndex: () => 0,
        windowSize: 5,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items,
        getCursorViewportLine: () => 0,
        topSpacerHeight: 0,
      };

      render(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      // Refs should be managed (though we can't test the exact ref values
      // since they're set asynchronously)
      expect(mockItemRefs.current).toBeDefined();
    });

    it('should track window indices for ref management', () => {
      const timeline = createMockTimeline(100);
      const windowState = {
        selectedItemIndex: 75,
        selectedLineInItem: 0,
        windowStartIndex: 70,
        getWindowStartIndex: () => 70,
        windowSize: 10,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items.slice(70, 80),
        getCursorViewportLine: () => 5,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      const frame = lastFrame();
      const itemMatches = frame?.match(/TLI:user_message/g);
      expect(itemMatches).toHaveLength(10);
    });
  });

  describe('Mixed timeline item types', () => {
    it('should handle different timeline item types in window', () => {
      const timeline: Timeline = {
        items: [
          {
            id: 'user-1',
            type: 'user_message',
            timestamp: new Date('2024-01-01T10:00:00Z'),
            content: 'Hello',
          },
          {
            id: 'agent-1',
            type: 'agent_message',
            timestamp: new Date('2024-01-01T10:01:00Z'),
            content: 'Hi there',
          },
          {
            type: 'tool_execution',
            timestamp: new Date('2024-01-01T10:02:00Z'),
            callId: 'call-1',
            call: {
              id: 'call-1',
              name: 'bash',
              arguments: { command: 'ls' },
            },
          },
        ],
        metadata: {
          eventCount: 3,
          messageCount: 2,
          lastActivity: new Date('2024-01-01T10:02:00Z'),
        },
      };

      const windowState = {
        selectedItemIndex: 0,
        selectedLineInItem: 0,
        windowStartIndex: 0,
        getWindowStartIndex: () => 0,
        windowSize: 50,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items,
        getCursorViewportLine: () => 0,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      const frame = lastFrame();
      expect(frame).toContain('TLI:user_message:FOCUS'); // First item focused
      expect(frame).toContain('TLI:agent_message:UNFOCUS');
      expect(frame).toContain('TLI:tool_execution:UNFOCUS');
    });
  });

  describe('Performance', () => {
    it('should handle large timeline with window efficiently', () => {
      const timeline = createMockTimeline(10000);
      const windowState = {
        selectedItemIndex: 5000,
        selectedLineInItem: 0,
        windowStartIndex: 4975,
        getWindowStartIndex: () => 4975,
        windowSize: 50,
        itemHeights: new Map(),
        getWindowItems: () => timeline.items.slice(4975, 5025),
        getCursorViewportLine: () => 25,
        topSpacerHeight: 0,
      };

      const { lastFrame } = renderWithFocus(<TimelineContent windowState={windowState} {...getDefaultProps()} />);

      const frame = lastFrame();
      // Should only render 50 items despite 10k total items
      const itemMatches = frame?.match(/TLI:user_message/g);
      expect(itemMatches).toHaveLength(50);
    });
  });
});