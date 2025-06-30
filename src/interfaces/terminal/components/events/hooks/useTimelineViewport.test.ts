// ABOUTME: Tests for useTimelineViewport hook focusing on height measurement and expansion behavior
// ABOUTME: Regression test for timeline height measurement after collapsible box expansion

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Timeline } from '../../../../thread-processor.js';

// Mock Ink's measureElement function before importing the hook
vi.mock('ink', () => ({
  measureElement: vi.fn(),
}));

import { useTimelineViewport } from './useTimelineViewport.js';
import { measureElement } from 'ink';

const mockMeasureElement = vi.mocked(measureElement);

describe('useTimelineViewport', () => {
  let timeline: Timeline;
  let itemRefs: React.MutableRefObject<Map<number, unknown>>;

  beforeEach(() => {
    timeline = {
      items: [
        {
          type: 'user_message',
          id: 'msg1',
          content: 'Test message 1',
          timestamp: new Date(),
        },
        {
          type: 'agent_message',
          id: 'msg2',
          content: 'Test response 1',
          timestamp: new Date(),
        },
      ],
      metadata: { eventCount: 2, messageCount: 2, lastActivity: new Date() },
    };

    // Create mock DOM elements for itemRefs
    const mockElement1 = { nodeName: 'DIV', offsetHeight: 20 };
    const mockElement2 = { nodeName: 'DIV', offsetHeight: 30 };

    itemRefs = {
      current: new Map([
        [0, mockElement1],
        [1, mockElement2],
      ]),
    };

    // Reset mock
    mockMeasureElement.mockReset();
  });

  it('should measure timeline item heights correctly when itemRefs are populated', () => {
    // Mock measureElement to return different heights
    mockMeasureElement
      .mockReturnValueOnce({ height: 20, width: 100 })
      .mockReturnValueOnce({ height: 30, width: 100 });

    const { result } = renderHook(() =>
      useTimelineViewport({
        timeline,
        viewportLines: 10,
        itemRefs,
      })
    );

    // Wait for initial measurement
    expect(result.current.itemPositions).toEqual([0, 20]);
    expect(result.current.totalContentHeight).toBe(50);
  });

  it('should fallback to 3-pixel height when itemRefs are not populated', () => {
    // Empty itemRefs map (regression scenario)
    const emptyItemRefs = { current: new Map<number, unknown>() };

    const { result } = renderHook(() =>
      useTimelineViewport({
        timeline,
        viewportLines: 10,
        itemRefs: emptyItemRefs,
      })
    );

    // Should use fallback height of 3 pixels per item
    expect(result.current.itemPositions).toEqual([0, 3]);
    expect(result.current.totalContentHeight).toBe(6);

    // measureElement should not be called since refs are empty
    expect(mockMeasureElement).not.toHaveBeenCalled();
  });

  it('should trigger remeasurement and maintain selection after expansion', () => {
    // Set up mock to return values for initial measurement and remeasurement
    mockMeasureElement
      .mockReturnValueOnce({ height: 20, width: 100 }) // Initial - item 0
      .mockReturnValueOnce({ height: 30, width: 100 }) // Initial - item 1
      .mockReturnValueOnce({ height: 40, width: 100 }) // Remeasurement - item 0 (expanded)
      .mockReturnValueOnce({ height: 30, width: 100 }); // Remeasurement - item 1

    const { result } = renderHook(() =>
      useTimelineViewport({
        timeline,
        viewportLines: 10,
        itemRefs,
      })
    );

    // Check initial state
    const initialTrigger = result.current.measurementTrigger;
    expect(initialTrigger).toBe(0);

    // Simulate expansion by triggering remeasurement
    // This should increment the measurement trigger
    act(() => {
      result.current.triggerRemeasurement();
    });

    // Should have incremented measurement trigger
    expect(result.current.measurementTrigger).toBe(initialTrigger + 1);
  });

  it('should handle timeline item changes and update measurements', () => {
    mockMeasureElement
      .mockReturnValueOnce({ height: 20, width: 100 })
      .mockReturnValueOnce({ height: 30, width: 100 })
      .mockReturnValueOnce({ height: 20, width: 100 })
      .mockReturnValueOnce({ height: 30, width: 100 })
      .mockReturnValueOnce({ height: 25, width: 100 }); // New item

    const { result, rerender } = renderHook(
      ({ timeline: tl }) =>
        useTimelineViewport({
          timeline: tl,
          viewportLines: 10,
          itemRefs,
        }),
      { initialProps: { timeline } }
    );

    // Initial measurement
    expect(result.current.itemPositions).toEqual([0, 20]);
    expect(result.current.totalContentHeight).toBe(50);

    // Add new timeline item
    const updatedTimeline = {
      ...timeline,
      items: [
        ...timeline.items,
        {
          type: 'user_message' as const,
          id: 'msg3',
          content: 'New message',
          timestamp: new Date(),
        },
      ],
      metadata: { eventCount: 3, messageCount: 3, lastActivity: new Date() },
    };

    // Add new ref for the new item
    itemRefs.current.set(2, { nodeName: 'DIV', offsetHeight: 25 });

    rerender({ timeline: updatedTimeline });

    // Should remeasure with new item
    expect(result.current.itemPositions).toEqual([0, 20, 50]);
    expect(result.current.totalContentHeight).toBe(75);
  });

  it('should properly handle invalid refs without crashing', () => {
    // Mix of valid and invalid refs
    const mixedItemRefs = {
      current: new Map([
        [0, { nodeName: 'DIV', offsetHeight: 20 }], // Valid
        [1, null], // Invalid
      ]),
    };

    mockMeasureElement.mockReturnValueOnce({ height: 20, width: 100 });

    const { result } = renderHook(() =>
      useTimelineViewport({
        timeline,
        viewportLines: 10,
        itemRefs: mixedItemRefs,
      })
    );

    // Should handle mixed refs gracefully
    // First item measured, second uses fallback
    expect(result.current.itemPositions).toEqual([0, 20]);
    expect(result.current.totalContentHeight).toBe(23); // 20 + 3 fallback
  });
});
