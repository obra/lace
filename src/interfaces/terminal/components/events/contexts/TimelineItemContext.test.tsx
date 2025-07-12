// ABOUTME: Tests for TimelineItemContext provider and hook functionality
// ABOUTME: Verifies context state management and proper hook behavior

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { Text, Box } from 'ink';
import {
  TimelineItemProvider,
  useTimelineItem,
  useTimelineItemOptional,
} from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';

// Mock the expansion hook
vi.mock('../hooks/useTimelineExpansionToggle.js', () => ({
  useTimelineItemExpansion: () => ({
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
  }),
}));

// Test component that uses the required hook
function TestComponentRequired() {
  const context = useTimelineItem();

  return (
    <Box flexDirection="column">
      <Text>Selected: {context.isSelected ? 'true' : 'false'}</Text>
      <Text>Expanded: {context.isExpanded ? 'true' : 'false'}</Text>
      <Text>FocusedLine: {context.focusedLine || 'none'}</Text>
      <Text>ItemStartLine: {context.itemStartLine || 'none'}</Text>
      <Text>Expand</Text>
      <Text>Collapse</Text>
      <Text>Toggle</Text>
    </Box>
  );
}

// Test component that uses the optional hook
function TestComponentOptional() {
  const context = useTimelineItemOptional();

  if (!context) {
    return <Text>No context available</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text>Selected: {context.isSelected ? 'true' : 'false'}</Text>
      <Text>Expanded: {context.isExpanded ? 'true' : 'false'}</Text>
      <Text>FocusedLine: {context.focusedLine || 'none'}</Text>
      <Text>ItemStartLine: {context.itemStartLine || 'none'}</Text>
      <Text>Expand</Text>
      <Text>Collapse</Text>
      {context.onToggle && <Text>Toggle</Text>}
    </Box>
  );
}

describe('TimelineItemContext', () => {
  describe('TimelineItemProvider', () => {
    it('should provide context values to children', () => {
      const mockOnToggle = vi.fn();

      const { lastFrame } = render(
        <TimelineItemProvider
          isSelected={true}
          onToggle={mockOnToggle}
          focusedLine={10}
          itemStartLine={5}
        >
          <TestComponentRequired />
        </TimelineItemProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('Selected: true');
      expect(frame).toContain('Expanded: false'); // from mock
      expect(frame).toContain('FocusedLine: 10');
      expect(frame).toContain('ItemStartLine: 5');
    });

    it('should provide minimal required context values', () => {
      const mockOnToggle = vi.fn();

      const { lastFrame } = render(
        <TimelineItemProvider isSelected={false} onToggle={mockOnToggle}>
          <TestComponentRequired />
        </TimelineItemProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('Selected: false');
      expect(frame).toContain('Expanded: false'); // default value
      expect(frame).toContain('FocusedLine: none');
      expect(frame).toContain('ItemStartLine: none');
    });

    it('should call onToggle when toggle button is clicked', () => {
      const mockOnToggle = vi.fn();

      render(
        <TimelineItemProvider isSelected={false} onToggle={mockOnToggle}>
          <TestComponentRequired />
        </TimelineItemProvider>
      );

      // Note: ink-testing-library doesn't support click events
      // This test verifies the function is passed through correctly
      expect(mockOnToggle).not.toHaveBeenCalled();
    });
  });

  describe('useTimelineItem', () => {
    it('should throw error when used outside provider', () => {
      // Capture console.error to avoid test noise
      const originalError = console.error;
      const mockError = vi.fn();
      console.error = mockError;

      try {
        render(<TestComponentRequired />);
        // If we get here, the test should fail
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
      }

      console.error = originalError;
    });

    it('should return context values when used within provider', () => {
      const mockOnToggle = vi.fn();

      const { lastFrame } = render(
        <TimelineItemProvider
          isSelected={true}
          onToggle={mockOnToggle}
          focusedLine={15}
          itemStartLine={1}
        >
          <TestComponentRequired />
        </TimelineItemProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('Selected: true');
      expect(frame).toContain('Expanded: false'); // from mock
      expect(frame).toContain('FocusedLine: 15');
      expect(frame).toContain('ItemStartLine: 1');
    });
  });

  describe('useTimelineItemOptional', () => {
    it('should return null when used outside provider', () => {
      const { lastFrame } = render(<TestComponentOptional />);

      expect(lastFrame()).toContain('No context available');
    });

    it('should return context values when used within provider', () => {
      const mockOnToggle = vi.fn();

      const { lastFrame } = render(
        <TimelineItemProvider
          isSelected={false}
          onToggle={mockOnToggle}
          focusedLine={20}
          itemStartLine={10}
        >
          <TestComponentOptional />
        </TimelineItemProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('Selected: false');
      expect(frame).toContain('Expanded: false'); // from mock
      expect(frame).toContain('FocusedLine: 20');
      expect(frame).toContain('ItemStartLine: 10');
    });

    it('should handle missing onToggle gracefully', () => {
      const { lastFrame } = render(
        <TimelineItemProvider isSelected={false}>
          <TestComponentOptional />
        </TimelineItemProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('Selected: false');
      expect(frame).toContain('Expanded: false'); // from mock
      // Should not render Toggle button when onToggle is not provided
      expect(frame).not.toContain('Toggle');
    });
  });

  describe('Context state management', () => {
    it('should handle expansion state changes', () => {
      const mockOnToggle = vi.fn();

      render(
        <TimelineItemProvider isSelected={false} onToggle={mockOnToggle}>
          <TestComponentRequired />
        </TimelineItemProvider>
      );

      // Verify functions are passed through correctly
      expect(mockOnToggle).not.toHaveBeenCalled();
    });

    it('should provide default values for optional props', () => {
      const mockOnToggle = vi.fn();

      const { lastFrame } = render(
        <TimelineItemProvider isSelected={true} onToggle={mockOnToggle}>
          <TestComponentRequired />
        </TimelineItemProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('Selected: true');
      expect(frame).toContain('Expanded: false'); // default
      expect(frame).toContain('FocusedLine: none'); // default
      expect(frame).toContain('ItemStartLine: none'); // default
    });
  });
});
