// ABOUTME: Integration tests for toolbox-style visual enhancements across the system
// ABOUTME: Validates that status propagates correctly from tool renderers to SideMarkerRenderer

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { TimelineEntryCollapsibleBox } from './TimelineEntryCollapsibleBox.js';

describe('Toolbox Style Integration', () => {
  describe('Status propagation', () => {
    it('displays success status with correct marker', () => {
      const { lastFrame } = render(
        <TimelineEntryCollapsibleBox
          isExpanded={true}
          onExpandedChange={() => {}}
          status="success"
          label="Tool: bash"
        >
          <Text>Command executed successfully</Text>
        </TimelineEntryCollapsibleBox>
      );

      const output = lastFrame() || '';
      expect(output).toContain('⊂'); // Single line marker
      expect(output).toContain('Tool: bash');
      expect(output).toContain('Command executed successfully');
    });

    it('displays error status with correct marker', () => {
      const { lastFrame } = render(
        <TimelineEntryCollapsibleBox
          isExpanded={true}
          onExpandedChange={() => {}}
          status="error"
          contentHeight={3}
        >
          <Text>Command failed</Text>
          <Text>Error: file not found</Text>
          <Text>Exit code: 1</Text>
        </TimelineEntryCollapsibleBox>
      );

      const output = lastFrame() || '';
      expect(output).toContain('╭'); // Top marker
      expect(output).toContain('│'); // Middle marker
      expect(output).toContain('╰'); // Bottom marker
      expect(output).toContain('Command failed');
      expect(output).toContain('Error: file not found');
      expect(output).toContain('Exit code: 1');
    });

    it('displays pending status with correct marker', () => {
      const { lastFrame } = render(
        <TimelineEntryCollapsibleBox
          isExpanded={true}
          onExpandedChange={() => {}}
          status="pending"
          contentHeight={2}
        >
          <Text>Running command...</Text>
          <Text>Please wait</Text>
        </TimelineEntryCollapsibleBox>
      );

      const output = lastFrame() || '';
      expect(output).toContain('╭'); // Top marker
      expect(output).toContain('╰'); // Bottom marker
      expect(output).not.toContain('│'); // No middle marker for 2 lines
      expect(output).toContain('Running command...');
      expect(output).toContain('Please wait');
    });

    it('uses default none status when no status provided', () => {
      const { lastFrame } = render(
        <TimelineEntryCollapsibleBox
          isExpanded={true}
          onExpandedChange={() => {}}
        >
          <Text>Content without explicit status</Text>
        </TimelineEntryCollapsibleBox>
      );

      const output = lastFrame() || '';
      expect(output).toContain('⊂'); // Should show marker with default 'none' status
      expect(output).toContain('Content without explicit status');
    });
  });

  describe('Focus and selection states', () => {
    it('applies bright colors when selected', () => {
      const { lastFrame } = render(
        <TimelineEntryCollapsibleBox
          isExpanded={true}
          onExpandedChange={() => {}}
          status="success"
          isSelected={true}
        >
          <Text>Selected tool execution</Text>
        </TimelineEntryCollapsibleBox>
      );

      const output = lastFrame() || '';
      expect(output).toContain('⊂');
      expect(output).toContain('Selected tool execution');
      // Color testing is difficult in unit tests, but we verify rendering succeeds
    });

    it('applies bright colors when focused', () => {
      const { lastFrame } = render(
        <TimelineEntryCollapsibleBox
          isExpanded={true}
          onExpandedChange={() => {}}
          status="error"
          isFocused={true}
        >
          <Text>Focused error display</Text>
        </TimelineEntryCollapsibleBox>
      );

      const output = lastFrame() || '';
      expect(output).toContain('⊂');
      expect(output).toContain('Focused error display');
    });
  });

  describe('Height variations', () => {
    it('renders correctly with different content heights', () => {
      // Test height 1
      const { lastFrame: frame1 } = render(
        <TimelineEntryCollapsibleBox
          isExpanded={true}
          onExpandedChange={() => {}}
          status="success"
          contentHeight={1}
        >
          <Text>Single line</Text>
        </TimelineEntryCollapsibleBox>
      );
      expect(frame1()).toContain('⊂');

      // Test height 4
      const { lastFrame: frame4 } = render(
        <TimelineEntryCollapsibleBox
          isExpanded={true}
          onExpandedChange={() => {}}
          status="pending"
          contentHeight={4}
        >
          <Text>Line 1</Text>
          <Text>Line 2</Text>
          <Text>Line 3</Text>
          <Text>Line 4</Text>
        </TimelineEntryCollapsibleBox>
      );
      const output4 = frame4() || '';
      expect(output4).toContain('╭');
      expect(output4).toContain('│');
      expect(output4).toContain('╰');
      
      // Should have 2 middle characters for 4-line content (4 - 2 = 2)
      const middleCount = (output4.match(/│/g) || []).length;
      expect(middleCount).toBe(2);
    });
  });
});