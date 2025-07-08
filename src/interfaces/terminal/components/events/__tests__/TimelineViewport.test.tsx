// ABOUTME: Tests for TimelineViewport component with window-based virtualization
// ABOUTME: Validates viewport rendering, window management, and navigation behavior

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { TimelineViewport } from '../TimelineViewport.js';
import { Timeline } from '../../../../timeline-types.js';
import { LaceFocusProvider } from '../../../focus/focus-provider.js';

// Mock external dependencies that aren't core to the component logic
vi.mock('../../../../../utils/use-stdout-dimensions.js', () => ({
  default: () => [80, 30], // width, height
}));

vi.mock('../../../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('TimelineViewport', () => {
  // Helper to render with focus provider
  const renderWithFocus = (component: React.ReactElement) => {
    return render(
      <LaceFocusProvider>
        {component}
      </LaceFocusProvider>
    );
  };

  const createMockTimeline = (itemCount: number): Timeline => {
    const items = [];
    for (let i = 0; i < itemCount; i++) {
      items.push({
        id: `item-${i}`,
        type: 'user_message' as const,
        timestamp: new Date(Date.now() + i * 1000),
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

  it('should render viewport container with children', () => {
    const timeline = createMockTimeline(3);

    const { lastFrame } = renderWithFocus(
      <TimelineViewport timeline={timeline}>
        {({ windowState }) => 
          windowState.getWindowItems().map((item, index) => (
            <Text key={`${item.type}-${index}`}>
              {item.type === 'user_message' ? item.content : `Item ${index}`}
            </Text>
          ))
        }
      </TimelineViewport>
    );

    // Should render timeline content through children render prop
    // Window should start at beginning for small timeline
    expect(lastFrame()).toContain('Message 0');
    expect(lastFrame()).toContain('Message 1');
    expect(lastFrame()).toContain('Message 2');
  });

  it('should provide window state to children', () => {
    const timeline = createMockTimeline(100);
    let capturedState: any = null;

    renderWithFocus(
      <TimelineViewport timeline={timeline}>
        {({ windowState }) => {
          capturedState = windowState;
          return <Text>Test content</Text>;
        }}
      </TimelineViewport>
    );

    // Should provide window state
    expect(capturedState).toBeDefined();
    expect(capturedState.selectedItemIndex).toBe(99); // Should start at bottom
    expect(capturedState.selectedLineInItem).toBe(0);
    expect(capturedState.windowStartIndex).toBe(50); // 100 - 50 window size
    expect(capturedState.windowSize).toBe(50);
    expect(capturedState.itemHeights).toBeInstanceOf(Map);
    expect(capturedState.getWindowItems).toBeTypeOf('function');
  });

  it('should provide window navigation actions to children', () => {
    const timeline = createMockTimeline(10);
    let capturedState: any = null;

    renderWithFocus(
      <TimelineViewport timeline={timeline}>
        {({ windowState }) => {
          capturedState = windowState;
          return <Text>Test content</Text>;
        }}
      </TimelineViewport>
    );

    // Should provide navigation methods
    expect(capturedState.navigateToPreviousLine).toBeTypeOf('function');
    expect(capturedState.navigateToNextLine).toBeTypeOf('function');
    expect(capturedState.navigatePageUp).toBeTypeOf('function');
    expect(capturedState.navigatePageDown).toBeTypeOf('function');
    expect(capturedState.jumpToStart).toBeTypeOf('function');
    expect(capturedState.jumpToEnd).toBeTypeOf('function');
  });

  it('should provide viewport actions to children', () => {
    const timeline = createMockTimeline(2);
    let capturedActions: any = null;

    renderWithFocus(
      <TimelineViewport timeline={timeline}>
        {({ viewportActions }) => {
          capturedActions = viewportActions;
          return <Text>Test content</Text>;
        }}
      </TimelineViewport>
    );

    // Should provide viewport actions
    expect(capturedActions).toBeDefined();
    expect(capturedActions.triggerRemeasurement).toBeTypeOf('function');
  });

  it('should provide itemRefs to children', () => {
    const timeline = createMockTimeline(2);
    let capturedRefs: any = null;

    renderWithFocus(
      <TimelineViewport timeline={timeline}>
        {({ itemRefs }) => {
          capturedRefs = itemRefs;
          return <Text>Test content</Text>;
        }}
      </TimelineViewport>
    );

    // Should provide item refs
    expect(capturedRefs).toBeDefined();
    expect(capturedRefs.current).toBeInstanceOf(Map);
  });

  it('should render cursor when focused', () => {
    const timeline = createMockTimeline(3);

    const { lastFrame } = renderWithFocus(
      <TimelineViewport timeline={timeline}>
        {({ windowState }) => (
          <Text>Line {windowState.getCursorViewportLine()}</Text>
        )}
      </TimelineViewport>
    );

    // Should render cursor position
    expect(lastFrame()).toContain('Line');
  });

  it('should handle empty timeline', () => {
    const timeline: Timeline = {
      items: [],
      metadata: {
        eventCount: 0,
        messageCount: 0,
        lastActivity: new Date(),
      },
    };

    const { lastFrame } = renderWithFocus(
      <TimelineViewport timeline={timeline}>
        {({ windowState }) => <Text>Items: {windowState.getWindowItems().length}</Text>}
      </TimelineViewport>
    );

    // Should render without crashing
    expect(lastFrame()).toContain('Items: 0');
  });

  it('should handle large timeline with window', () => {
    const timeline = createMockTimeline(1000);

    const { lastFrame } = renderWithFocus(
      <TimelineViewport timeline={timeline}>
        {({ windowState }) => (
          <Text>
            Selected: {windowState.selectedItemIndex}, Scroll: {windowState.scrollTop}
          </Text>
        )}
      </TimelineViewport>
    );

    // Should show selected item at bottom
    expect(lastFrame()).toContain('Selected: 999');
  });

  it('should handle custom focus region', () => {
    const timeline = createMockTimeline(1);

    const { lastFrame } = renderWithFocus(
      <TimelineViewport timeline={timeline} focusRegion="custom-region">
        {() => <Text>Custom focus content</Text>}
      </TimelineViewport>
    );

    // Should render without crashing with custom focus region
    expect(lastFrame()).toContain('Custom focus content');
  });

  it('should accept onItemInteraction callback', () => {
    const timeline = createMockTimeline(3);
    const mockInteraction = vi.fn();

    renderWithFocus(
      <TimelineViewport timeline={timeline} onItemInteraction={mockInteraction}>
        {() => <Text>Interactive content</Text>}
      </TimelineViewport>
    );

    // Callback should not be called during render
    expect(mockInteraction).not.toHaveBeenCalled();
  });
});