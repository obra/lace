// ABOUTME: Timeline entry component with toolbox-style side markers and collapsible content
// ABOUTME: Uses SideMarkerRenderer for status-based visual indicators and consistent spacing

import React, { useEffect, useRef } from 'react';
import { Box } from 'ink';
import { CollapsibleBox } from './CollapsibleBox.js';
import { SideMarkerRenderer, type MarkerStatus } from './SideMarkerRenderer.js';

interface TimelineEntryCollapsibleBoxProps {
  children: React.ReactNode;
  label?: string | React.ReactNode;
  summary?: React.ReactNode;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  maxHeight?: number;
  isSelected?: boolean;
  isFocused?: boolean;
  onToggle?: () => void; // Called when expanded/collapsed to trigger height re-measurement
  
  // SideMarkerRenderer props
  status?: MarkerStatus;
  contentHeight?: number; // Override automatic height detection
}

export function TimelineEntryCollapsibleBox({
  children,
  label,
  summary,
  isExpanded,
  onExpandedChange,
  maxHeight,
  isSelected = false,
  isFocused = false,
  onToggle,
  status = 'none',
  contentHeight,
}: TimelineEntryCollapsibleBoxProps) {
  const prevExpandedRef = useRef<boolean | undefined>(undefined);

  // Detect expansion state changes and trigger remeasurement
  useEffect(() => {
    const prevExpanded = prevExpandedRef.current;
    const currentExpanded = isExpanded;

    // Only trigger on actual changes, not initial mount
    if (prevExpanded !== undefined && prevExpanded !== currentExpanded) {
      onToggle?.();
    }

    prevExpandedRef.current = currentExpanded;
  }, [isExpanded, onToggle]);

  // Always use SideMarkerRenderer for consistent toolbox-style markers
  // Provides status-based visual indicators that replace traditional borders
  return (
    <Box paddingBottom={1}>
      <SideMarkerRenderer
        status={status}
        isSelected={isSelected || isFocused}
        contentHeight={contentHeight}
        isExpanded={isExpanded}
      >
        <CollapsibleBox
          children={children}
          label={label}
          summary={summary}
          isExpanded={isExpanded}
          maxHeight={maxHeight}
          borderStyle={undefined}
          borderColor={undefined}
          isSelected={isSelected}
        />
      </SideMarkerRenderer>
    </Box>
  );
}
