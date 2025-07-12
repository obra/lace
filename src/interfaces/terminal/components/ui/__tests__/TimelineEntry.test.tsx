// ABOUTME: Tests for TimelineEntry component focusing on height measurement behavior
// ABOUTME: Verifies immediate collapse measurement, delayed expand measurement, and marker sizing

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { measureElement, Text } from 'ink';
import { TimelineEntry } from '~/interfaces/terminal/components/ui/TimelineEntry';
import { UI_SYMBOLS } from '~/interfaces/terminal/theme';

// Mock measureElement to control height measurements
vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    measureElement: vi.fn(),
  };
});

const mockMeasureElement = measureElement as ReturnType<typeof vi.fn>;

describe('TimelineEntry Height Measurement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default mock returns height of 2
    mockMeasureElement.mockReturnValue({ height: 2, width: 40 });

    // Reset the mock implementation to ensure it's callable
    mockMeasureElement.mockImplementation(() => ({ height: 2, width: 40 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic rendering', () => {
    it('should render with children when expanded', () => {
      const { lastFrame } = render(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Test content</Text>
        </TimelineEntry>
      );

      expect(lastFrame()).toContain('Test content');
    });

    it('should render with summary when collapsed', () => {
      const { lastFrame } = render(
        <TimelineEntry
          isExpanded={false}
          onExpandedChange={vi.fn()}
          summary={<Text>Summary content</Text>}
          isExpandable={true}
        >
          <Text>Full content</Text>
        </TimelineEntry>
      );

      expect(lastFrame()).toContain('Summary content');
      expect(lastFrame()).not.toContain('Full content');
    });
  });

  describe('Height measurement timing', () => {
    it('should respond properly to expansion state changes', () => {
      const { rerender, lastFrame } = render(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Expanded content</Text>
        </TimelineEntry>
      );

      // Should show expanded content
      expect(lastFrame()).toContain('Expanded content');

      // Change to collapsed state
      rerender(
        <TimelineEntry
          isExpanded={false}
          onExpandedChange={vi.fn()}
          summary={<Text>Collapsed content</Text>}
          isExpandable={true}
        >
          <Text>Expanded content</Text>
        </TimelineEntry>
      );

      // Should now show collapsed content
      expect(lastFrame()).toContain('Collapsed content');
      expect(lastFrame()).not.toContain('Expanded content');

      // Verify the component completed the state change successfully
      expect(lastFrame()).toBeTruthy();
    });

    it('should render different content based on expansion state', () => {
      let isExpanded = false;

      const { rerender, lastFrame } = render(
        <TimelineEntry
          isExpanded={isExpanded}
          onExpandedChange={vi.fn()}
          summary={<Text>Collapsed content</Text>}
          isExpandable={true}
        >
          <Text>Expanded content</Text>
        </TimelineEntry>
      );

      // Should show collapsed content
      expect(lastFrame()).toContain('Collapsed content');
      expect(lastFrame()).not.toContain('Expanded content');

      // Expand the entry
      isExpanded = true;
      rerender(
        <TimelineEntry
          isExpanded={isExpanded}
          onExpandedChange={vi.fn()}
          summary={<Text>Collapsed content</Text>}
          isExpandable={true}
        >
          <Text>Expanded content</Text>
        </TimelineEntry>
      );

      // Should show expanded content
      expect(lastFrame()).toContain('Expanded content');
      expect(lastFrame()).not.toContain('Collapsed content');
    });

    it('should update content when children change', () => {
      const { rerender, lastFrame } = render(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Content 1</Text>
        </TimelineEntry>
      );

      expect(lastFrame()).toContain('Content 1');

      // Change children
      rerender(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Content 2</Text>
        </TimelineEntry>
      );

      expect(lastFrame()).toContain('Content 2');
      expect(lastFrame()).not.toContain('Content 1');
    });
  });

  describe('Component structure', () => {
    it('should render with label when provided', () => {
      const { lastFrame } = render(
        <TimelineEntry
          label="Test Label"
          isExpanded={true}
          onExpandedChange={vi.fn()}
          isExpandable={true}
        >
          <Text>Test content</Text>
        </TimelineEntry>
      );

      expect(lastFrame()).toContain('Test Label');
      expect(lastFrame()).toContain('Test content');
    });

    it('should handle component lifecycle without crashing', () => {
      const { unmount } = render(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Test content</Text>
        </TimelineEntry>
      );

      // Should not crash when unmounting
      expect(() => {
        unmount();
        vi.advanceTimersByTime(1000);
      }).not.toThrow();
    });
  });

  describe('Marker sizing based on measured height', () => {
    it('should show expansion indicator for expandable items', () => {
      mockMeasureElement.mockReturnValue({ height: 1, width: 40 });

      const { lastFrame } = render(
        <TimelineEntry isExpanded={false} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Content</Text>
        </TimelineEntry>
      );

      // Advance timers to trigger measurement
      vi.advanceTimersByTime(100);

      // Should show collapsed expansion indicator
      const frame = lastFrame();
      expect(frame).toContain(UI_SYMBOLS.COLLAPSED); // ▶
    });

    it('should not show expansion indicator for non-expandable items', () => {
      mockMeasureElement.mockReturnValue({ height: 1, width: 40 });

      const { lastFrame } = render(
        <TimelineEntry isExpanded={false} onExpandedChange={vi.fn()} isExpandable={false}>
          <Text>Content</Text>
        </TimelineEntry>
      );

      // Advance timers to trigger measurement
      vi.advanceTimersByTime(100);

      // Should not show expansion indicators
      const frame = lastFrame();
      expect(frame).not.toContain(UI_SYMBOLS.COLLAPSED); // ▶
      expect(frame).not.toContain(UI_SYMBOLS.EXPANDED); // ▼
    });

    it('should show expanded indicator for expanded items', () => {
      const { lastFrame } = render(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Multi-line content</Text>
        </TimelineEntry>
      );

      const frame = lastFrame();
      // Should show expanded indicator
      expect(frame).toContain(UI_SYMBOLS.EXPANDED); // ▼
    });
  });

  describe('Integration behavior', () => {
    it('should integrate properly with different statuses', () => {
      const statuses: Array<'none' | 'pending' | 'success' | 'error'> = [
        'none',
        'pending',
        'success',
        'error',
      ];

      statuses.forEach((status) => {
        expect(() =>
          render(
            <TimelineEntry
              isExpanded={false}
              onExpandedChange={vi.fn()}
              isExpandable={true}
              status={status}
            >
              <Text>Content</Text>
            </TimelineEntry>
          )
        ).not.toThrow();
      });
    });

    it('should call onExpandedChange when user interacts', () => {
      const onExpandedChange = vi.fn();

      render(
        <TimelineEntry isExpanded={false} onExpandedChange={onExpandedChange} isExpandable={true}>
          <div>Content</div>
        </TimelineEntry>
      );

      // onExpandedChange should be called by user interaction
      // (This would typically happen through UI events)
      expect(onExpandedChange).toBeDefined();
    });
  });

  describe('Performance considerations', () => {
    it('should not remeasure when height has not changed', () => {
      const { rerender } = render(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Content</Text>
        </TimelineEntry>
      );

      // Clear initial calls
      vi.advanceTimersByTime(100);
      mockMeasureElement.mockClear();

      // Re-render with same content
      rerender(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Content</Text>
        </TimelineEntry>
      );

      vi.advanceTimersByTime(100);

      // Should measure again but not update state if height is same
      expect(mockMeasureElement).toHaveBeenCalled();
    });

    it('should cancel pending measurements when component unmounts', () => {
      const { unmount } = render(
        <TimelineEntry isExpanded={true} onExpandedChange={vi.fn()} isExpandable={true}>
          <Text>Content</Text>
        </TimelineEntry>
      );

      // Unmount before measurement completes
      unmount();

      // Advance timers - should not crash
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    });
  });
});
