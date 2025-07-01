// ABOUTME: Integration tests for TimelineEntryCollapsibleBox with SideMarkerRenderer
// ABOUTME: Validates enhanced timeline entries with toolbox-style visual markers

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { TimelineEntryCollapsibleBox } from './TimelineEntryCollapsibleBox.js';

describe('TimelineEntryCollapsibleBox with SideMarkerRenderer', () => {
  it('renders with default status none', () => {
    const { lastFrame } = render(
      <TimelineEntryCollapsibleBox
        isExpanded={true}
        onExpandedChange={() => {}}
      >
        <Text>Test content</Text>
      </TimelineEntryCollapsibleBox>
    );

    const output = lastFrame() || '';
    expect(output).toContain('Test content');
  });

  it('renders with success status', () => {
    const { lastFrame } = render(
      <TimelineEntryCollapsibleBox
        isExpanded={true}
        onExpandedChange={() => {}}
        status="success"
      >
        <Text>Successful operation</Text>
      </TimelineEntryCollapsibleBox>
    );

    const output = lastFrame() || '';
    expect(output).toContain('⊂');
    expect(output).toContain('Successful operation');
  });

  it('renders with error status and multiple lines', () => {
    const { lastFrame } = render(
      <TimelineEntryCollapsibleBox
        isExpanded={true}
        onExpandedChange={() => {}}
        status="error"
        contentHeight={3}
      >
        <Text>Error occurred</Text>
        <Text>Error details</Text>
        <Text>Stack trace</Text>
      </TimelineEntryCollapsibleBox>
    );

    const output = lastFrame() || '';
    expect(output).toContain('╭');
    expect(output).toContain('│');
    expect(output).toContain('╰');
    expect(output).toContain('Error occurred');
    expect(output).toContain('Error details');
    expect(output).toContain('Stack trace');
  });

  it('passes focus state to SideMarkerRenderer', () => {
    const { lastFrame } = render(
      <TimelineEntryCollapsibleBox
        isExpanded={true}
        onExpandedChange={() => {}}
        status="pending"
        isSelected={true}
        isFocused={true}
      >
        <Text>Pending operation</Text>
      </TimelineEntryCollapsibleBox>
    );

    const output = lastFrame() || '';
    expect(output).toContain('⊂');
    expect(output).toContain('Pending operation');
  });

  it('shows correct markers when collapsed vs expanded', () => {
    const { lastFrame, rerender } = render(
      <TimelineEntryCollapsibleBox
        isExpanded={false}
        onExpandedChange={() => {}}
        status="success"
      >
        <Text>Collapsed summary</Text>
      </TimelineEntryCollapsibleBox>
    );

    // When collapsed, should show single line marker
    const collapsedOutput = lastFrame() || '';
    expect(collapsedOutput).toContain('⊂');

    // When expanded, should show multi-line markers
    rerender(
      <TimelineEntryCollapsibleBox
        isExpanded={true}
        onExpandedChange={() => {}}
        status="success"
        contentHeight={3} // Only specify when we know the exact height
      >
        <Text>Content line 1</Text>
        <Text>Content line 2</Text>
        <Text>Content line 3</Text>
      </TimelineEntryCollapsibleBox>
    );

    const expandedOutput = lastFrame() || '';
    expect(expandedOutput).toContain('╭');
    expect(expandedOutput).toContain('╰');
  });
});