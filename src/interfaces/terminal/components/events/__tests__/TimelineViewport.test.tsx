// ABOUTME: Tests for TimelineViewport component focusing on integration behavior
// ABOUTME: Validates viewport rendering and content management without mocking core dependencies

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { TimelineViewport } from '../TimelineViewport.js';
import { Timeline } from '../../../../thread-processor.js';

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

    const { lastFrame } = render(
      <TimelineViewport timeline={timeline}>
        {({ timeline: tl, viewportState, itemRefs }) =>
          tl.items.map((item, index) => (
            <Text key={`${item.type}-${index}`}>
              {item.type === 'user_message' ? item.content : `Item ${index}`}
            </Text>
          ))
        }
      </TimelineViewport>
    );

    // Should render timeline content through children render prop
    // Note: cursor overlay covers first character, so we see '>essage 0' instead of 'Message 0'
    expect(lastFrame()).toContain('essage 0');
    expect(lastFrame()).toContain('Message 1');
    expect(lastFrame()).toContain('Message 2');
  });

  it('should provide viewport state to children', () => {
    const timeline = createMockTimeline(2);
    let capturedState: any = null;

    render(
      <TimelineViewport timeline={timeline}>
        {({ viewportState }) => {
          capturedState = viewportState;
          return <Text>Test content</Text>;
        }}
      </TimelineViewport>
    );

    // Should provide viewport state
    expect(capturedState).toBeDefined();
    expect(capturedState.selectedLine).toBeDefined();
    expect(capturedState.lineScrollOffset).toBeDefined();
    expect(capturedState.itemPositions).toBeDefined();
    expect(capturedState.totalContentHeight).toBeDefined();
    expect(capturedState.selectedItemIndex).toBeDefined();
  });

  it('should provide viewport actions to children', () => {
    const timeline = createMockTimeline(2);
    let capturedActions: any = null;

    render(
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

    render(
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

  it('should render cursor overlay', () => {
    const timeline = createMockTimeline(1);

    const { lastFrame } = render(
      <TimelineViewport timeline={timeline}>{() => <Text>Content</Text>}</TimelineViewport>
    );

    // Should contain cursor indicator
    expect(lastFrame()).toContain('>');
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

    const { lastFrame } = render(
      <TimelineViewport timeline={timeline}>
        {({ timeline: tl }) => <Text>Items: {tl.items.length}</Text>}
      </TimelineViewport>
    );

    // Should render without crashing
    // Note: cursor overlay covers first character
    expect(lastFrame()).toContain('tems: 0');
  });

  it('should accept focus configuration', () => {
    const timeline = createMockTimeline(1);

    const { lastFrame } = render(
      <TimelineViewport timeline={timeline} focusId="test-focus" parentFocusId="parent-focus">
        {() => <Text>Focused content</Text>}
      </TimelineViewport>
    );

    // Should render without crashing with focus props
    // Note: cursor overlay covers first character
    expect(lastFrame()).toContain('ocused content');
  });
});
