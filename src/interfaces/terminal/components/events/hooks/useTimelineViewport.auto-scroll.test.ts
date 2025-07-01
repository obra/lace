// ABOUTME: Test suite for auto-scroll functionality in useTimelineViewport hook
// ABOUTME: Tests focus-aware auto-scrolling behavior and smooth animation logic

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineViewport } from './useTimelineViewport.js';
import { Timeline } from '../../../../thread-processor.js';

// Mock setInterval and clearInterval
const mockSetInterval = vi.fn();
const mockClearInterval = vi.fn();

vi.stubGlobal('setInterval', mockSetInterval);
vi.stubGlobal('clearInterval', mockClearInterval);

// Mock measureElement from ink
vi.mock('ink', () => ({
  measureElement: vi.fn(),
}));

import { measureElement } from 'ink';
const mockMeasureElement = vi.mocked(measureElement);

describe('useTimelineViewport auto-scroll', () => {
  let mockTimeline: Timeline;
  let mockItemRefs: React.MutableRefObject<Map<number, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTimeline = {
      items: [
        { id: '1', type: 'user_message', content: 'test1', timestamp: new Date() },
        { id: '2', type: 'agent_message', content: 'test2', timestamp: new Date() },
        { id: '3', type: 'user_message', content: 'test3', timestamp: new Date() },
      ],
      metadata: { eventCount: 3, messageCount: 3, lastActivity: new Date() },
    } as Timeline;

    mockItemRefs = {
      current: new Map(),
    };

    // Mock DOM elements for refs
    for (let i = 0; i < 3; i++) {
      mockItemRefs.current.set(i, { nodeName: 'div' });
    }

    // Set up measureElement to return height of 3 for each item
    mockMeasureElement.mockReturnValue({ height: 3, width: 100 });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('focus-aware auto-scroll', () => {
    it('should not auto-scroll when focused', () => {
      const { result } = renderHook(() =>
        useTimelineViewport({
          timeline: mockTimeline,
          viewportLines: 5,
          itemRefs: mockItemRefs,
          isFocused: true,
        })
      );

      // Should not trigger auto-scroll animation
      expect(mockSetInterval).not.toHaveBeenCalled();
      expect(result.current.isAutoScrolling).toBe(false);
    });

    it('should have auto-scroll triggers', () => {
      // This test verifies the auto-scroll functionality exists
      // Integration testing is done in manual testing and real usage
      const { result } = renderHook(() =>
        useTimelineViewport({
          timeline: mockTimeline,
          viewportLines: 5,
          itemRefs: mockItemRefs,
          isFocused: false,
        })
      );

      // Verify auto-scroll functions are available
      expect(typeof result.current.smoothScrollToLine).toBe('function');
      expect(typeof result.current.cancelAutoScroll).toBe('function');
      expect(typeof result.current.isAutoScrolling).toBe('boolean');
    });

    it('should cancel auto-scroll when focus is gained', () => {
      const mockAnimationId = 123;
      mockSetInterval.mockReturnValue(mockAnimationId);

      const { result, rerender } = renderHook(
        ({ isFocused }) =>
          useTimelineViewport({
            timeline: mockTimeline,
            viewportLines: 5,
            itemRefs: mockItemRefs,
            isFocused,
          }),
        {
          initialProps: { isFocused: false },
        }
      );

      // Start auto-scroll
      act(() => {
        result.current.smoothScrollToLine(10);
      });

      expect(mockSetInterval).toHaveBeenCalled();
      expect(result.current.isAutoScrolling).toBe(true);

      // Gain focus
      rerender({ isFocused: true });

      // Should cancel auto-scroll
      expect(mockClearInterval).toHaveBeenCalledWith(mockAnimationId);
      expect(result.current.isAutoScrolling).toBe(false);
    });
  });

  describe('animation logic', () => {
    it('should animate line-by-line to target', () => {
      const mockAnimationId = 123;
      mockSetInterval.mockReturnValue(mockAnimationId);

      const { result } = renderHook(() =>
        useTimelineViewport({
          timeline: mockTimeline,
          viewportLines: 5,
          itemRefs: mockItemRefs,
          isFocused: false,
        })
      );

      const targetLine = 10;
      const initialLine = result.current.selectedLine;

      act(() => {
        result.current.smoothScrollToLine(targetLine);
      });

      // Should start animation
      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 50);
      expect(result.current.isAutoScrolling).toBe(true);

      // Simulate animation steps
      const animationCallback = mockSetInterval.mock.calls[0][0];

      act(() => {
        animationCallback(); // First step
      });

      // Should move one line closer to target
      const newLine = result.current.selectedLine;
      expect(Math.abs(newLine - initialLine)).toBe(1);
      expect(newLine).not.toBe(targetLine); // Should not jump directly
    });

    it('should jump directly for small distances', () => {
      const { result } = renderHook(() =>
        useTimelineViewport({
          timeline: mockTimeline,
          viewportLines: 5,
          itemRefs: mockItemRefs,
          isFocused: false,
        })
      );

      const initialLine = result.current.selectedLine;
      const targetLine = initialLine + 1; // Within jump threshold

      act(() => {
        result.current.smoothScrollToLine(targetLine);
      });

      // Should jump directly, not animate
      expect(mockSetInterval).not.toHaveBeenCalled();
      expect(result.current.selectedLine).toBe(targetLine);
      expect(result.current.isAutoScrolling).toBe(false);
    });

    it('should stop animation when target is reached', () => {
      const mockAnimationId = 123;
      mockSetInterval.mockReturnValue(mockAnimationId);

      const { result } = renderHook(() =>
        useTimelineViewport({
          timeline: mockTimeline,
          viewportLines: 5,
          itemRefs: mockItemRefs,
          isFocused: false,
        })
      );

      act(() => {
        result.current.smoothScrollToLine(5);
      });

      // Simulate animation reaching target
      const animationCallback = mockSetInterval.mock.calls[0][0];

      // Mock selectedLine to be near target
      act(() => {
        result.current.setSelectedLine(4);
      });

      act(() => {
        animationCallback(); // Should reach target and stop
      });

      // Should clear interval when target reached
      expect(mockClearInterval).toHaveBeenCalledWith(mockAnimationId);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid focus changes', () => {
      const { result, rerender } = renderHook(
        ({ isFocused }) =>
          useTimelineViewport({
            timeline: mockTimeline,
            viewportLines: 5,
            itemRefs: mockItemRefs,
            isFocused,
          }),
        {
          initialProps: { isFocused: false },
        }
      );

      // Start auto-scroll
      act(() => {
        result.current.smoothScrollToLine(10);
      });

      // Rapid focus changes
      rerender({ isFocused: true });
      rerender({ isFocused: false });
      rerender({ isFocused: true });

      // Should handle gracefully without errors
      expect(result.current.isAutoScrolling).toBe(false);
    });

    it('should clean up animation on unmount', () => {
      const mockAnimationId = 123;
      mockSetInterval.mockReturnValue(mockAnimationId);

      const { result, unmount } = renderHook(() =>
        useTimelineViewport({
          timeline: mockTimeline,
          viewportLines: 5,
          itemRefs: mockItemRefs,
          isFocused: false,
        })
      );

      // Start an animation
      act(() => {
        result.current.smoothScrollToLine(10);
      });

      expect(mockSetInterval).toHaveBeenCalled();

      unmount();

      // Should clear any running animations
      expect(mockClearInterval).toHaveBeenCalledWith(mockAnimationId);
    });
  });
});
